/**
 * lib/observe.js
 *
 * A thin instrumentation wrapper around Groq's chat completions API.
 * Drop this into real application code (not just test scripts) to log
 * a structured trace event for every LLM call: latency, token usage,
 * success/error, and a running estimate of daily token consumption
 * against Groq's free-tier per-model cap.
 *
 * This is the "observe production traffic" half of observability.
 * scripts/analyze-traces.js and scripts/detect-anomalies.js are the
 * "make sense of what you logged" half.
 *
 * Usage:
 *   const { observedGroqCall } = require("./lib/observe");
 *   const result = await observedGroqCall({
 *     model: "openai/gpt-oss-20b",
 *     messages: [{ role: "user", content: "Hello" }],
 *   });
 *   console.log(result.output);
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TRACE_LOG_PATH = process.env.OBSERVABILITY_LOG_PATH || path.join(__dirname, "..", "traces", "traces.jsonl");

// Groq's free tier enforces per-model daily token caps (TPD). This
// project was built after directly hitting one of these in practice —
// see README for the real error message. Update these if Groq changes
// their published limits.
const KNOWN_DAILY_TOKEN_CAPS = {
  "openai/gpt-oss-20b": 200000,
  "openai/gpt-oss-120b": 100000,
};

function appendTrace(event) {
  fs.mkdirSync(path.dirname(TRACE_LOG_PATH), { recursive: true });
  fs.appendFileSync(TRACE_LOG_PATH, JSON.stringify(event) + "\n");
}

/**
 * Calls Groq's chat completions endpoint and logs a structured trace
 * event regardless of success or failure. Throws the original error
 * after logging it, so calling code's error handling is unaffected.
 */
async function observedGroqCall({ model, messages, temperature = 0.3, max_tokens = 1024, apiKey }) {
  const key = apiKey || process.env.GROQ_API_KEY;
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const baseEvent = {
    requestId,
    timestamp: new Date(startedAt).toISOString(),
    model,
    promptPreview: (messages[messages.length - 1]?.content || "").slice(0, 120),
  };

  if (!key) {
    const event = {
      ...baseEvent,
      status: "error",
      errorType: "missing_api_key",
      errorMessage: "GROQ_API_KEY not set",
      latencyMs: Date.now() - startedAt,
    };
    appendTrace(event);
    throw new Error("GROQ_API_KEY not set");
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens }),
    });

    const latencyMs = Date.now() - startedAt;
    const body = await response.json();

    if (!response.ok) {
      const event = {
        ...baseEvent,
        status: "error",
        httpStatus: response.status,
        errorType: body?.error?.code || "http_error",
        errorMessage: body?.error?.message || `HTTP ${response.status}`,
        latencyMs,
      };
      appendTrace(event);
      const err = new Error(event.errorMessage);
      err.httpStatus = response.status;
      throw err;
    }

    const usage = body.usage || {};
    const event = {
      ...baseEvent,
      status: "success",
      latencyMs,
      promptTokens: usage.prompt_tokens ?? null,
      completionTokens: usage.completion_tokens ?? null,
      totalTokens: usage.total_tokens ?? null,
      finishReason: body.choices?.[0]?.finish_reason ?? null,
      dailyCapForModel: KNOWN_DAILY_TOKEN_CAPS[model] ?? null,
    };
    appendTrace(event);

    return {
      output: body.choices?.[0]?.message?.content ?? null,
      raw: body,
      trace: event,
    };
  } catch (err) {
    if (!err.httpStatus && err.message !== "GROQ_API_KEY not set") {
      // Network-level failure (timeout, DNS, connection reset, etc.)
      const event = {
        ...baseEvent,
        status: "error",
        errorType: "network_error",
        errorMessage: err.message,
        latencyMs: Date.now() - startedAt,
      };
      appendTrace(event);
    }
    throw err;
  }
}

module.exports = { observedGroqCall, TRACE_LOG_PATH, KNOWN_DAILY_TOKEN_CAPS };
