# CLAUDE.md: instructions for any Claude agent working in this repo

This is a **two-person hackathon project** with a hard deadline (submit by 2:50 PM, Oct 16 2026). Two people work in this repo at the same time, each with their own Claude agent.

## 1. Before doing anything, read `README.md` → "Team & Ownership"
It lists who owns which files, the frozen type contract, per-task checklists with "Done when" criteria, the schedule, and the sync points.

## 2. Work out which teammate you're helping
- **Yared** → **Engine track**: `core/models.ts`, `core/profiler.ts`, `core/planner.ts`, `core/sandbox.ts`, `core/executor.ts`, `core/scorecard.ts`, `scripts/bench.ts`, `data/`
- **Bereket** → **Experience + Observability track**: `app/**`, `instrumentation.ts`, `plugin/**`, `tasks/**`, `core/tasks.ts`, `core/tracing.ts`, `core/mockExecutor.ts`, `scripts/judge.ts`

Check `git config user.name` or the conversation. **If it's unclear, ask the user before editing anything.**

## 3. Hard rules
- **Only edit files owned by your teammate's track.** If something in the other track needs to change, don't edit it. Tell your user exactly what change to ask the other person for, or leave a `// TODO(yared): ...` / `// TODO(bereket): ...` in a file *your* teammate owns.
- **`core/types.ts` is a frozen contract.** Don't change it unless your user confirms the other teammate agreed. Build against it exactly, using the same field names and the same span attribute names listed in the README.
- **Shared files** (`package.json`, `README.md`, `CLAUDE.md`, `.env.example`): keep edits minimal and additive (e.g. adding one dependency). Pull right before you edit and commit right after, to avoid conflicts.
- Before 1:30 PM, the web UI uses `core/mockExecutor.ts`. After the 1:30 sync it uses `core/executor.ts`.
- `git pull --rebase` before every push. Small commits straight to `main`, prefixed `[engine]`, `[ui]`, `[arize]`, `[plugin]`, or `[tasks]`.
- Never commit secrets (`.env.local`).

## 4. Working style for this hackathon
- Optimize for **working end to end fast**, not polish. Follow the README checklist order and its "Done when" criteria.
- Verify things by running them (`npx tsx ...`, `npm run dev`, real Daytona/Bedrock calls). Don't assume.
- If a task runs past its time box, say so and suggest the next item from the README "Cut order".
- Stack: TypeScript, Next.js App Router, Vercel AI SDK + `@ai-sdk/amazon-bedrock`, `@daytonaio/sdk`, Arize AX via OpenInference/OTLP, `@modelcontextprotocol/sdk`. Bedrock model IDs live only in `core/models.ts`.
