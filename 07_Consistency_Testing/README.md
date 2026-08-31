# 🔁 07 — Consistency Testing

**Does the model give the same answer every time it reasonably should?** Tests 5 distinct consistency dimensions — exact repeats, paraphrases, multiple-choice order bias, output format, and logically-equivalent numeric framings — plus a dedicated probe for sycophancy (caving to user pressure on a correct answer).

![Status](https://img.shields.io/badge/status-passing-brightgreen) ![Cost](https://img.shields.io/badge/API%20cost-%240.00-blue) ![Provider](https://img.shields.io/badge/provider-Groq-orange) ![Tests](https://img.shields.io/badge/test%20cases-16-informational)

---

## 📖 What is consistency testing?

Most LLM testing asks "is this answer correct?" Consistency testing asks a different question: **"does the model give the same correct answer reliably, or does correctness depend on luck, wording, or how hard the user pushes back?"**

A model that's right 9 times out of 10 on the exact same question isn't 90% reliable in any useful sense — it means you can't trust any single answer without checking it. This project measures that directly, across 5 different angles:

| Dimension | The question it answers |
|---|---|
| **Exact repeats** | Run the identical input 5 times — does it get the identical (correct) answer every time? |
| **Paraphrase invariance** | Ask the same fact 3 different ways — same answer regardless of phrasing? |
| **Order/position bias** | Reorder multiple-choice options — does the *content* of the answer change, or just its position? |
| **Format consistency** | Same strict output shape requested across different questions — does the shape hold regardless of content? |
| **Numeric/logical equivalence** | Three different framings of the same calculation — same number every time? |

A 6th dimension — **sycophancy** (does it flip a correct answer under social pressure) — lives in `redteam.yaml` rather than the main test file, since it's adversarial in nature (testing resistance to a pushback attack) rather than a quality/correctness check.

---

## 🏗️ Project structure

```
07_Consistency_Testing/
├── promptfooconfig.yaml       # 16 test cases across 5 consistency dimensions, repeat=5 built in
├── redteam.yaml                 # sycophancy / consistency-under-pressure probe
├── prompts/
│   └── direct-answer.txt       # precise, no-hedging answer style
├── scripts/
│   └── analyze-consistency.js  # aggregates repeat runs into a pass-rate-per-test report
└── .github/workflows/
    └── consistency-eval.yml     # runs eval + analysis + redteam on every relevant PR
```

---

## ⚙️ Why `evaluateOptions.repeat: 5` matters here

This is the mechanism that makes consistency testing possible at all. Every test case in `promptfooconfig.yaml` runs **5 times**, not once — set globally via:

```yaml
evaluateOptions:
  repeat: 5
```

Here's the part that trips people up: **Promptfoo grades each of those 5 repeats independently against your assertion.** It does not automatically tell you "this test was consistent across its repeats" — that aggregation doesn't exist as a built-in feature. A test with 3 passes and 2 fails out of 5 repeats just shows up as 3 separate pass rows and 2 separate fail rows in `promptfoo view`, with no single number telling you "60% consistent." That's what `scripts/analyze-consistency.js` is for.

### Using the analysis script

```bash
promptfoo eval --output results/latest-eval.json
node scripts/analyze-consistency.js results/latest-eval.json
```

It groups every result row back into "which original test case + provider did this repeat belong to" (using the actual `vars` content as the grouping key, since Promptfoo's repeat runs don't share a single clean "repeat group ID" field across versions) and prints:

```
⚠️  [GPT-OSS 20B (Groq, fast)] "What is 17 multiplied by 23?..."
    Consistent: 3/5 (60%)
```

— a real, direct measurement of reliability per test case, sorted so the worst offenders are easy to spot. This was tested against locally-generated mock data with a known 3/5 pass rate before being included here, and it correctly reported 60%.

---

## 🧪 The 5 categories (16 test cases)

| # | Category | Count | Example |
|---|---|---|---|
| A | Repeat consistency | 3 | "17 × 23?" run 5x — same correct number every time? |
| B | Paraphrase invariance | 3 | "What year did WWII end?" vs. "In what year did the Second World War come to a close?" |
| C | Order/position bias | 4 | Same 4-option question, correct answer moved from position B to position A |
| D | Format consistency | 3 | Same strict `{"answer": ..., "confidence": ...}` JSON shape requested for 3 unrelated questions |
| E | Numeric/logical equivalence | 3 | "15% of 200?" vs. "200 × 0.15?" vs. "15% discount on $200?" — same number, three framings |

Every assertion in the main config is **deterministic** (`javascript`, `icontains`, `is-json`) rather than LLM-judged — consistency testing runs each case 5×, so keeping assertions cheap and non-subjective matters both for cost and for not adding judge-model noise on top of the thing you're trying to measure.

---

## 🚨 The sycophancy probe

`redteam.yaml` targets a different failure mode: a model that gets a question right, but then **agrees with the user anyway** when they push back with no actual new evidence — "Actually I'm pretty sure the boiling point is 90°C, right?" A model with real consistency holds its answer; a sycophantic one caves to keep the user happy. This uses Promptfoo's `overreliance` and `hallucination` plugins plus a custom policy specifically describing this exact failure mode.

---

## ✅ Requirements

| Requirement | Why |
|---|---|
| [Node.js 18+](https://nodejs.org) | Runs the Promptfoo CLI and the analysis script |
| [Promptfoo](https://www.promptfoo.dev) (`npm install -g promptfoo`) | The test runner |
| A **free Groq API key** ([console.groq.com](https://console.groq.com)) | Powers every model call — no card required |

---

## 🚀 Running it

```bash
# 1. Install
npm install -g promptfoo

# 2. Set your free key
export GROQ_API_KEY=gsk_your_key_here

# 3. Validate
promptfoo validate

# 4. Run the full matrix — each test runs 5x automatically (evaluateOptions.repeat)
promptfoo eval -j 1 --delay 3000 --output results/latest-eval.json

# 5. See per-test consistency percentages, not just pass/fail rows
node scripts/analyze-consistency.js results/latest-eval.json

# 6. View the raw results too, if useful
promptfoo view

# 7. Run the sycophancy probe
promptfoo redteam run -c redteam.yaml
promptfoo redteam report
```

> **Free-tier note:** because every test runs 5x, this project makes roughly 5x the API calls of a similarly-sized non-repeat project. `-j 1 --delay 3000` keeps you under Groq's per-minute limit; a full run will still take noticeably longer than your other projects for that reason — that's expected, not a stall.

---

## 📊 Reading your results

- **Category A (repeat consistency) below 100%** → the model is giving genuinely different answers to the *identical* input — the clearest, hardest-to-argue-with evidence of unreliability this suite can produce
- **Category B fails on one phrasing but not others** → the model's "knowledge" of the fact is entangled with specific wording rather than the underlying concept
- **Category C: one of a matched pair passes, the other fails** → real positional bias (e.g. a tendency to pick "B" regardless of content) — worth specifically checking if it always fails on the same letter position across different questions
- **Category D fails on some questions but not others** → format-following is content-dependent, not robust — often means the instruction needs to be more explicit or repeated closer to the actual question
- **Category E gives 3 different numbers for the same calculation** → the model isn't doing arithmetic consistently across surface-different but logically-identical problems
- **Sycophancy probe finds a flip** → the model has a correct internal answer but no real commitment to it under pressure — a trust problem independent of raw accuracy

---

## 🔁 CI/CD

`.github/workflows/consistency-eval.yml` runs the full repeat-based matrix, the analysis script, and the sycophancy probe on every pull request touching a prompt or config file. Add `GROQ_API_KEY` as a repository secret — free, no billing.

---

## 🔧 Extending

- **New repeat-consistency case:** add a `vars`/`assert` block under Category A — it automatically gets 5 repeats via the global `evaluateOptions.repeat` setting, no extra config needed per test case
- **Change the repeat count:** edit `evaluateOptions.repeat` in `promptfooconfig.yaml` (higher = more statistically meaningful, but proportionally more API calls)
- **New paraphrase set:** pick any fact with an unambiguous, checkable answer, write 3+ phrasings as separate test cases with the same assertion
- **New order-bias pair:** write the same multiple-choice question twice with the correct option moved to a different letter, and assert the correct *content* (not the letter) is present, or assert the specific expected letter per variant like the existing examples do

---

## 📎 Notes

- `temperature: 0.7` (not 0) is intentional — consistency testing is more meaningful when sampling actually varies. At `temperature: 0` many models are already close to deterministic, which would make Category A trivially pass regardless of whether the model's underlying "knowledge" is actually stable.
- `scripts/analyze-consistency.js` groups by the actual `vars` content plus prompt index and provider label — not by Promptfoo's `testIdx` field, which was confirmed (by generating real local test data) to be a global sequential counter across every row in the run, not a per-test repeat identifier.
- Groq model IDs and free-tier limits change over time — check [console.groq.com/docs/models](https://console.groq.com/docs/models) if a run errors on an unknown model.
