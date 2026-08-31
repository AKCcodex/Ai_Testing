#!/usr/bin/env node
// scripts/analyze-consistency.js
//
// Promptfoo's --repeat / evaluateOptions.repeat runs each test case N times,
// but each repeat is stored as its own separate result row — it does NOT
// automatically aggregate them into a single "consistency score." This
// script does that aggregation: it groups result rows that share the same
// test index, prompt, and provider (differing only in repeat index) and
// reports what fraction of repeats actually passed.
//
// A test with 5/5 repeats passing is fully consistent. A test with 3/5 is
// flagging real instability — the model gave a different (and sometimes
// wrong) answer to the exact same input on 2 out of 5 tries.
//
// Usage:
//   node scripts/analyze-consistency.js results/latest-eval.json

const fs = require("fs");
const path = require("path");

const filePath = process.argv[2] || "results/latest-eval.json";

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  console.error("Run 'promptfoo eval --output results/latest-eval.json' first.");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
const results = data.results?.results || [];

if (results.length === 0) {
  console.error("No results found in the file. Was the eval run successfully?");
  process.exit(1);
}

// Group by (vars minus __repeatIndex, promptIdx, provider label) — repeats
// share everything except vars.__repeatIndex, which Promptfoo injects to
// distinguish repeat runs (confirmed in source: Object.assign(state.vars,
// getEvalRuntimeVars(...))). Using the actual vars content as the group
// key is more robust than relying on a testIdx field that may not be
// present on every row across Promptfoo versions.
const groups = new Map();

for (const row of results) {
  const varsCopy = { ...(row.vars || {}) };
  delete varsCopy.__repeatIndex;
  delete varsCopy.__evalStepId;

  const promptIdx = row.promptIdx ?? 0;
  const providerLabel =
    (typeof row.provider === "string" ? row.provider : row.provider?.label || row.provider?.id) ||
    "unknown-provider";
  const question =
    varsCopy.question || varsCopy.message || JSON.stringify(varsCopy).slice(0, 60);

  const key = `${JSON.stringify(varsCopy)}::${promptIdx}::${providerLabel}`;
  if (!groups.has(key)) {
    groups.set(key, { question, providerLabel, rows: [] });
  }
  groups.get(key).rows.push(row);
}

console.log("\n=== Consistency Report ===\n");

let totalGroups = 0;
let fullyConsistentGroups = 0;
const flagged = [];

for (const [, group] of groups) {
  if (group.rows.length < 2) continue; // not actually repeated — skip
  totalGroups++;

  const passCount = group.rows.filter((r) => {
    const pass = r.success ?? r.gradingResult?.pass;
    return pass === true;
  }).length;
  const total = group.rows.length;
  const pct = Math.round((passCount / total) * 100);

  const label = `${group.providerLabel}`;
  const shortQ =
    group.question.length > 70 ? group.question.slice(0, 67) + "..." : group.question;

  const marker = pct === 100 ? "✅" : pct === 0 ? "❌" : "⚠️ ";
  console.log(`${marker} [${label}] "${shortQ}"`);
  console.log(`    Consistent: ${passCount}/${total} (${pct}%)`);

  if (pct === 100) {
    fullyConsistentGroups++;
  } else {
    flagged.push({ label, question: shortQ, passCount, total, pct });
  }
}

console.log("\n=== Summary ===");
console.log(`Total test/provider groups analyzed: ${totalGroups}`);
console.log(`Fully consistent (100%): ${fullyConsistentGroups}`);
console.log(`Flagged as inconsistent: ${flagged.length}`);

if (flagged.length > 0) {
  console.log("\n=== Flagged for review ===");
  flagged
    .sort((a, b) => a.pct - b.pct)
    .forEach((f) => {
      console.log(`  [${f.label}] ${f.passCount}/${f.total} (${f.pct}%) — "${f.question}"`);
    });
}

console.log("");
