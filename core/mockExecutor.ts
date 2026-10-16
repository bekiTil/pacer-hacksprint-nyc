// Owner: Bereket. Fake engine that emits a realistic RunEvent sequence (with one escalation)
// so the UI and plugin can be built before the real executor lands at the 1:30 sync.
import type { BenchTask, Executor, RunEvent, RunOptions, Tier } from './types';
import { costUsd } from './models';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockExecutor: Executor = {
  async *run(task: BenchTask, opts: RunOptions): AsyncIterable<RunEvent> {
    const start = Date.now();
    const runId = `mock-${start}`;
    let total = 0;
    let tokens = 0;
    const step = (tier: Tier, tin: number, tout: number) => {
      const c = costUsd(tier, tin, tout);
      total += c;
      tokens += tin + tout;
      return c;
    };

    yield {
      kind: 'plan',
      plan: {
        taskType: task.type,
        difficulty: task.difficulty,
        steps: [
          { name: 'plan', tier: 'sonnet', estTokens: 1500 },
          { name: 'implement', tier: 'haiku', estTokens: 4000 },
        ],
        estCostUsd: 0.02,
        budgetUsd: opts.budgetUsd,
        reason: 'Mock: Sonnet plans, Haiku implements, 30% held back for fixes',
      },
    };
    await sleep(400);
    yield { kind: 'step_start', step: 'plan', tier: 'sonnet' };
    await sleep(800);
    yield { kind: 'step_end', step: 'plan', tier: 'sonnet', tokensIn: 1200, tokensOut: 300, costUsd: step('sonnet', 1200, 300), handoff: 'Fix the off-by-one in the loop bound.' };
    yield { kind: 'step_start', step: 'implement', tier: 'haiku' };
    await sleep(800);
    yield { kind: 'step_end', step: 'implement', tier: 'haiku', tokensIn: 2500, tokensOut: 900, costUsd: step('haiku', 2500, 900), handoff: 'Changed range(n) to range(n + 1).' };
    await sleep(600);
    yield { kind: 'test', tier: 'haiku', passed: false, output: 'FAILED tests/test_main.py::test_edge_case - AssertionError' };
    yield { kind: 'escalate', from: 'haiku', to: 'sonnet', reason: '1 test failed on haiku' };
    yield { kind: 'step_start', step: 'fix', tier: 'sonnet' };
    await sleep(1000);
    yield { kind: 'step_end', step: 'fix', tier: 'sonnet', tokensIn: 3000, tokensOut: 800, costUsd: step('sonnet', 3000, 800), handoff: 'Handled empty input.' };
    await sleep(600);
    yield { kind: 'test', tier: 'sonnet', passed: true, output: '3 passed in 0.12s' };
    yield {
      kind: 'done',
      result: {
        runId,
        taskId: task.id,
        taskType: task.type,
        strategy: opts.strategy,
        client: opts.client,
        passed: true,
        totalCostUsd: total,
        totalTokens: tokens,
        escalations: 1,
        finalTier: 'sonnet',
        tiersTried: ['haiku', 'sonnet'],
        durationMs: Date.now() - start,
        files: task.files,
      },
    };
  },
};
