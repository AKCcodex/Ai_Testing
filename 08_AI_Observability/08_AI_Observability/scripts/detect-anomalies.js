#!/usr/bin/env node
/**
 * scripts/detect-anomalies.js
 *
 * Splits a traces.jsonl file into a "baseline" window (earlier events)
 * and a "recent" window (later events), then flags meaningful drift:
 * latency regressions, error rate spikes, and output-length drift
 * (a cheap proxy for "the model or prompt behind this call changed").
 *
 * All thresholds are simple, explicit, and printed in the output — no
 * hidden statistics. This is meant to be a CI gate: exit code is 1 if
 * any anomaly is flagged, 0 otherwise.
 *
 * Usage:
 *   node scripts/detect-anomalies.js traces/traces.jsonl
 *   node scripts/detect-anomalies.js traces/traces.jsonl --split 0.7
 */

const fs = require("fs");

const args = process.argv.slice(2);
const filePath = args[0] || "traces/traces.jsonl";
const splitIdx = args.indexOf("--split");
const SPLIT = splitIdx !== -1 ? parseFloat(args[splitIdx + 1]) : 0.75;

// Thresholds — explicit and adjustable, not hidden magic numbers
const LATENCY_P95_REGRESSION_PCT = 50; // recent p95 more than 50% worse than baseline p95
const ERROR_RATE_SPIKE_ABS_PCT = 5; // recent error rate more than 5 percentage points above baseline
const TOKEN_LENGTH_DRIFT_PCT = 40; // avg completion tokens shifted more than 40% vs baseline

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const lines = fs.readFileSync(filePath, "utf8").trim().split("\n").filter(Boolean);
const events = lines
  .map((l) => JSON.parse(l))
  .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

if (events.length < 10) {
  console.log("Not enough events for meaningful baseline/recent comparison (need at least 10).");
  process.exit(0);
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, Math.min(idx, sortedArr.length - 1))];
}

function stats(evts) {
  const successes = evts.filter((e) => e.status === "success");
  const errors = evts.filter((e) => e.status === "error");
  const latencies = successes.map((e) => e.latencyMs).sort((a, b) => a - b);
  const completionTokens = successes
    .map((e) => e.completionTokens)
    .filter((t) => typeof t === "number");
  return {
    count: evts.length,
    errorRate: evts.length > 0 ? (errors.length / evts.length) * 100 : 0,
    p95Latency: percentile(latencies, 95),
    avgCompletionTokens:
      completionTokens.length > 0
        ? completionTokens.reduce((a, b) => a + b, 0) / completionTokens.length
        : null,
  };
}

const splitPoint = Math.floor(events.length * SPLIT);
const baselineEvents = events.slice(0, splitPoint);
const recentEvents = events.slice(splitPoint);

const baseline = stats(baselineEvents);
const recent = stats(recentEvents);

console.log("\n" + "=".repeat(70));
console.log("ANOMALY DETECTION — baseline (first " + Math.round(SPLIT * 100) + "%) vs. recent (last " + Math.round((1 - SPLIT) * 100) + "%)");
console.log("=".repeat(70));
console.log(`\nBaseline window: ${baseline.count} events`);
console.log(`Recent window:   ${recent.count} events\n`);

const anomalies = [];

// --- Latency regression ---
if (baseline.p95Latency && recent.p95Latency) {
  const pctChange = ((recent.p95Latency - baseline.p95Latency) / baseline.p95Latency) * 100;
  const flagged = pctChange > LATENCY_P95_REGRESSION_PCT;
  console.log(
    `${flagged ? "🔴" : "🟢"} Latency (p95): ${baseline.p95Latency}ms → ${recent.p95Latency}ms (${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(1)}%)`
  );
  if (flagged) {
    anomalies.push(
      `Latency p95 regressed by ${pctChange.toFixed(1)}% (threshold: ${LATENCY_P95_REGRESSION_PCT}%) — recent calls are meaningfully slower than baseline.`
    );
  }
}

// --- Error rate spike ---
const errorRateDelta = recent.errorRate - baseline.errorRate;
const errorFlagged = errorRateDelta > ERROR_RATE_SPIKE_ABS_PCT;
console.log(
  `${errorFlagged ? "🔴" : "🟢"} Error rate: ${baseline.errorRate.toFixed(1)}% → ${recent.errorRate.toFixed(1)}% (${errorRateDelta >= 0 ? "+" : ""}${errorRateDelta.toFixed(1)} pts)`
);
if (errorFlagged) {
  anomalies.push(
    `Error rate rose by ${errorRateDelta.toFixed(1)} percentage points (threshold: ${ERROR_RATE_SPIKE_ABS_PCT} pts) — check for rate limiting or an upstream issue.`
  );
}

// --- Output length drift ---
if (baseline.avgCompletionTokens && recent.avgCompletionTokens) {
  const pctChange =
    ((recent.avgCompletionTokens - baseline.avgCompletionTokens) / baseline.avgCompletionTokens) * 100;
  const flagged = Math.abs(pctChange) > TOKEN_LENGTH_DRIFT_PCT;
  console.log(
    `${flagged ? "🔴" : "🟢"} Avg completion length: ${baseline.avgCompletionTokens.toFixed(0)} → ${recent.avgCompletionTokens.toFixed(0)} tokens (${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(1)}%)`
  );
  if (flagged) {
    anomalies.push(
      `Average completion length shifted by ${pctChange.toFixed(1)}% (threshold: ±${TOKEN_LENGTH_DRIFT_PCT}%) — possible prompt, model, or behavior change worth investigating.`
    );
  }
}

console.log("\n" + "=".repeat(70));
if (anomalies.length === 0) {
  console.log("\n✅ No anomalies detected.\n");
  process.exit(0);
} else {
  console.log(`\n⚠️  ${anomalies.length} anomaly(ies) detected:\n`);
  anomalies.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
  console.log("");
  process.exit(1);
}
