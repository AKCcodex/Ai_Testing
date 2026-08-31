#!/usr/bin/env node
/**
 * scripts/analyze-traces.js
 *
 * Reads a traces.jsonl file (produced by lib/observe.js in real use, or
 * scripts/generate-demo-traces.js for a demo) and prints a metrics
 * report: call volume, error rate, latency percentiles, token usage,
 * and — the most directly useful part — how close each model is to
 * Groq's free-tier daily token cap.
 *
 * Usage:
 *   node scripts/analyze-traces.js traces/traces.jsonl
 */

const fs = require("fs");

const filePath = process.argv[2] || "traces/traces.jsonl";
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  console.error("Run 'node scripts/generate-demo-traces.js > traces/traces.jsonl' for demo data,");
  console.error("or point this at a real trace log produced by lib/observe.js.");
  process.exit(1);
}

const lines = fs.readFileSync(filePath, "utf8").trim().split("\n").filter(Boolean);
const events = lines.map((l) => JSON.parse(l));

if (events.length === 0) {
  console.error("No events found in the trace file.");
  process.exit(1);
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, Math.min(idx, sortedArr.length - 1))];
}

// --- Overall stats ---
const total = events.length;
const errors = events.filter((e) => e.status === "error");
const successes = events.filter((e) => e.status === "success");
const errorRate = (errors.length / total) * 100;

const isSynthetic = events.some((e) => e.synthetic);

console.log("\n" + "=".repeat(70));
console.log("AI OBSERVABILITY REPORT" + (isSynthetic ? "  (synthetic demo data)" : ""));
console.log("=".repeat(70));

console.log(`\nTotal calls:     ${total}`);
console.log(`Successes:       ${successes.length}`);
console.log(`Errors:          ${errors.length} (${errorRate.toFixed(1)}%)`);

if (events.length > 0) {
  const timestamps = events.map((e) => new Date(e.timestamp).getTime()).sort((a, b) => a - b);
  const spanMs = timestamps[timestamps.length - 1] - timestamps[0];
  const spanMin = (spanMs / 60000).toFixed(1);
  console.log(`Time span:       ${spanMin} minutes (${new Date(timestamps[0]).toISOString()} → ${new Date(timestamps[timestamps.length - 1]).toISOString()})`);
}

// --- Error breakdown ---
if (errors.length > 0) {
  console.log("\n--- Error breakdown ---");
  const byType = {};
  for (const e of errors) {
    const key = e.errorType || "unknown";
    byType[key] = (byType[key] || 0) + 1;
  }
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }
}

// --- Per-model breakdown ---
const models = [...new Set(events.map((e) => e.model))];

console.log("\n--- Per-model breakdown ---");
for (const model of models) {
  const modelEvents = events.filter((e) => e.model === model);
  const modelSuccesses = modelEvents.filter((e) => e.status === "success");
  const modelErrors = modelEvents.filter((e) => e.status === "error");
  const latencies = modelSuccesses.map((e) => e.latencyMs).sort((a, b) => a - b);
  const totalTokens = modelSuccesses.reduce((sum, e) => sum + (e.totalTokens || 0), 0);
  const cap = modelEvents.find((e) => e.dailyCapForModel)?.dailyCapForModel;

  console.log(`\n  ${model}`);
  console.log(`    Calls:            ${modelEvents.length} (${modelErrors.length} errors, ${((modelErrors.length / modelEvents.length) * 100).toFixed(1)}%)`);
  if (latencies.length > 0) {
    console.log(`    Latency p50/p95/p99: ${percentile(latencies, 50)}ms / ${percentile(latencies, 95)}ms / ${percentile(latencies, 99)}ms`);
  }
  console.log(`    Total tokens used: ${totalTokens.toLocaleString()}`);

  if (cap) {
    const pctUsed = (totalTokens / cap) * 100;
    const marker = pctUsed >= 90 ? "🔴" : pctUsed >= 70 ? "🟡" : "🟢";
    console.log(`    Daily budget:     ${marker} ${totalTokens.toLocaleString()} / ${cap.toLocaleString()} (${pctUsed.toFixed(1)}% used, ${(cap - totalTokens).toLocaleString()} remaining)`);
    if (pctUsed >= 90) {
      console.log(`    ⚠️  Approaching daily token cap — expect 429 rate-limit errors soon if usage continues at this rate.`);
    }
  }
}

console.log("\n" + "=".repeat(70) + "\n");
