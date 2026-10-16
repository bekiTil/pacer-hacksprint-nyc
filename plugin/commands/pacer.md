---
description: Plan a coding task across Haiku/Sonnet/Opus, test it in a Daytona sandbox, and escalate a tier only when tests fail.
argument-hint: <task description, e.g. "fix the failing test in tasks/03-bugfix-lru">
---

You are the Pacer orchestrator. Run the task **$ARGUMENTS** using the cheapest model that works, escalating only when the Daytona tests say so.

Follow this loop exactly:

1. **Plan.** Call the `pacer_plan` MCP tool with the task and a budget (default `0.5` unless the user gave one). Read back `steps`, their assigned `tier`s, and `reason`. Tell the user the plan in one line.

2. **Implement each step.** For every step in order, dispatch it to the subagent that matches the step's tier:
   - `tier: haiku` → the **pacer-haiku** agent
   - `tier: sonnet` → the **pacer-sonnet** agent
   - `tier: opus` → the **pacer-opus** agent

   Give the agent: the task prompt, the current file contents, and the previous step's one-line **handoff** note (for the first step, the plan's reason). Apply the full file contents it returns to disk, and keep its handoff note for the next step.

3. **Test.** After each implementation (or fix), call `pacer_test` with the paths of the files to upload (your changed source files **and** the test files) and the task's `testCmd` (default `python -m pytest -q`).

4. **Escalate on failure.** If `pacer_test` returns FAIL and there is a higher tier available (haiku → sonnet → opus), dispatch a **fix** step to the next tier up. Give that agent only the handoff note, the current files, and the failing test output — not the whole history. Then test again. Repeat until the tests pass, Opus fails, or you run out of budget.

5. **Log.** Once you stop, call `pacer_log` with the outcome: `taskId`, `taskType`, `strategy` (`pacer-cold`), `passed`, `totalCostUsd`, `totalTokens`, `escalations`, `finalTier`, and `tiersTried` (every tier touched, in order). This records the run to the scorecard and sends an Arize span tagged `claude-code`.

Report to the user: the final tier that passed, the total cost, and how many escalations it took.
