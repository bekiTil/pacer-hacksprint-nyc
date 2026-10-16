// Owner: Yared (Engine). The real Pacer loop:
// profile → plan → [plan step] → implement → Daytona test → (fix on next tier)* → done.
// Steps pass short handoff notes instead of full chat history.
import { randomUUID } from 'node:crypto';
import { context, trace } from '@opentelemetry/api';
import type { BenchTask, Executor, RunEvent, RunOptions, RunResult, StepName, Tier } from './types';
import { ATTR } from './types';
import { callText } from './llm';
import { nextTier } from './models';
import { buildPlan } from './planner';
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

  // One root span per run; every step span is parented to it (works once tracing has a context manager).
  const root = trace.getTracer('pacer').startSpan('pacer.run', { attributes: base });
  const rootCtx = trace.setSpan(context.active(), root);
  const withSpan: typeof baseWithSpan = (name, attrs, fn) => context.with(rootCtx, () => baseWithSpan(name, attrs, fn));

  try {
    // 1. Profile + plan. The bench knows the true task type, so it overrides the profiler's guess.
    // Baselines don't route, so they skip profiling. Pacer pays for its Haiku profile; that overhead is
    // folded into the first step_end so totals stay honest and equal the sum of step_end costs.
    const profile = isPacer
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
    const plan = buildPlan({ ...profile, taskType: task.type }, inputTokens, opts.budgetUsd, opts.strategy, await getScorecard());
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

    // 3. Implement → test → fix loop.
    let tier: Tier = plan.steps.find((s) => s.name === 'implement')!.tier;
    let lastTestOutput = '';
    const maxAttempts = isPacer ? 4 : 2; // baselines: one same-tier retry
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const step: StepName = attempt === 0 ? 'implement' : 'fix';
      if (!tiersTried.includes(tier)) tiersTried.push(tier);
      yield { kind: 'step_start', step, tier };

      const prompt = [
        `TASK:\n${task.prompt}`,
        handoff && `HANDOFF NOTE FROM PREVIOUS STEP:\n${handoff}`,
        `CURRENT FILES:\n${renderFiles(files)}`,
        lastTestOutput && `THE PREVIOUS ATTEMPT FAILED THESE TESTS (tests are hidden; fix the code):\n${lastTestOutput}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const res = await withSpan(`pacer.step.${step}`, { ...base, [ATTR.tier]: tier }, async (span) => {
        const r = await callText({ tier, functionId: step, system: CODER_SYSTEM, prompt, maxOutputTokens: 16000 });
        span.setAttributes({ [ATTR.tokensIn]: r.tokensIn, [ATTR.tokensOut]: r.tokensOut, [ATTR.costUsd]: r.costUsd });
        return r;
      });
      const c = charge(res);
      const parsed = parseFiles(res.text);
      for (const [p, c] of Object.entries(parsed.files)) if (!(p in task.testFiles)) files[p] = c;
      handoff = parsed.handoff || handoff;
      yield { kind: 'step_end', step, tier, ...c, handoff };

      sandbox ??= await openSandbox();
      const test = await withSpan('pacer.sandbox.test', { ...base, [ATTR.tier]: tier }, async (span) => {
        const t = await sandbox!.test(files, task.testFiles, task.testCmd);
        span.setAttributes({ [ATTR.testsPassed]: t.passed });
        return t;
      });
      yield { kind: 'test', tier, passed: test.passed, output: test.output };
      if (test.passed) {
        passed = true;
        break;
      }
      lastTestOutput = test.output;

      if (attempt === maxAttempts - 1) break;
      if (totalCost >= opts.budgetUsd) break; // budget exhausted: stop and report what we have
      if (isPacer) {
        const up = nextTier(tier);
        if (!up) break; // opus failed: give up
        yield { kind: 'escalate', from: tier, to: up, reason: `tests failed on ${tier}` };
        escalations++;
        tier = up;
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
  await recordResult(result);
  yield { kind: 'done', result };
}

export const realExecutor: Executor = {
  run: (task, opts) => runTask(task, opts),
};
