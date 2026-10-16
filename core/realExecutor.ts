// Owner: Yared (Engine). The real Pacer loop:
// profile → plan → [plan step] → implement → Daytona test → (fix on next tier)* → done.
// Steps pass short handoff notes instead of full chat history.
import { randomUUID } from 'node:crypto';
import { context, trace } from '@opentelemetry/api';
import type { BenchTask, Executor, RunEvent, RunOptions, RunResult, SpanAttrs, StepName, Subtask, Tier } from './types';
import { ATTR } from './types';
import { callText } from './llm';
import { nextTier } from './models';
import { buildPlan, buildSubtaskPlan } from './planner';
import { filesTokenEstimate, profileTask } from './profiler';
import { openSandbox, type SandboxSession } from './sandbox';
import { getScorecard, recordResult } from './scorecard';
import { withSpan as baseWithSpan } from './tracing';

const CODER_SYSTEM = `You are a precise software engineer working in a small Python repository.
Return the COMPLETE new contents of every file you change, using exactly this format:

<file path="relative/path.py">
...full file contents...
</file>

After the files, add a 1-3 sentence handoff note for the next engineer:
<handoff>what you changed and anything still uncertain</handoff>

Do not modify or create test files. Do not special-case test inputs. No other text.`;

function renderFiles(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([p, c]) => `<file path="${p}">\n${c}\n</file>`)
    .join('\n\n');
}

export function parseFiles(text: string): { files: Record<string, string>; handoff: string } {
  const files: Record<string, string> = {};
  for (const m of text.matchAll(/<file path="([^"]+)">\n?([\s\S]*?)\n?<\/file>/g)) {
    files[m[1].replace(/^\.?\//, '')] = `${m[2].replace(/\s+$/, '')}\n`;
  }
  const handoff = text.match(/<handoff>([\s\S]*?)<\/handoff>/)?.[1].trim() ?? '';
  return { files, handoff };
}

async function* runTask(task: BenchTask, opts: RunOptions): AsyncGenerator<RunEvent> {
  const runId = randomUUID();
  const start = Date.now();
  const isPacer = opts.strategy.startsWith('pacer');
  const base = { [ATTR.runId]: runId, [ATTR.strategy]: opts.strategy, [ATTR.client]: opts.client, [ATTR.taskId]: task.id, [ATTR.taskType]: task.type };

  let totalCost = 0;
  let totalTokens = 0;
  let escalations = 0;
  const tiersTried: Tier[] = [];
  let files = { ...task.files };
  let passed = false;
  let sandbox: SandboxSession | null = null;
  const stepRecords: { subtask: Subtask; tiers: Tier[]; passed: boolean }[] = [];

  // One root span per run; every step span is parented to it (works once tracing has a context manager).
  const root = trace.getTracer('pacer').startSpan('pacer.run', { attributes: base });
  const rootCtx = trace.setSpan(context.active(), root);
  const withSpan: typeof baseWithSpan = (name, attrs, fn) => context.with(rootCtx, () => baseWithSpan(name, attrs, fn));

  try {
    // 1. Profile + plan. The bench knows the true task type, so it overrides the profiler's guess.
    // Baselines don't route, so they skip profiling. Pacer pays for its Haiku profile; that overhead is
    // folded into the first step_end so totals stay honest and equal the sum of step_end costs.
    const subtasks = task.subtasks?.length ? task.subtasks : null;
    const profile = isPacer && !subtasks
      ? await withSpan('pacer.profile', base, () => profileTask(task.prompt, task.files))
      : { taskType: task.type, difficulty: task.difficulty, needsPlan: false, estOutputTokens: 2000, tokensIn: 0, tokensOut: 0, costUsd: 0 };
    let overhead = { tokensIn: profile.tokensIn, tokensOut: profile.tokensOut, costUsd: profile.costUsd };
    const charge = (r: { tokensIn: number; tokensOut: number; costUsd: number }) => {
      const c = { tokensIn: r.tokensIn + overhead.tokensIn, tokensOut: r.tokensOut + overhead.tokensOut, costUsd: r.costUsd + overhead.costUsd };
      overhead = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
      totalCost += c.costUsd;
      totalTokens += c.tokensIn + c.tokensOut;
      return c;
    };
    const inputTokens = filesTokenEstimate(task.files) + Math.ceil(task.prompt.length / 3.5) + 400;
    const plan = subtasks
      ? buildSubtaskPlan({ type: task.type, difficulty: task.difficulty, subtasks }, inputTokens, opts.budgetUsd, opts.strategy, await getScorecard())
      : buildPlan({ ...profile, taskType: task.type }, inputTokens, opts.budgetUsd, opts.strategy, await getScorecard());
    yield { kind: 'plan', plan };

    // 2. Optional planning step → handoff note.
    let handoff = '';
    const planStep = plan.steps.find((s) => s.name === 'plan');
    if (planStep) {
      yield { kind: 'step_start', step: 'plan', tier: planStep.tier };
      const res = await withSpan('pacer.step.plan', { ...base, [ATTR.tier]: planStep.tier }, async (span) => {
        const r = await callText({
          tier: planStep.tier,
          functionId: 'plan',
          maxOutputTokens: 4000,
          system: 'You are a senior engineer. Write a short, concrete implementation plan (max 8 bullet points) for a teammate. Name files and functions. No code.',
          prompt: `TASK:\n${task.prompt}\n\nFILES:\n${renderFiles(task.files)}`,
        });
        span.setAttributes({ [ATTR.tokensIn]: r.tokensIn, [ATTR.tokensOut]: r.tokensOut, [ATTR.costUsd]: r.costUsd });
        return r;
      });
      const c = charge(res);
      handoff = res.text.trim();
      yield { kind: 'step_end', step: 'plan', tier: planStep.tier, ...c, handoff };
    }

    // 3. Implement → test → fix, once per segment. A plain task is one segment tested against all its
    // tests; a decomposed task has one segment per subtask, gated by that step's tests plus all earlier ones.
    const implSteps = plan.steps.filter((s) => s.name === 'implement');
    const segments: { subtask?: Subtask; index: number; tier: Tier; testFiles: Record<string, string>; testCmd: string }[] = subtasks
      ? subtasks.map((st, i) => {
          const names = subtasks.slice(0, i + 1).map((x) => x.testFile);
          return {
            subtask: st,
            index: i,
            tier: implSteps[i].tier,
            testFiles: Object.fromEntries(names.map((n) => [n, task.testFiles[n]])),
            testCmd: `python -m pytest -q ${names.join(' ')}`,
          };
        })
      : [{ index: 0, tier: implSteps[0].tier, testFiles: task.testFiles, testCmd: task.testCmd }];

    passed = true;
    for (const seg of segments) {
      const label = seg.subtask ? `${seg.index + 1}. ${seg.subtask.title}` : undefined;
      const segAttrs: SpanAttrs = seg.subtask ? { 'pacer.subtask': label!, 'pacer.subtask.kind': seg.subtask.kind } : {};
      const segTiers: Tier[] = [];
      let tier = seg.tier;
      let lastTestOutput = '';
      let segPassed = false;
      const maxAttempts = isPacer ? 4 : 2; // baselines: one same-tier retry
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const step: StepName = attempt === 0 ? 'implement' : 'fix';
        if (!tiersTried.includes(tier)) tiersTried.push(tier);
        if (!segTiers.includes(tier)) segTiers.push(tier);
        yield { kind: 'step_start', step, tier, subtask: label };

        const stepList = subtasks
          ? `STEPS:\n${subtasks.map((x, i) => `${i + 1}. ${x.title}: ${x.description}${i < seg.index ? ' (done)' : i === seg.index ? '   <-- IMPLEMENT THIS STEP NOW' : ' (later)'}`).join('\n')}\n\nImplement ONLY the current step and keep earlier steps working. Later steps may stay as stubs.`
          : '';
        const prompt = [
          `TASK:\n${task.prompt}`,
          stepList,
          handoff && `HANDOFF NOTE FROM PREVIOUS STEP:\n${handoff}`,
          `CURRENT FILES:\n${renderFiles(files)}`,
          lastTestOutput && `THE PREVIOUS ATTEMPT FAILED THESE TESTS (tests are hidden; fix the code):\n${lastTestOutput}`,
        ]
          .filter(Boolean)
          .join('\n\n');

        const res = await withSpan(`pacer.step.${step}`, { ...base, ...segAttrs, [ATTR.tier]: tier }, async (span) => {
          const r = await callText({ tier, functionId: step, system: CODER_SYSTEM, prompt, maxOutputTokens: 16000 });
          span.setAttributes({ [ATTR.tokensIn]: r.tokensIn, [ATTR.tokensOut]: r.tokensOut, [ATTR.costUsd]: r.costUsd });
          return r;
        });
        const c = charge(res);
        const parsed = parseFiles(res.text);
        for (const [p, content] of Object.entries(parsed.files)) if (!(p in task.testFiles)) files[p] = content;
        handoff = parsed.handoff || handoff;
        yield { kind: 'step_end', step, tier, ...c, handoff, subtask: label };

        sandbox ??= await openSandbox();
        const test = await withSpan('pacer.sandbox.test', { ...base, ...segAttrs, [ATTR.tier]: tier }, async (span) => {
          const t = await sandbox!.test(files, seg.testFiles, seg.testCmd);
          span.setAttributes({ [ATTR.testsPassed]: t.passed });
          return t;
        });
        yield { kind: 'test', tier, passed: test.passed, output: test.output, subtask: label };
        if (test.passed) {
          segPassed = true;
          break;
        }
        lastTestOutput = test.output;

        if (attempt === maxAttempts - 1) break;
        if (totalCost >= opts.budgetUsd) break; // budget exhausted: stop and report what we have
        if (isPacer) {
          const up = nextTier(tier);
          if (!up) break; // opus failed: give up
          yield { kind: 'escalate', from: tier, to: up, reason: `${label ? `step ${seg.index + 1} ` : ''}tests failed on ${tier}` };
          escalations++;
          tier = up;
        }
      }
      if (seg.subtask) stepRecords.push({ subtask: seg.subtask, tiers: segTiers, passed: segPassed });
      if (!segPassed) {
        passed = false;
        break; // later steps build on this one
      }
    }
  } catch (err) {
    root.setAttributes({ [ATTR.testsPassed]: false });
    root.end();
    yield { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  } finally {
    await sandbox?.close();
  }
  root.setAttributes({ [ATTR.testsPassed]: passed, [ATTR.costUsd]: totalCost, [ATTR.escalated]: escalations > 0 });
  root.end();

  const result: RunResult = {
    runId,
    taskId: task.id,
    taskType: task.type,
    strategy: opts.strategy,
    client: opts.client,
    passed,
    totalCostUsd: totalCost,
    totalTokens,
    escalations,
    finalTier: tiersTried[tiersTried.length - 1] ?? 'haiku',
    tiersTried,
    durationMs: Date.now() - start,
    files,
  };
  if (stepRecords.length) {
    // Decomposed task: the scorecard learns per step kind (algorithm, bugfix, ...), not per whole task.
    for (const [i, r] of stepRecords.entries()) {
      await recordResult({ ...result, runId: `${runId}#${i + 1}`, taskId: `${task.id}#${i + 1}`, taskType: r.subtask.kind, passed: r.passed, tiersTried: r.tiers, escalations: r.tiers.length - 1, finalTier: r.tiers[r.tiers.length - 1], totalCostUsd: totalCost / stepRecords.length, files: {} });
    }
  } else {
    await recordResult(result);
  }
  yield { kind: 'done', result };
}

export const realExecutor: Executor = {
  run: (task, opts) => runTask(task, opts),
};
