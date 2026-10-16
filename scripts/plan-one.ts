// Owner: Yared. Print the plan each strategy produces for a task (Bedrock only, no Daytona).
// Usage: npx tsx scripts/plan-one.ts <taskId> [budgetUsd]
import '../core/env';
import { STRATEGIES } from '../core/types';
import { loadTask } from '../core/tasks';
import { profileTask, filesTokenEstimate } from '../core/profiler';
import { buildPlan } from '../core/planner';
import { getScorecard } from '../core/scorecard';

async function main() {
  const [taskId = '00-example-bugfix', budget = '0.5'] = process.argv.slice(2);
  const task = loadTask(taskId);
  const profile = await profileTask(task.prompt, task.files);
  console.log(`PROFILE ${JSON.stringify({ ...profile, costUsd: profile.costUsd.toFixed(6) })}`);
  const inputTokens = filesTokenEstimate(task.files) + Math.ceil(task.prompt.length / 3.5) + 400;
  const scorecard = await getScorecard();
  for (const s of STRATEGIES) {
    const p = buildPlan({ ...profile, taskType: task.type }, inputTokens, Number(budget), s, scorecard);
    console.log(`${s.padEnd(14)} ${p.steps.map((x) => `${x.name}:${x.tier}`).join(' → ').padEnd(36)} est $${p.estCostUsd.toFixed(5)}  ${p.reason}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
