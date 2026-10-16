# Pacer ⏱️

**A budget-aware model planner for coding agents: cheap model first, upgrade only when the tests say so.**

Built at Daytona HackSprint w/ Arize AI, NYC (Oct 16, 2026) by **Yared** and **Bereket**.

---

## The problem

Coding agents make you choose the model yourself. Most people pick the most expensive one (Opus) for everything and burn through budget or session limits. Existing tools don't fix this:

- **Per-request routers** (e.g. Bedrock Intelligent Prompt Routing) only route within one model family and know nothing about *your* work.
- **Budget enforcers** (e.g. l6e) cut you off when you hit the cap. They don't plan for quality.
- **Manual settings** (Opus for planning, Sonnet for execution, per-subagent models) leave every decision to you.

## What Pacer does

1. **Profiles** the task with a cheap model: task type, difficulty, steps, estimated tokens.
2. **Plans** within your budget, assigning **Haiku / Sonnet / Opus** to each step and keeping ~30% in reserve for fixes.
3. **Executes** step by step on **AWS Bedrock**. Steps pass short *handoff notes* to each other instead of the full chat history, which saves tokens.
4. **Tests every implementation in a Daytona sandbox.** If tests fail, the step **moves up a tier** (Haiku → Sonnet → Opus), with the failing test output attached.
5. **Logs everything to Arize** (traces, cost, pass/fail, LLM-as-judge code-quality evals) and builds a **personal model scorecard**, e.g. "Sonnet handles my refactors, bugfixes need Opus". The planner uses the scorecard so the next run starts on the right tier.

Two ways to use it: a **web app** (live run timeline and results dashboard) and a **Claude Code plugin** (`/pacer <task>`).

## Sponsors

| Sponsor | What it does in Pacer |
|---|---|
| **AWS Bedrock** | Every LLM call (Claude Haiku 4.5 / Sonnet 5.5 / Opus 5.5; Haiku 5.5 is blocked on our account) plus the cost model. The plugin runs Claude Code with `CLAUDE_CODE_USE_BEDROCK=1`. |
| **Daytona** | Isolated sandbox per run. Generated code is tested there, and the result decides whether to upgrade the model. |
| **Arize AX** | OpenInference traces of the whole loop, LLM-as-judge quality evals, a strategy comparison dashboard, and the data behind the scorecard. |

## Architecture

```
                 ┌────────────── clients ──────────────┐
                 │  Next.js web app   Claude Code plugin│  scripts/bench.ts
                 └────────┬───────────────────┬─────────┘        │
                          ▼                   ▼                  ▼
   core/profiler ──► core/planner ──► core/executor ──► core/sandbox ──► Daytona
     (Haiku)        (budget + scorecard)   (Bedrock tiers,       (run tests)
                                            escalation loop)
                          │                   │
                          ▼                   ▼
                   core/scorecard ◄──── core/tracing ──► Arize AX (traces + evals)
```

## Setup

```bash
nvm use 22                     # Node 22+
npm install
npm run typecheck && npm run contract   # verifies both tracks still fit together
python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt   # Arize export bridge (Pacer's memory)
cp .env.example .env.local     # fill in the keys below
npm run dev                    # web app → http://localhost:3000
npx tsx scripts/bench.ts       # benchmark: 12 tasks × 4 strategies → data/results.json
npx tsx scripts/judge.ts       # code-quality evals → Arize
claude --plugin-dir ./plugin   # Claude Code plugin, then: /pacer <task>
```

`.env.local`:
```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
DAYTONA_API_KEY=...
ARIZE_SPACE_ID=...
ARIZE_API_KEY=...
ARIZE_PROJECT_NAME=pacer
```

---

# 👥 Team & Ownership (READ THIS FIRST, humans and agents)

| | **Yared** | **Bereket** |
|---|---|---|
| Track | **Engine**: Bedrock, Daytona, planning, scorecard, benchmark | **Experience + Observability**: Arize, benchmark tasks, web UI, Claude Code plugin, judge evals |
| Owns (may edit) | `core/models.ts`, `core/profiler.ts`, `core/planner.ts`, `core/sandbox.ts`, `core/executor.ts`, `core/scorecard.ts`, `scripts/bench.ts`, `data/` | `app/**`, `instrumentation.ts`, `plugin/**`, `tasks/**`, `core/tasks.ts`, `core/tracing.ts`, `core/mockExecutor.ts`, `scripts/judge.ts` |
| Must NOT edit | anything in Bereket's column | anything in Yared's column |
| Shared (both must agree before changing) | `core/types.ts`, `core/env.ts`, `scripts/contract-check.ts`, `package.json`, `README.md`, `CLAUDE.md`, `.env.example`, `tasks/00-example-bugfix/` (format reference) | same |

**Rule:** if you need something changed in the other person's file, tell them (or leave a `// TODO(yared):` / `// TODO(bereket):` comment in *your own* file and message them). Don't edit their file yourself.

## The contract: `core/types.ts` (frozen; it's the source of truth, not this README)

**Already in the repo:** every cross-track function exists with its **final signature**. Some bodies are still stubs; each owner replaces their stub bodies without changing the signatures. So both of you can build and run against the other's code from minute one.

- `core/types.ts`: all shared types. Key ones: `BenchTask`, `Plan`, `Step`, `RunEvent`, `RunOptions`, `RunResult` (includes `tiersTried`), `ScorecardEntry`, `JudgedResult`, `RunRequest`, `TestRunResult`.
- **`ATTR`**: the Arize span attribute keys. Always use `ATTR.costUsd` etc., never string literals.
- **`DATA`**: data file paths (`data/runs.jsonl`, `data/scorecard.json`, `data/results.json`, `data/judged.json`).
- **`STRATEGIES`, `TASK_TYPES`, `TIER_ORDER`**: the canonical lists for UI dropdowns and loops.
- **SSE wire format** (`POST /api/run` with a `RunRequest` body): each message is `data: <JSON RunEvent>\n\n`. The stream always ends with a `done` or `error` event.
- **Event order** guaranteed by any executor: `plan` first. Then for each step, `step_start` → `step_end`. After each implement/fix, a `test` event. On failure, `escalate` (always exactly one tier up). Last comes `done` (or `error`). `done.result.totalCostUsd` = the sum of all `step_end.costUsd`.
- **`core/executor.ts` currently re-exports `mockExecutor`.** Everyone (UI, bench) imports `executor` from `core/executor.ts`. At the 1:30 sync Yared swaps in the real one, and no other file changes.

**Before every push that touches `core/`:** `npm run typecheck && npm run contract` must pass. `npm run contract -- --live` also calls the real Bedrock/Daytona-backed `planTask`/`runTests`.

### Functions Yared's core exports (the plugin and UI call these)
| Function | File | Used by |
|---|---|---|
| `executor: Executor` | `core/executor.ts` | web `app/api/run`, `scripts/bench.ts` |
| `planTask(prompt: string, files: Record<string,string>, budgetUsd: number, strategy: Strategy): Promise<Plan>` | `core/planner.ts` (calls profiler) | plugin MCP `pacer_plan` |
| `runTests(files, testFiles, testCmd): Promise<{passed: boolean; output: string}>` | `core/sandbox.ts` | executor, plugin MCP `pacer_test` |
| `recordResult(r: RunResult): Promise<void>` / `getScorecard(): Promise<ScorecardEntry[]>` | `core/scorecard.ts` | executor, plugin MCP `pacer_log`, web UI heatmap |
| `TIERS`, `costUsd(tier, tokensIn, tokensOut)` | `core/models.ts` | everyone |

### Functions Bereket's core exports
| Function | File | Used by |
|---|---|---|
| `loadTasks(): BenchTask[]`, `loadTask(id): BenchTask` | `core/tasks.ts` | bench, web, judge |
| `initTracing(serviceName)`, `shutdownTracing()`, `withSpan<T>(name, attrs: SpanAttrs, fn: (span: SpanHandle) => Promise<T>): Promise<T>` | `core/tracing.ts` | executor (Yared wraps steps/tests in `withSpan`), bench, MCP server. `withSpan` already creates real OTel spans. Bereket only needs to wire the exporter. |
| `mockExecutor: Executor` | `core/mockExecutor.ts` | re-exported by `core/executor.ts` until 1:30 (already written, emits one escalation) |

**Span attribute names (both use exactly these):** `pacer.strategy`, `pacer.client`, `pacer.run_id`, `task.id`, `task.type`, `model.tier`, `cost.usd`, `tokens.in`, `tokens.out`, `tests.passed`, `pacer.escalated`. LLM calls use `experimental_telemetry: { isEnabled: true, functionId: '<step name>' }`.

---

## 🛠 Yared: Engine track

### Y0. Setup together (11:15–11:35)
- [ ] Enable Bedrock model access for Claude Haiku, Sonnet, Opus. Run `aws bedrock list-inference-profiles --region us-east-1 | grep -i claude` and put the exact IDs in `core/models.ts`.
- [x] `core/types.ts`, stubs for all cross-track functions, `scripts/contract-check.ts` committed (done by Yared, 11:40)

### Y1. `core/models.ts` (11:35–11:45)
- [x] `TIERS: Record<Tier, { modelId: string; inPerMTok: number; outPerMTok: number }>` with Bedrock pricing
- [ ] `nextTier(t)`: haiku→sonnet→opus→null
- [ ] `costUsd(tier, tokensIn, tokensOut)`
- [ ] `model(tier)` returns the `@ai-sdk/amazon-bedrock` model instance
- ✅ **Done when:** a one-off script calls all 3 tiers with "say hi" and prints the cost.

### Y2. `core/sandbox.ts` (11:45–12:10)
- [x] `runTests(files, testFiles, testCmd)`: create a Daytona python sandbox, upload all files (starter + generated + tests), run `testCmd`, return `{passed: exitCode===0, output}` (truncated to 2k chars), **always delete the sandbox in `finally`**
- [ ] Timeout ~60s per test run. Install pytest if the image lacks it.
- [ ] Wrap in `withSpan('sandbox.test', {...})` (temporarily a no-op if Bereket's tracing isn't ready)
- ✅ **Done when:** a task's reference `solution/` passes and its `files/` starter fails, both via `runTests`.

### Y3. `core/profiler.ts` + `core/planner.ts` (12:10–12:50)
- [x] Profiler: Haiku `generateObject` with a zod schema → `{taskType, difficulty, steps[{name, estTokens}]}`
- [x] Planner `planTask(...)`:
  - `all-opus` / `all-haiku`: every step on that tier, no escalation
  - `pacer-cold`: plan step → Sonnet. Implement → Haiku if difficulty ≤ 2, Sonnet if 3–4, Opus if 5.
  - `pacer-learned`: for each step, the cheapest tier with scorecard `passRate ≥ 0.8` for that taskType (falls back to cold defaults when fewer than 2 runs)
  - Keep 30% of the budget in reserve. If the estimated cost exceeds 70% of budget, downgrade the plan step first.
  - Fill `plan.reason` with a one-line human explanation
- ✅ **Done when:** `planTask` returns a sensible plan for 3 different tasks, printed as a table.

### Y4. `core/executor.ts` (12:50–1:30)
- [x] `executor.run(task, opts)` is an async generator yielding `RunEvent`s:
  1. `plan` → yield plan
  2. `plan` step (if present): model writes a short approach note = handoff
  3. `implement`: model gets prompt + starter files + handoff and returns full file contents (structured output `{files: Record<string,string>}`)
  4. `runTests` → yield `test`
  5. On failure: `fix` on `nextTier`, given only the handoff + current files + test output (not the full history). Yield `escalate`. Repeat until it passes, Opus fails, or the budget runs out.
  6. Yield `done` with `RunResult`, then call `recordResult`
- [ ] Every step wrapped in `withSpan` with the agreed attributes
- [ ] Baselines (`all-*`) still get **one** fix retry on the same tier, so the comparison is fair
- ✅ **Done when:** `npx tsx scripts/run-one.ts <taskId> pacer-cold` streams events to the console and passes on 2 tasks, one with an escalation. **→ 1:30 SYNC: change `core/executor.ts` to export the real executor and tell Bereket.**

### Y5. `core/scorecard.ts` (1:30–2:00)
- [x] `recordResult` appends to `data/runs.jsonl` and recomputes `data/scorecard.json` (per taskType × tier: runs, passRate, avgCostUsd). Count a tier as "tried" for every tier a run touched: a fail on the lower tier, a pass on the tier where it ended.
- [ ] `getScorecard()`
- ✅ **Done when:** after running 3 bugfix tasks cold, `pacer-learned` picks a different starting tier than cold for bugfix.

### Y6. `scripts/bench.ts` (2:00–2:30; **final run starts no later than 2:15**)
- [x] Runs all tasks × 4 strategies in order: all-haiku, all-opus, pacer-cold (fills the scorecard), pacer-learned
- [ ] Concurrency limit 4 (Daytona + Bedrock rate limits), `client: 'bench'`
- [ ] Writes `data/results.json` (`RunResult[]`) and prints a summary table: strategy → pass rate, total $, avg escalations
- ✅ **Done when:** results.json exists and Pacer is cheaper than all-opus with a similar pass rate. Commit `data/results.json` so Bereket's chart and judge can use it.

---

### Engine status (Yared, 12:55)
- ✅ Real executor is live: `core/executor.ts` now exports `realExecutor`. Set `PACER_MOCK=1` in `.env.local` to use the mock (saves credits while styling the UI).
- ✅ Verified end to end on Bedrock + Daytona, including haiku → sonnet escalation after failing hidden tests.
- Engine scripts: `npx tsx scripts/run-one.ts <taskId> [strategy] [budget]`, `npx tsx scripts/plan-one.ts <taskId>`, `npm run bench -- [--tasks a,b] [--strategies ...] [--concurrency 4]`
- Each real run takes ~10–30s (sandbox create + LLM). The SSE route should keep the connection open (`export const maxDuration = 300`, `runtime = 'nodejs'`).
- Waiting on: Bereket's 12 tasks in `tasks/`, then the final bench run.

## 🎨 Bereket: Experience + Observability track

### B0. Setup together (11:15–11:35)
- [ ] Repo, `create-next-app` (TS, App Router, Tailwind), install deps, `.env.example`, Arize space and keys
- [x] Next.js scaffold, deps, `.env.example`, `core/types.ts`, `core/mockExecutor.ts`, `core/tasks.ts` loader, example task: **already committed by Yared. Don't re-run create-next-app, just `git pull && npm install`.**
- [ ] Arize space + keys, put them in `.env.local`

### B1. `tasks/` + `core/tasks.ts` (11:35–12:20, **hand off to Yared by 12:20**)
- [ ] 12 Python tasks, 2 per TaskType, difficulty spread 1–5. Include at least 3 multi-file tasks (refactor/bugfix across 2–3 files) and 2 genuinely hard ones (difficulty 5) that Haiku should fail.
- [ ] Layout per task: `tasks/<id>/task.json` (`{id,title,type,difficulty,prompt,testCmd}`), `files/` (starter), `tests/test_*.py` (hidden), `solution/` (reference)
- [ ] Locally: reference solution passes `pytest`, starter fails
- [ ] `loadTasks()` / `loadTask(id)` read the folders into `BenchTask`
- ✅ **Done when:** `npx tsx -e "..."` prints 12 tasks and Yared has pulled them.

### B2. Arize tracing: `core/tracing.ts` + `instrumentation.ts` (12:20–12:50)
- [ ] `instrumentation.ts`: `registerOTel` with `OpenInferenceSimpleSpanProcessor` (`@arizeai/openinference-vercel`) + OTLP proto exporter → `https://otlp.arize.com/v1/traces`, headers `space_id` / `api_key`, resource attr `model_id`/project name `pacer`
- [ ] `core/tracing.ts`: same setup for plain Node (bench script, MCP server) + `withSpan(name, attrs, fn)` helper
- [ ] Flush spans before the bench script and MCP server exit
- ✅ **Done when:** a test AI SDK call shows up in Arize AX with the custom attributes.

### B3. Web UI (12:50–1:30 on mock, then switch to the real executor at 1:30)
- [ ] `app/api/run/route.ts`: POST `{taskId, budgetUsd, strategy}` → SSE stream of `RunEvent`s from `executor.run(..., {client:'web'})`
- [ ] `app/page.tsx`:
  - Task picker (from `loadTasks`), budget slider ($0.05–$2), strategy toggle
  - **Live timeline**: one row per step with a tier badge (Haiku green / Sonnet blue / Opus purple), tokens, $, test ✅/❌, an **escalation arrow** with reason, a running cost bar against budget
  - Plan card showing `plan.reason`
  - **Results tab**: `recharts` chart of cost vs pass rate per strategy from `data/results.json` (`app/api/results/route.ts`), plus judged quality once B5 is done
  - **Scorecard heatmap**: taskType × tier → passRate (from `getScorecard`)
- ✅ **Done when:** a real run on a hard task shows an escalation live in the browser.

### B4. Claude Code plugin: `plugin/` (1:30–2:05)
- [ ] Check the plugin format first (Claude Code `plugin-authoring` skill / docs)
- [ ] `plugin/.claude-plugin/plugin.json` (name `pacer`)
- [ ] `plugin/.mcp.json` → stdio server `npx tsx ${CLAUDE_PLUGIN_ROOT}/server/index.ts`
- [ ] `plugin/server/index.ts` (`@modelcontextprotocol/sdk`), tools:
  - `pacer_plan(task, budgetUsd)` → `planTask` (Yared's)
  - `pacer_test(paths[], testCmd)` → reads those files from the user's cwd → `runTests` in Daytona
  - `pacer_log(result)` → `recordResult` + Arize span with `pacer.client=claude-code`
- [ ] `plugin/agents/pacer-haiku.md`, `pacer-sonnet.md`, `pacer-opus.md` with `model: haiku|sonnet|opus` frontmatter. Each implements one step from a handoff note.
- [ ] `plugin/commands/pacer.md`: the orchestration instructions. Call plan → dispatch each step to the matching pacer-* agent → call `pacer_test` → if it fails, re-dispatch to the next tier with the test output → `pacer_log`.
- ✅ **Done when:** `claude --plugin-dir ./plugin` → `/pacer fix the failing test in tasks/<id>` finishes and the spans appear in Arize tagged `claude-code`.

### B5. `scripts/judge.ts` + Arize dashboard (2:05–2:30)
- [ ] For each `RunResult` in `data/results.json` that passed: Sonnet on Bedrock scores code quality 1–5 (readability, idiomatic, no hacks or test special-casing) with a one-line explanation
- [ ] Log as Arize evals attached to the run (by `pacer.run_id`), and write `data/judged.json` for the UI chart
- [ ] Arize dashboard / saved views: cost, pass rate and avg quality grouped by `pacer.strategy`. Traces filterable by `pacer.client`.
- ✅ **Done when:** the dashboard screenshot shows Pacer's quality ≈ all-opus at lower cost.

---

## ⏱ Schedule & sync points

| Time | Yared | Bereket |
|---|---|---|
| 11:15–11:35 | Y0 together: keys, scaffold, **freeze `core/types.ts`** | B0 together + mock executor |
| 11:35–12:20 | Y1 models, Y2 sandbox | B1 12 tasks + loader |
| **12:20** | 🔄 **SYNC 1:** Bereket pushes tasks, Yared pulls and tests `runTests` on real tasks | |
| 12:20–1:30 | Y3 profiler/planner, Y4 executor | B2 Arize tracing, B3 UI on mock |
| **1:30** | 🔄 **SYNC 2:** real executor ready, UI switches from mock, Bereket starts the plugin against `planTask`/`runTests` | |
| 1:30–2:15 | Y5 scorecard, Y6 bench | B4 plugin |
| **2:15** | 🔄 **SYNC 3:** final bench run starts (Yared). Bereket's judge runs on its output. | B5 judge + dashboard |
| **2:30** | 🧊 **FEATURE FREEZE:** bug fixes only | |
| 2:30–2:50 | README results section + architecture, demo video (both) | |
| **2:50** | 🚀 **SUBMIT** (hard deadline 3:30) | |

## Git workflow
- One repo, commit straight to `main`, **small commits, often**. `git pull --rebase` before every push.
- Only edit files in your own column (see the ownership table). Conflicts should then only happen in shared files.
- Run `npm run typecheck && npm run contract` before pushing anything in `core/`.
- Need a new dependency? `git pull` → `npm install <pkg>` → commit `package.json` + `package-lock.json` immediately, alone, so the lockfile doesn't conflict.
- Commit message prefix: `[engine]` (Yared) or `[ui]` / `[arize]` / `[plugin]` / `[tasks]` (Bereket).
- Never commit `.env.local` or keys.

## Cut order if behind schedule
1. Session-window budget mode (stretch, only if well ahead)
2. Scorecard heatmap in the UI
3. Judge script (keep pass rate + cost)
4. Live SSE streaming (show the finished timeline instead)

**Never cut:** the escalation loop, Daytona testing, Arize traces, the Claude Code plugin, the results chart.

## Demo script (2 min)
1. **Problem** (15s): "Opus for everything burns your budget. Picking models by hand is tedious."
2. **Web run** (40s): a hard task. Haiku tries, the Daytona test fails, it moves up to Sonnet and passes. Cost is shown against budget.
3. **Claude Code** (25s): `/pacer` on the same kind of task, inside the tool devs already use
4. **Arize** (20s): the full trace (plan → implement → sandbox test → escalate) and the quality evals by strategy
5. **Results** (20s): the chart. Pacer matches all-opus quality at X% of the cost, and the learned scorecard brings cost down further.
