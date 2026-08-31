#!/usr/bin/env node
/**
 * scripts/generate-demo-traces.js
 *
 * Generates a realistic, synthetic traces.jsonl so you can try
 * analyze-traces.js and dashboard.html immediately, without needing to
 * run real production traffic first. Clearly synthetic — every event
 * has "synthetic": true so it's never confused with real trace data.
 *
 * The generated data deliberately includes:
 *   - A normal baseline period (steady latency, low error rate)
 *   - A "regression" period near the end (latency creep + a few errors)
 *   - Token usage climbing toward the gpt-oss-120b daily cap, ending at
 *     ~97% of budget — a direct simulation of the exact situation this
 *     project's README describes hitting in practice.
 *
 * Usage:
 *   node scripts/generate-demo-traces.js > traces/traces.jsonl
 *   node scripts/generate-demo-traces.js --count 300 > traces/traces.jsonl
 */

const crypto = require("crypto");

const args = process.argv.slice(2);
const countIdx = args.indexOf("--count");
const COUNT = countIdx !== -1 ? parseInt(args[countIdx + 1], 10) : 200;

const MODELS = ["openai/gpt-oss-20b", "openai/gpt-oss-120b"];
const DAILY_CAPS = { "openai/gpt-oss-20b": 200000, "openai/gpt-oss-120b": 100000 };

function randRange(min, max) {
  return min + Math.random() * (max - min);
}
function randInt(min, max) {
  return Math.floor(randRange(min, max + 1));
}

const now = Date.now();
const spanMs = 6 * 60 * 60 * 1000; // simulate 6 hours of traffic
const startMs = now - spanMs;

let cumulativeTokens = { "openai/gpt-oss-20b": 0, "openai/gpt-oss-120b": 0 };

const events = [];

for (let i = 0; i < COUNT; i++) {
  const progress = i / COUNT; // 0 (start) -> 1 (end/most recent)
  const timestamp = new Date(startMs + progress * spanMs).toISOString();
  const model = MODELS[randInt(0, MODELS.length - 1)];
  const requestId = crypto.randomUUID();

  // Regression window: last 15% of events get worse latency and more errors
  const inRegressionWindow = progress > 0.85;

  const baseLatency = model === "openai/gpt-oss-120b" ? randRange(600, 1100) : randRange(250, 500);
  const latencyMs = Math.round(inRegressionWindow ? baseLatency * randRange(1.8, 3.2) : baseLatency);

  // Error rate: ~2% baseline, ~18% during the regression window
  const errorRoll = Math.random();
  const isError = inRegressionWindow ? errorRoll < 0.18 : errorRoll < 0.02;

  const promptTokens = randInt(80, 400);
  // Push gpt-oss-120b usage close to its daily cap by the end, to
  // demonstrate the budget-tracking feature concretely.
  const completionTokens =
    model === "openai/gpt-oss-120b" && progress > 0.5
      ? randInt(600, 1400)
      : randInt(60, 500);
  const totalTokens = promptTokens + completionTokens;

  if (!isError) {
    cumulativeTokens[model] += totalTokens;
  }

  const event = {
    requestId,
    timestamp,
    model,
    promptPreview: `Demo prompt #${i} for ${model.split("/")[1]}`,
    status: isError ? "error" : "success",
    latencyMs,
    synthetic: true,
  };

  if (isError) {
    event.httpStatus = Math.random() < 0.5 ? 429 : 500;
    event.errorType = event.httpStatus === 429 ? "rate_limit_exceeded" : "server_error";
    event.errorMessage =
      event.httpStatus === 429
        ? `Rate limit reached for model \`${model}\` — tokens per day (TPD) limit exceeded`
        : "Internal server error";
  } else {
    event.promptTokens = promptTokens;
    event.completionTokens = completionTokens;
    event.totalTokens = totalTokens;
    event.finishReason = "stop";
    event.dailyCapForModel = DAILY_CAPS[model];
  }

  events.push(event);
}

events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
for (const e of events) {
  process.stdout.write(JSON.stringify(e) + "\n");
}
