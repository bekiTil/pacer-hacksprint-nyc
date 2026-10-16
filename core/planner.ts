// Owner: Yared (Engine). Cross-track export: planTask (plugin pacer_plan; executor).
// Turns a profile + budget + scorecard into a tiered plan.
import type { Difficulty, Plan, ScorecardEntry, Step, Strategy, TaskType, Tier } from './types';
import { TIER_ORDER } from './types';
import { costUsd } from './models';
import { filesTokenEstimate, profileTask, type Profile } from './profiler';
import { getScorecard } from './scorecard';

export const RESERVE_FRACTION = 0.3; // budget held back for escalations
const PLAN_OUTPUT_TOKENS = 600;
const LEARNED_MIN_RUNS = 2;
const LEARNED_MIN_PASS = 0.8;

function coldImplementTier(difficulty: Difficulty): Tier {
  return difficulty <= 3 ? 'haiku' : difficulty === 4 ? 'sonnet' : 'opus';
}

/** Cheapest tier the scorecard trusts for this task type, else null (fall back to cold). */
export function learnedTier(scorecard: ScorecardEntry[], taskType: TaskType): Tier | null {
  for (const tier of TIER_ORDER) {
    const e = scorecard.find((s) => s.taskType === taskType && s.tier === tier);
    if (e && e.runs >= LEARNED_MIN_RUNS && e.passRate >= LEARNED_MIN_PASS) return tier;
  }
  return null;
}

/** Estimated $ for one step: input = prompt + files (+ handoff), output = estimate. */
export function estimateStepCost(tier: Tier, inTokens: number, outTokens: number): number {
  return costUsd(tier, inTokens, outTokens);
}

/** Pure planning from an already-computed profile (used by the executor with known task types). */
export function buildPlan(
  profile: Pick<Profile, 'taskType' | 'difficulty' | 'needsPlan' | 'estOutputTokens'>,
  inputTokens: number,
  budgetUsd: number,
  strategy: Strategy,
  scorecard: ScorecardEntry[],
): Plan {
  const reasons: string[] = [];
  let implTier: Tier;
  let withPlan: boolean;
  if (strategy === 'all-opus' || strategy === 'all-haiku') {
    implTier = strategy === 'all-opus' ? 'opus' : 'haiku';
    withPlan = false;
    reasons.push(`baseline: ${implTier} for everything, one same-tier retry`);
  } else {
    const learned = strategy === 'pacer-learned' ? learnedTier(scorecard, profile.taskType) : null;
    implTier = learned ?? coldImplementTier(profile.difficulty);
    withPlan = profile.needsPlan && profile.difficulty >= 3;
    reasons.push(
      learned
        ? `scorecard: ${learned} passes ${profile.taskType} tasks reliably`
        : `difficulty ${profile.difficulty}/5 → start ${implTier}`,
    );
    if (withPlan) reasons.push('sonnet writes a short plan first');
  }

  const steps: Step[] = [];
  if (withPlan) steps.push({ name: 'plan', tier: 'sonnet', estTokens: inputTokens + PLAN_OUTPUT_TOKENS });
  steps.push({ name: 'implement', tier: implTier, estTokens: inputTokens + profile.estOutputTokens });

  const est = () =>
    steps.reduce(
      (sum, s) => sum + estimateStepCost(s.tier, inputTokens, s.name === 'plan' ? PLAN_OUTPUT_TOKENS : profile.estOutputTokens),
      0,
    );

  // Keep 30% of the budget for fixes: drop the plan step first, then step the implement tier down.
  const usable = budgetUsd * (1 - RESERVE_FRACTION);
  if (strategy.startsWith('pacer')) {
    if (est() > usable && steps[0].name === 'plan') {
      steps.shift();
      reasons.push('budget: skipped plan step');
    }
    const impl = steps[steps.length - 1];
    while (est() > usable && impl.tier !== 'haiku') {
      impl.tier = TIER_ORDER[TIER_ORDER.indexOf(impl.tier) - 1];
      reasons.push(`budget: downgraded implement to ${impl.tier}`);
    }
  }

  return {
    taskType: profile.taskType,
    difficulty: profile.difficulty,
    steps,
    estCostUsd: est(),
    budgetUsd,
    reason: reasons.join('; '),
  };
}

export async function planTask(
  prompt: string,
  files: Record<string, string>,
  budgetUsd: number,
  strategy: Strategy,
): Promise<Plan> {
  const profile = await profileTask(prompt, files);
  const inputTokens = filesTokenEstimate(files) + Math.ceil(prompt.length / 3.5) + 400;
  return buildPlan(profile, inputTokens, budgetUsd, strategy, await getScorecard());
}
