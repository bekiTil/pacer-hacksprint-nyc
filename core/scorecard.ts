// Owner: Yared (Engine). Cross-track exports: recordResult, getScorecard (plugin pacer_log, web UI heatmap).
// STUB: signatures are final, bodies are replaced in Y5 (data/runs.jsonl → data/scorecard.json).
import type { RunResult, ScorecardEntry } from './types';

export async function recordResult(result: RunResult): Promise<void> {
  void result;
}

export async function getScorecard(): Promise<ScorecardEntry[]> {
  return [];
}
