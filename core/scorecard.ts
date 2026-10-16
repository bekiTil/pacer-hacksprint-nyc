// Owner: Yared (Engine). Cross-track exports: recordResult, getScorecard (plugin pacer_log, web UI heatmap).
// Pacer's memory is Arize: getScorecard() pulls every traced Daytona test (pacer.sandbox.test spans) from
// Arize AX via scripts/arize_scorecard.py and turns them into pass rates per (task/step kind, tier).
// data/runs.jsonl is only a local log; it is used as the source only with PACER_SCORECARD_SOURCE=local.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
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

export type ScorecardSource = 'arize' | 'local';

export function scorecardSource(): ScorecardSource {
  return process.env.PACER_SCORECARD_SOURCE === 'local' ? 'local' : 'arize';
}

const CACHE_MS = 60_000;
let cache: { at: number; entries: ScorecardEntry[] } | null = null;
let lastArizeError: string | null = null;

export function scorecardStatus(): { source: ScorecardSource; error: string | null; cachedAt: number | null } {
  return { source: scorecardSource(), error: lastArizeError, cachedAt: cache?.at ?? null };
}

async function fromArize(): Promise<ScorecardEntry[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.entries;
  if (!process.env.ARIZE_API_KEY || !process.env.ARIZE_SPACE_ID) {
    lastArizeError = 'ARIZE_API_KEY / ARIZE_SPACE_ID not set: no memory, every plan starts cold';
    return [];
  }
  const python = path.join(process.cwd(), '.venv', 'bin', 'python');
  try {
    const { stdout } = await promisify(execFile)(python, [path.join(process.cwd(), 'scripts', 'arize_scorecard.py')], {
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const entries = JSON.parse(stdout.trim().split('\n').at(-1) || '[]') as ScorecardEntry[];
    cache = { at: Date.now(), entries };
    lastArizeError = null;
    return entries;
  } catch (err) {
    lastArizeError = `Arize scorecard export failed: ${String(err).slice(0, 200)}`;
    console.warn(`[scorecard] ${lastArizeError}`);
    return cache?.entries ?? [];
  }
}

export async function getScorecard(): Promise<ScorecardEntry[]> {
  return scorecardSource() === 'local' ? computeScorecard(readRuns()) : fromArize();
}

/** Clears learned data (bench uses this so each benchmark starts cold). */
export function resetScorecard(): void {
  for (const p of [DATA.runs, DATA.scorecard]) if (fs.existsSync(abs(p))) fs.rmSync(abs(p));
}
