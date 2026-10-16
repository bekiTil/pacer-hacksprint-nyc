// Owner: Yared (Engine). Cross-track export: planTask (plugin pacer_plan; executor).
// Turns a profile + budget + scorecard into a tiered plan.
import type { Difficulty, Plan, ScorecardEntry, Step, Strategy, Subtask, TaskType, Tier } from './types';
import { TIER_ORDER } from './types';
import { costUsd } from './models';
import { filesTokenEstimate, profileTask, type Profile } from './profiler';
import { getScorecard, scorecardSource } from './scorecard';

export const RESERVE_FRACTION = 0.3; // budget held back for escalations
const PLAN_OUTPUT_TOKENS = 600;
const LEARNED_MIN_RUNS = 2;
// Starting cheap and escalating on failure beats starting expensive whenever the cheap tier passes
// at least about half the time, so that is the bar for "start here".
const LEARNED_MIN_PASS = 0.5;
const LEARNED_SKIP_PLAN_PASS = 0.8;

function coldImplementTier(difficulty: Difficulty): Tier {
  return difficulty <= 3 ? 'haiku' : 'sonnet'; // opus is only reached by escalation
}

function entry(scorecard: ScorecardEntry[], taskType: TaskType, tier: Tier) {
  return scorecard.find((s) => s.taskType === taskType && s.tier === tier);
}

/** Cheapest tier with enough history that passes this task type at least half the time, else null (cold). */
export function learnedTier(scorecard: ScorecardEntry[], taskType: TaskType): Tier | null {
  for (const tier of TIER_ORDER) {
    const e = entry(scorecard, taskType, tier);
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
    // A separate Sonnet plan only pays off on hard tasks, and not when history says the
    // starting tier already handles this task type on its own.
    const reliable = learned && (entry(scorecard, profile.taskType, learned)?.passRate ?? 0) >= LEARNED_SKIP_PLAN_PASS;
    withPlan = profile.needsPlan && profile.difficulty >= 4 && !reliable;
    const e = learned ? entry(scorecard, profile.taskType, learned) : undefined;
    reasons.push(
      learned && e
        ? `${scorecardSource() === 'arize' ? 'Arize traces' : 'local scorecard'}: ${learned} passed ${Math.round(e.passRate * 100)}% of ${e.runs} ${profile.taskType} tests → start ${learned}`
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

/** Plan for a decomposed task: one implement step per subtask, each on its own tier. */
export function buildSubtaskPlan(
  task: { type: TaskType; difficulty: Difficulty; subtasks: Subtask[] },
  inputTokens: number,
  budgetUsd: number,
  strategy: Strategy,
  scorecard: ScorecardEntry[],
): Plan {
  const reasons: string[] = [];
  const steps: Step[] = task.subtasks.map((s) => {
    let tier: Tier;
    if (strategy === 'all-opus' || strategy === 'all-haiku') tier = strategy === 'all-opus' ? 'opus' : 'haiku';
    else {
      const learned = strategy === 'pacer-learned' ? learnedTier(scorecard, s.kind) : null;
      tier = learned ?? coldImplementTier(s.difficulty);
      const e = learned ? scorecard.find((x) => x.taskType === s.kind && x.tier === learned) : undefined;
      reasons.push(
        `${s.title}: ${learned && e ? `${scorecardSource() === 'arize' ? 'Arize' : 'scorecard'} says ${tier} passes ${Math.round(e.passRate * 100)}% of ${s.kind} steps` : `d${s.difficulty} → ${tier}`}`,
      );
    }
    return { name: 'implement', tier, estTokens: inputTokens + 1500, subtask: s.title };
  });
  if (!reasons.length) reasons.push(`baseline: ${steps[0]?.tier} for every step, one same-tier retry each`);
  return {
    taskType: task.type,
    difficulty: task.difficulty,
    steps,
    estCostUsd: steps.reduce((n, s) => n + estimateStepCost(s.tier, inputTokens, 1500), 0),
    budgetUsd,
    reason: `${task.subtasks.length} steps, each tested in Daytona before the next · ${reasons.join(' · ')}`,
  };
}
