// Shared. Smoke test for every cross-track export. Run `npm run typecheck && npm run contract`
// before pushing any change to core/. Works with stubs and with real implementations.
import '../core/env';
import type { RunEvent, RunResult } from '../core/types';
import { ATTR, STRATEGIES, TASK_TYPES, TIER_ORDER } from '../core/types';
import { TIERS, costUsd, nextTier } from '../core/models';
import { loadTask, loadTasks } from '../core/tasks';
import { executor } from '../core/executor';
import { planTask } from '../core/planner';
import { runTests } from '../core/sandbox';
import { getScorecard } from '../core/scorecard';
import { initTracing, shutdownTracing, withSpan } from '../core/tracing';

const live = process.argv.includes('--live'); // --live also calls Bedrock/Daytona-backed functions
let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main() {
  initTracing('pacer-contract-check');

  // models
  check('TIERS has all tiers', TIER_ORDER.every((t) => TIERS[t]?.modelId));
  check('nextTier chain', nextTier('haiku') === 'sonnet' && nextTier('sonnet') === 'opus' && nextTier('opus') === null);
  check('costUsd', costUsd('opus', 1_000_000, 0) === TIERS.opus.inPerMTok);

  // tasks
  const tasks = loadTasks();
  check('loadTasks', tasks.length > 0, `${tasks.length} task(s)`);
  for (const t of tasks) {
    const ok =
      TASK_TYPES.includes(t.type) &&
      [1, 2, 3, 4, 5].includes(t.difficulty) &&
      Object.keys(t.files).length > 0 &&
      Object.keys(t.testFiles).length > 0 &&
      !!t.prompt &&
      !!t.testCmd;
    check(`task ${t.id} well-formed`, ok);
  }
  const task = loadTask(tasks[0].id);

  // executor event sequence
  const events: RunEvent[] = [];
  for await (const e of executor.run(task, { budgetUsd: 0.5, strategy: 'pacer-cold', client: 'bench' })) events.push(e);
  check('first event is plan', events[0]?.kind === 'plan');
  const last = events.at(-1);
  check('last event is done|error', last?.kind === 'done' || last?.kind === 'error');
  if (last?.kind === 'done') {
    const r: RunResult = last.result;
    check('RunResult fields', !!r.runId && r.taskId === task.id && STRATEGIES.includes(r.strategy) && r.tiersTried.length > 0);
    check('RunResult cost matches step_end sum', Math.abs(
      events.reduce((s, e) => s + (e.kind === 'step_end' ? e.costUsd : 0), 0) - r.totalCostUsd) < 1e-9);
    // recordResult is not called here: it would write mock runs into the real scorecard.
  }
  check('every escalate goes up one tier', events.every((e) => e.kind !== 'escalate' || nextTier(e.from) === e.to));

  // planner / sandbox / scorecard / tracing
  if (live) {
    const plan = await planTask(task.prompt, task.files, 0.5, 'pacer-cold');
    check('planTask', plan.steps.length > 0 && plan.budgetUsd === 0.5, plan.reason);
    const res = await runTests(task.files, task.testFiles, task.testCmd);
    check('runTests on starter returns a result', typeof res.passed === 'boolean', res.output.slice(0, 80));
  } else {
    console.log('ℹ️  skipping planTask/runTests live calls (pass --live)');
  }
  const sc = await getScorecard();
  check('getScorecard returns array', Array.isArray(sc));
  const v = await withSpan('contract.check', { [ATTR.client]: 'bench' }, async (span) => {
    span.setAttributes({ [ATTR.testsPassed]: true });
    return 42;
  });
  check('withSpan returns fn result', v === 42);

  await shutdownTracing();
  console.log(failures ? `\n${failures} check(s) failed` : '\nContract OK');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
