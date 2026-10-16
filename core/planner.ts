// Owner: Yared (Engine). Cross-track export: planTask (used by the plugin's pacer_plan tool).
// STUB: signature is final, body is replaced in Y3 (profiler + budget/scorecard planning).
import type { Plan, Strategy } from './types';
import { costUsd } from './models';

export async function planTask(
  prompt: string,
  files: Record<string, string>,
  budgetUsd: number,
  strategy: Strategy,
): Promise<Plan> {
  void prompt;
  void files;
  const tier = strategy === 'all-opus' ? 'opus' : strategy === 'all-haiku' ? 'haiku' : 'haiku';
  const steps: Plan['steps'] = [
    { name: 'plan', tier: strategy === 'all-haiku' ? 'haiku' : strategy === 'all-opus' ? 'opus' : 'sonnet', estTokens: 1500 },
    { name: 'implement', tier, estTokens: 4000 },
  ];
  return {
    taskType: 'bugfix',
    difficulty: 2,
    steps,
    estCostUsd: steps.reduce((sum, s) => sum + costUsd(s.tier, s.estTokens * 0.7, s.estTokens * 0.3), 0),
    budgetUsd,
    reason: 'STUB plan: real profiler not wired yet',
  };
}
