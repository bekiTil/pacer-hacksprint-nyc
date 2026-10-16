// Owner: Yared (Engine). Cross-track exports: recordResult, getScorecard (plugin pacer_log, web UI heatmap).
// Learns per (taskType, tier) how often that tier's attempt passed, from every recorded run.
import fs from 'node:fs';
import path from 'node:path';
import type { RunResult, ScorecardEntry, TaskType, Tier } from './types';
import { DATA } from './types';

function abs(p: string): string {
  return path.join(process.cwd(), p);
}

function readRuns(): RunResult[] {
  if (!fs.existsSync(abs(DATA.runs))) return [];
  return fs
    .readFileSync(abs(DATA.runs), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RunResult);
}

/**
 * A run that tried [haiku, sonnet] and passed counts as: haiku fail, sonnet pass.
 * Cost per tier is approximated by splitting the run cost evenly over tiers tried.
 */
export function computeScorecard(runs: RunResult[]): ScorecardEntry[] {
  const acc = new Map<string, { taskType: TaskType; tier: Tier; runs: number; passes: number; cost: number }>();
  for (const r of runs) {
    r.tiersTried.forEach((tier, i) => {
      const passed = r.passed && i === r.tiersTried.length - 1;
      const key = `${r.taskType}|${tier}`;
      const e = acc.get(key) ?? { taskType: r.taskType, tier, runs: 0, passes: 0, cost: 0 };
      e.runs += 1;
      e.passes += passed ? 1 : 0;
      e.cost += r.totalCostUsd / r.tiersTried.length;
      acc.set(key, e);
    });
  }
  return [...acc.values()].map((e) => ({
    taskType: e.taskType,
    tier: e.tier,
    runs: e.runs,
    passRate: e.passes / e.runs,
    avgCostUsd: e.cost / e.runs,
  }));
}

export async function recordResult(result: RunResult): Promise<void> {
  fs.mkdirSync(path.dirname(abs(DATA.runs)), { recursive: true });
  fs.appendFileSync(abs(DATA.runs), `${JSON.stringify({ ...result, files: {} })}\n`);
  fs.writeFileSync(abs(DATA.scorecard), JSON.stringify(computeScorecard(readRuns()), null, 2));
}

export async function getScorecard(): Promise<ScorecardEntry[]> {
  return computeScorecard(readRuns());
}

/** Clears learned data (bench uses this so each benchmark starts cold). */
export function resetScorecard(): void {
  for (const p of [DATA.runs, DATA.scorecard]) if (fs.existsSync(abs(p))) fs.rmSync(abs(p));
}
