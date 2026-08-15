# Automated Prompt Regression & Red-Teaming Matrix

Regression testing for prompts, built on [Promptfoo](https://www.promptfoo.dev/). Compares
prompt variants across models, checks output quality with deterministic and
LLM-graded assertions, and probes for prompt injection / jailbreak / PII leakage.

## Project layout

```
prompt-regression-matrix/
├── promptfooconfig.yaml       # main eval: prompts x providers x test cases
├── redteam.yaml                # adversarial / red-team probe config
├── prompts/
│   ├── prompt-a-strict.txt     # variant A: strict rules-based system prompt
│   └── prompt-b-fewshot.txt    # variant B: few-shot examples
├── .github/workflows/
│   └── prompt-eval.yml         # CI: runs eval + redteam on every PR touching prompts
└── results/                    # eval output (gitignored, generated at runtime)
```

## Setup (Groq only, free)

This project uses only Groq's free-tier API — no OpenAI, no Anthropic, no
local install needed beyond Promptfoo itself.

1. Install Node.js 18+ and Promptfoo:
   ```bash
   npm install -g promptfoo
   ```

2. Get a free Groq API key:
   - Sign up at https://console.groq.com and create a key
   - `export GROQ_API_KEY=gsk_...`
   - Free tier has generous but real per-minute/per-day rate limits — check
     current numbers on Groq's pricing page since they do change.

That's it — both models under test (`llama-3.1-8b-instant` and
`llama-3.3-70b-versatile`) and the `llm-rubric` judge model all run through
the same Groq key.

## Running the regression matrix

```bash
promptfoo eval
promptfoo view   # opens the colorized side-by-side results UI in your browser
```

This runs every test case in `promptfooconfig.yaml` against both prompt
variants and both providers, producing a matrix of pass/fail results plus
the `llm-rubric` judge's reasoning for each subjective check.

## Running red-team probes

```bash
promptfoo redteam run -c redteam.yaml
promptfoo redteam report
```

This generates adversarial inputs targeting the `purpose` and `policy`
described in `redteam.yaml` (prompt injection, jailbreaks, PII extraction,
scope-creep) and scores how each prompt/provider combination holds up.

## Extending the test set

- Add new cases under `tests:` in `promptfooconfig.yaml`. Each needs `vars`
  (the input the prompt template consumes) and one or more `assert` entries.
- Deterministic checks: `contains`, `not-contains`, `is-json`, `regex`,
  `equals`, `cost`, `latency`.
- Subjective checks: `llm-rubric` with a plain-language description of what
  a good answer looks like — a judge model scores pass/fail against it.
- Add a new prompt variant by dropping a `.txt` file in `prompts/` and
  referencing it under `prompts:` in the config.

## CI/CD

`.github/workflows/prompt-eval.yml` runs both the regression matrix and the
red-team probe on any pull request that touches `promptfooconfig.yaml`,
`redteam.yaml`, or files under `prompts/`. Add `GROQ_API_KEY` as a
repository secret (Settings → Secrets and variables → Actions) for it to
run — it's free, no billing required. Promptfoo exits non-zero when
assertions fail, so a regression automatically blocks the PR. Results are
uploaded as a build artifact for reviewers (PMs, compliance) to download
and inspect without needing local Promptfoo access.

## Notes

- Provider IDs (`groq:llama-3.1-8b-instant`, `groq:llama-3.3-70b-versatile`)
  and model availability change over time — check Groq's model list
  (https://console.groq.com/docs/models) if a run fails with an
  unknown-model error, and update the IDs in both YAML files.
- Free tier comes with rate limits (requests per minute/day). If `promptfoo
  eval` starts failing partway through with 429 errors, you've hit Groq's
  free-tier limit — wait a bit, or reduce the number of test cases /
  `numTests` in `redteam.yaml`.
- The `llm-rubric` judge model is configurable independently of the models
  under test (see `defaultTest.options.provider` in `promptfooconfig.yaml`
  and `redteam.provider` in `redteam.yaml`). This config uses the larger
  70B model as judge and both 8B and 70B as candidates — grading generally
  needs more reasoning headroom than the thing being graded.
