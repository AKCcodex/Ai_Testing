# AI Testing Suite

Eight small, focused projects covering the major disciplines of testing and monitoring LLM-powered systems — from basic prompt regression through security, reliability, and production observability. Built to run entirely on **free APIs** (Groq's free tier), validated against the real Promptfoo CLI rather than just checked for valid YAML, and each one includes a working example run, not just a template.

![Cost](https://img.shields.io/badge/API%20cost-%240.00-blue) ![Provider](https://img.shields.io/badge/provider-Groq-orange) ![Projects](https://img.shields.io/badge/projects-8-informational)

---

## Why this exists

Shipping an LLM feature isn't like shipping a function with a fixed return value — the same prompt can behave differently after a model update, drift under adversarial input, contradict itself across paraphrases, or quietly blow through a rate limit in production. Each project here targets one specific way that can go wrong, with a runnable test suite (or, for 08, runnable instrumentation) rather than just advice.

---

## The 8 projects

| # | Project | Tests | Key question it answers |
|---|---|---|---|
| 01 | [`prompt-regression-matrix`](./prompt-regression-matrix) | Prompt variants × models, 17 cases | Did this prompt or model change break something that used to work? |
| 02 | [`hallucination-testing-matrix`](./hallucination-testing-matrix) | 6 fabrication categories, 15 cases | Does the model invent facts, citations, or statistics instead of admitting uncertainty? |
| 03 | [`rag-evaluation-matrix`](./rag-evaluation-matrix) | Grounding, noise, conflicts, injection | Does the model actually use retrieved context correctly — and resist a poisoned document? |
| 04 | [`guardrail-testing-matrix`](./guardrail-testing-matrix) | Catch rate + false-positive rate | Does the moderation layer block attacks *and* let legitimate users through? |
| 05 | [`05_Prompt_Injection_Testing`](./05_Prompt_Injection_Testing) | 7 injection techniques, 17 cases | Can the model's instructions be hijacked — directly, or via content it only reads? |
| 06 | [`06_Tool_And_Agent_Testing`](./06_Tool_And_Agent_Testing) | Real function-calling, 14 cases | Does the agent call the right tool, ask before destructive actions, and resist a tool result telling it to do something else? |
| 07 | [`07_Consistency_Testing`](./07_Consistency_Testing) | 5 consistency dimensions, 16 cases | Is the model reliably right, or just right on average? Does it cave under pushback? |
| 08 | [`08_AI_Observability`](./08_AI_Observability) | Production traces, not prompts | Is the deployed system behaving today the way it did yesterday? |

---

## How they relate

```
 PRE-DEPLOYMENT TESTING (01–07)                    POST-DEPLOYMENT (08)
 "is this safe/good enough to ship?"                "is it still behaving now?"

 ┌──────────────────────────────────────┐          ┌───────────────────────┐
 │ 01 Regression   — did it break?      │          │                       │
 │ 02 Hallucination — does it lie?      │          │  08 Observability     │
 │ 03 RAG           — uses context right?│  ship ─▶│  latency, errors,     │
 │ 04 Guardrails    — blocks bad input? │          │  token budget,        │
 │ 05 Injection     — hijackable?       │          │  drift detection      │
 │ 06 Tools/Agents  — acts responsibly? │          │                       │
 │ 07 Consistency   — reliably right?   │          │                       │
 └──────────────────────────────────────┘          └───────────────────────┘
        all Promptfoo-based                          plain Node.js
```

01–07 share one architecture: a `promptfooconfig.yaml` (the test matrix), usually a `redteam.yaml` (auto-generated adversarial cases), one or more `prompts/*.txt` or `*.json` variants to compare, and a `.github/workflows/*.yml` CI gate. 08 is deliberately different — there's no "prompt" to test, just real traffic to watch, so it's an instrumentation library plus analysis scripts instead.

---

## Requirements (same across all 8)

| Requirement | Used by |
|---|---|
| [Node.js 18+](https://nodejs.org) | All 8 projects |
| [Promptfoo](https://www.promptfoo.dev) (`npm install -g promptfoo`) | 01–07 |
| A **free Groq API key** ([console.groq.com](https://console.groq.com)) | All 8 — no card required anywhere in this suite |

```bash
npm install -g promptfoo
export GROQ_API_KEY=gsk_your_key_here
```

Every project also works from a completely cold start with no prior setup beyond this.

---

## Quick start — any project 01–07

```bash
cd 0X_project_name
promptfoo validate                       # confirm the config parses
promptfoo eval -j 1 --delay 3000         # run the test matrix (see note below)
promptfoo view                           # browse results in a local UI
promptfoo redteam run -c redteam.yaml    # run the adversarial probe (where present)
```

`-j 1 --delay 3000` runs one request at a time with a 3-second gap — this keeps every project comfortably under Groq's free-tier per-minute rate limit. It's slower than full concurrency, but reliable.

## Quick start — project 08

```bash
cd 08_AI_Observability
node scripts/generate-demo-traces.js --count 200 > traces/traces.jsonl
node scripts/analyze-traces.js traces/traces.jsonl
node scripts/detect-anomalies.js traces/traces.jsonl
# then open dashboard.html in a browser and load traces/traces.jsonl
```

No Groq key needed to try 08 with demo data — only needed if wiring `lib/observe.js` into real application traffic.

---

## Notes from actually running this suite

A few things surfaced while building and running these that are worth knowing before you dive in:

- **Groq's free tier has both per-minute and per-day token limits, tracked separately per model.** The per-minute one just needs `--delay`; the per-day one needs waiting out (the error message tells you exactly how long). Project 08 exists specifically to catch the daily one *before* it interrupts a run.
- **Model IDs on free-tier providers can be deprecated with real user impact.** This suite originally targeted `llama-3.1-8b-instant` / `llama-3.3-70b-versatile`; Groq deprecated both mid-series in favor of `openai/gpt-oss-20b` / `openai/gpt-oss-120b`. If a project errors with "model does not exist," check [console.groq.com/docs/models](https://console.groq.com/docs/models) for the current lineup and update the `id:` fields in `promptfooconfig.yaml`/`redteam.yaml`.
- **`promptfoo redteam run` may prompt for one-time email verification** the first time you use it — that's Promptfoo's own abuse-prevention step for their hosted attack-generation service, not something these projects impose. `promptfoo eval` never requires this.
- **Every config here was validated against the real Promptfoo CLI**, not just checked for valid YAML — this caught a couple of real bugs along the way (an invalid `policy` plugin syntax, `jailbreak`/`prompt-injection` mistakenly listed as plugins instead of strategies) that a syntax check alone wouldn't have.

---

## Repo structure

```
.
├── prompt-regression-matrix/
├── hallucination-testing-matrix/
├── rag-evaluation-matrix/
├── guardrail-testing-matrix/
├── 05_Prompt_Injection_Testing/
├── 06_Tool_And_Agent_Testing/
├── 07_Consistency_Testing/
├── 08_AI_Observability/
└── README.md          ← this file
```

Each project folder is self-contained with its own README, config, and CI workflow — you can copy any single one out on its own without needing the others.
