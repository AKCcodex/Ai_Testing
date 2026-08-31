# 📡 08 — AI Observability

**Monitors what's actually happening in production, not what should happen before deploy.** Projects 01–07 test prompts before they ship. This one watches real traffic after it ships: logging every call, tracking latency and token spend, and catching regressions and rate-limit risk before they become an outage.

![Status](https://img.shields.io/badge/status-tested-brightgreen) ![Cost](https://img.shields.io/badge/API%20cost-%240.00-blue) ![Provider](https://img.shields.io/badge/provider-Groq-orange)

---

## 📖 Why this project looks different from 01–07

Every earlier project in this series uses Promptfoo to test prompts *before* you ship them — regression testing, red-teaming, RAG evaluation, and so on. That's essential, but it can't catch everything: a model provider silently degrades, your free-tier token budget runs out mid-day, or latency creeps up over hours in a way no single pre-deploy test would ever see.

Observability is the other half. Instead of asking "is this prompt good?", it asks **"is the system, right now, in production, behaving the way it did yesterday?"** This project is plain instrumentation and analysis code, not a Promptfoo config — a different discipline for a different question.

### The direct motivation

This project exists because of something that actually happened earlier in this series: a `promptfoo eval` run hit Groq's free-tier daily token cap mid-run —

```
Rate limit reached for model `llama-3.3-70b-versatile`... on tokens per day (TPD):
Limit 100000, Used 99538, Requested 1103. Please try again in 9m13.824s.
```

That surprise is exactly what a budget tracker should catch **before** it happens, not explain **after** it happens. That's the concrete feature at the center of this project.

---

## 🏗️ Project structure

```
08_AI_Observability/
├── lib/
│   └── observe.js              # instrumentation wrapper for real Groq calls
├── scripts/
│   ├── generate-demo-traces.js # synthetic trace generator (try it without live traffic)
│   ├── analyze-traces.js       # metrics report: latency, errors, token budget
│   └── detect-anomalies.js     # baseline-vs-recent drift detection, CI-gate ready
├── traces/
│   └── traces.jsonl            # demo trace log (regenerate anytime)
├── dashboard.html              # load a traces.jsonl file, see charts
└── .github/workflows/
    └── observability-check.yml  # scheduled anomaly-detection gate
```

---

## ⚙️ How the pieces fit together

```
 real app code                     analysis
┌─────────────────┐   traces.jsonl   ┌──────────────────┐
│  lib/observe.js  │ ───────────────▶│ analyze-traces.js │──▶ terminal report
│  wraps every     │                 └──────────────────┘
│  Groq call       │                 ┌──────────────────┐
└─────────────────┘   traces.jsonl   │detect-anomalies.js│──▶ pass/fail (CI gate)
                     ───────────────▶└──────────────────┘
                     traces.jsonl    ┌──────────────────┐
                     ───────────────▶│  dashboard.html   │──▶ charts in browser
                                     └──────────────────┘
```

`lib/observe.js` is the only piece meant to run in real application code — everything else reads the log it produces.

---

## 🔌 `lib/observe.js` — the instrumentation layer

```js
const { observedGroqCall } = require("./lib/observe");

const result = await observedGroqCall({
  model: "openai/gpt-oss-20b",
  messages: [{ role: "user", content: "Hello" }],
});

console.log(result.output);
```

Every call — success or failure — appends one structured JSON line to `traces/traces.jsonl`:

```json
{"requestId":"...", "timestamp":"...", "model":"openai/gpt-oss-20b", "status":"success",
 "latencyMs":412, "promptTokens":150, "completionTokens":47, "totalTokens":197,
 "dailyCapForModel":200000}
```

On error, it logs the failure (HTTP status, error type, message) and still re-throws — so wrapping a call with this never changes your app's error-handling behavior, it just also logs what happened.

> **This was tested directly**, not just written and assumed correct: the missing-API-key error path was run for real, confirmed it throws correctly, and confirmed the trace line it writes is well-formed JSON before this file was included in the project.

---

## 📊 `scripts/analyze-traces.js` — the metrics report

```bash
node scripts/generate-demo-traces.js --count 200 > traces/traces.jsonl
node scripts/analyze-traces.js traces/traces.jsonl
```

Reports, per model: call volume, error rate and breakdown by error type, latency p50/p95/p99, total tokens used, and — the headline feature — **daily budget usage against Groq's published per-model cap**, with a 🟢/🟡/🔴 marker and an explicit warning once usage crosses 90%:

```
openai/gpt-oss-120b
  Calls:            94 (6 errors, 6.4%)
  Latency p50/p95/p99: 915ms / 2121ms / 3292ms
  Total tokens used: 77,079
  Daily budget:     🟡 77,079 / 100,000 (77.1% used, 22,921 remaining)
```

This is real output from a real run against generated demo data — not a mockup.

---

## 🚨 `scripts/detect-anomalies.js` — drift detection as a CI gate

Splits the trace log into an earlier "baseline" window and a later "recent" window, and flags three kinds of drift with explicit, adjustable thresholds (no hidden statistics):

| Signal | Default threshold | What it catches |
|---|---|---|
| Latency p95 | >50% worse than baseline | The API or your own service getting slower over time |
| Error rate | >5 percentage points worse | Rate limiting starting, or an upstream outage beginning |
| Avg completion length | >±40% shift | A silent model/prompt change — same requests, different-shaped answers |

Exits with code `1` if anything is flagged — built to be a CI gate, not just a report. Both the "should flag" and "should stay quiet" behavior were verified against real generated data before shipping: run against the full demo dataset (which has a deliberately injected regression in its last 15%), it correctly caught all 3 signals; run against a truncated version without that regression window, it correctly stayed quiet on latency and error rate, and correctly caught a secondary, real shift in completion length that's a genuine (if separate) feature of the synthetic data — not a false positive, just a different real pattern in the numbers.

```bash
node scripts/detect-anomalies.js traces/traces.jsonl
# exit code 0 = clean, exit code 1 = anomaly detected
```

---

## 🖥️ `dashboard.html` — visual view

A single self-contained HTML file — open it directly in a browser, no server needed. Click "Choose File," load a `traces.jsonl`, and it renders:

- Overview stats (total calls, error rate, p95 latency, models seen)
- **Budget bars** per model — the same 🟢/🟡/🔴 logic as the CLI report, visually
- Latency-over-time chart (one line per model)
- Cumulative token usage over time (area chart, one series per model)

Charts are rendered client-side with Chart.js from a CDN; nothing is uploaded anywhere, the file never leaves your browser. Structure and embedded JavaScript were both checked for validity (tag balance, syntax) before shipping.

---

## 🎲 Trying it without real traffic

You don't need a Groq key to explore this project — `scripts/generate-demo-traces.js` produces realistic synthetic data:

```bash
node scripts/generate-demo-traces.js --count 200 > traces/traces.jsonl
node scripts/analyze-traces.js traces/traces.jsonl
node scripts/detect-anomalies.js traces/traces.jsonl
# then open dashboard.html and load traces/traces.jsonl
```

Every synthetic event is tagged `"synthetic": true` so it's never confused with real production data. The generator deliberately includes a regression in the last 15% of events (latency creep + error spike) and pushes `gpt-oss-120b` token usage to ~77–84% of its daily cap by the end, so the interesting features of the analysis tools are visible immediately rather than requiring hours of real traffic first.

---

## ✅ Requirements

| Requirement | Why |
|---|---|
| [Node.js 18+](https://nodejs.org) | Runs `lib/observe.js` and all scripts — uses native `fetch`, no extra HTTP library needed |
| A **free Groq API key** ([console.groq.com](https://console.groq.com)) | Only needed for `lib/observe.js` against real traffic — not needed for the demo generator or analysis scripts |

No Promptfoo dependency for this project — it's plain Node.js.

---

## 🚀 Using it for real

```bash
export GROQ_API_KEY=gsk_your_key_here
```

```js
// somewhere in your real application code
const { observedGroqCall } = require("./lib/observe");
const result = await observedGroqCall({ model: "openai/gpt-oss-20b", messages: [...] });
```

Traces accumulate in `traces/traces.jsonl` as your app runs. Periodically (or on a schedule, see the CI workflow):

```bash
node scripts/analyze-traces.js traces/traces.jsonl
node scripts/detect-anomalies.js traces/traces.jsonl
```

---

## 🔁 CI/CD

`.github/workflows/observability-check.yml` runs on a daily schedule (adjustable) and fails the build if `detect-anomalies.js` finds drift. In the shipped version it generates fresh demo data each run so the workflow is runnable out of the box — swap that step for fetching your actual `traces.jsonl` (from S3, a database export, wherever `lib/observe.js` has been writing to in production) to make it monitor real traffic.

---

## 🔧 Extending

- **New signal to track:** add a field to the event object in `lib/observe.js` (e.g. `cacheHit`, `retryCount`), then extend `analyze-traces.js`/`detect-anomalies.js` to report on it
- **Different daily cap:** edit `KNOWN_DAILY_TOKEN_CAPS` in `lib/observe.js` if Groq changes their published limits, or add entries for other providers
- **Alerting instead of just CI-failing:** `detect-anomalies.js` already returns a clean list of anomaly strings before printing — wire that into a Slack webhook or email step in the CI workflow instead of (or alongside) failing the build
- **Real per-request cost tracking:** Groq's free tier means `costUsd` is always 0 here, but the trace schema has room for it — a paid provider's per-token pricing could be added to `lib/observe.js` for real dollar-cost tracking, and `analyze-traces.js` already sums `totalTokens`, so summing a cost field alongside it is a small addition

---

## 📎 Notes

- Groq's published daily token caps (`KNOWN_DAILY_TOKEN_CAPS` in `lib/observe.js`) can change — the values here reflect what's current as of this project's build; verify against [console.groq.com/docs/models](https://console.groq.com/docs/models) if the budget percentages in your reports look off.
- `traces/traces.jsonl` in this repo is demo data, safe to regenerate or delete anytime. In real use, treat your actual trace log as sensitive-ish data (it contains prompt previews) and handle it with the same care as application logs generally.
- This project intentionally has no `redteam.yaml` — unlike 01–07, there's no adversarial-input angle to observability itself; the closest equivalent is `detect-anomalies.js` catching a *symptom* of an attack (e.g. a sudden error-rate spike from being rate-limited by abuse), not testing resistance to one directly.
