// Owner: Yared. Run one task through the real executor and print the event stream.
// Usage: npx tsx scripts/run-one.ts <taskId> [strategy] [budgetUsd]
import '../core/env';
import type { Strategy } from '../core/types';
import { loadTask } from '../core/tasks';
import { realExecutor } from '../core/realExecutor';
import { initTracing, shutdownTracing } from '../core/tracing';

async function main() {
  const [taskId = '00-example-bugfix', strategy = 'pacer-cold', budget = '0.5'] = process.argv.slice(2);
  initTracing('pacer-run-one');
  const task = loadTask(taskId);
  for await (const e of realExecutor.run(task, { strategy: strategy as Strategy, budgetUsd: Number(budget), client: 'bench' })) {
    if (e.kind === 'plan') console.log(`PLAN  ${e.plan.steps.map((s) => `${s.name}:${s.tier}`).join(' → ')}  est $${e.plan.estCostUsd.toFixed(4)}  (${e.plan.reason})`);
    else if (e.kind === 'step_start') console.log(`START ${e.step} on ${e.tier}`);
    else if (e.kind === 'step_end') console.log(`END   ${e.step} on ${e.tier}  ${e.tokensIn}+${e.tokensOut} tok  $${e.costUsd.toFixed(5)}  handoff: ${e.handoff.slice(0, 100).replace(/\n/g, ' ')}`);
    else if (e.kind === 'test') console.log(`TEST  ${e.passed ? 'PASS' : 'FAIL'} on ${e.tier}  ${e.output.split('\n').slice(-2).join(' | ')}`);
    else if (e.kind === 'escalate') console.log(`UP    ${e.from} → ${e.to}  (${e.reason})`);
    else if (e.kind === 'error') console.log(`ERROR ${e.message}`);
    else console.log(`DONE  passed=${e.result.passed}  $${e.result.totalCostUsd.toFixed(5)}  tiers=${e.result.tiersTried.join('→')}  ${e.result.durationMs}ms`);
  }
  await shutdownTracing();
}
main().catch((e) => { console.error(e); process.exit(1); });
