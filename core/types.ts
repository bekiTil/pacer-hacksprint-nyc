// Shared contract between the Engine track (Yared) and the Experience + Observability track (Bereket).
// FROZEN: do not change without both people agreeing. Run `npm run contract` after any change.

export type Tier = 'haiku' | 'sonnet' | 'opus';
export const TIER_ORDER: readonly Tier[] = ['haiku', 'sonnet', 'opus'];

export type TaskType = 'boilerplate' | 'refactor' | 'bugfix' | 'algorithm' | 'tests' | 'docs';
export const TASK_TYPES: readonly TaskType[] = ['boilerplate', 'refactor', 'bugfix', 'algorithm', 'tests', 'docs'];

export type Strategy = 'all-opus' | 'all-haiku' | 'pacer-cold' | 'pacer-learned';
export const STRATEGIES: readonly Strategy[] = ['all-haiku', 'all-opus', 'pacer-cold', 'pacer-learned'];

export type Client = 'web' | 'claude-code' | 'bench';

export type Difficulty = 1 | 2 | 3 | 4 | 5;

/** One step of a decomposed task (user-generated tasks). Tests for step N live in testFile and run
 * together with the tests of all earlier steps, so each step has its own quality gate. */
export interface Subtask {
  title: string;
  description: string;
  kind: TaskType;
  difficulty: Difficulty;
  testFile: string; // e.g. "test_step1.py" (a key of BenchTask.testFiles)
}

/** Loaded from tasks/<id>/ by core/tasks.ts. */
export interface BenchTask {
  id: string; // folder name under tasks/
  title: string;
  type: TaskType;
  difficulty: Difficulty; // human label, for analysis only
  prompt: string; // what the agent is asked to do
  files: Record<string, string>; // starter files, visible to the model (relative path → content)
  testFiles: Record<string, string>; // hidden tests, uploaded only to the sandbox (relative path → content)
  testCmd: string; // e.g. "python -m pytest -q"
  subtasks?: Subtask[]; // present on decomposed (user-generated) tasks
  source?: 'bench' | 'user';
}

/** Shape of tasks/<id>/task.json on disk. */
export interface TaskManifest {
  id: string;
  title: string;
  type: TaskType;
  difficulty: Difficulty;
  prompt: string;
  testCmd: string;
  subtasks?: Subtask[];
  source?: 'bench' | 'user';
}

export type StepName = 'plan' | 'implement' | 'fix';

export interface Step {
  name: StepName;
  tier: Tier;
  estTokens: number;
  subtask?: string; // title of the subtask this step implements (decomposed tasks)
}

export interface Plan {
  taskType: TaskType;
  difficulty: Difficulty; // profiler's estimate
  steps: Step[];
  estCostUsd: number;
  budgetUsd: number;
  reason: string; // one line: why these tiers (shown in UI)
}

export interface TestRunResult {
  passed: boolean;
  output: string; // truncated to ~2000 chars
}

export interface RunResult {
  runId: string;
  taskId: string;
  taskType: TaskType;
  strategy: Strategy;
  client: Client;
  passed: boolean;
  totalCostUsd: number;
  totalTokens: number;
  escalations: number;
  finalTier: Tier;
  tiersTried: Tier[]; // in order, e.g. ['haiku', 'sonnet']
  durationMs: number;
  files: Record<string, string>; // final code (judge.ts reads this)
}

export type RunEvent =
  | { kind: 'plan'; plan: Plan }
  | { kind: 'step_start'; step: StepName; tier: Tier; subtask?: string }
  | { kind: 'step_end'; step: StepName; tier: Tier; tokensIn: number; tokensOut: number; costUsd: number; handoff: string; subtask?: string }
  | { kind: 'test'; tier: Tier; passed: boolean; output: string; subtask?: string }
  | { kind: 'escalate'; from: Tier; to: Tier; reason: string }
  | { kind: 'error'; message: string }
  | { kind: 'done'; result: RunResult };

export interface RunOptions {
  budgetUsd: number;
  strategy: Strategy;
  client: Client;
}

export interface Executor {
  run(task: BenchTask, opts: RunOptions): AsyncIterable<RunEvent>;
}

export interface ScorecardEntry {
  taskType: TaskType;
  tier: Tier;
  runs: number;
  passRate: number; // 0..1
  avgCostUsd: number;
}

/** One line of data/judged.json, written by scripts/judge.ts. */
export interface JudgedResult {
  runId: string;
  taskId: string;
  strategy: Strategy;
  quality: 1 | 2 | 3 | 4 | 5;
  explanation: string;
}

/** POST /api/run body. Response is SSE: each message is `data: <JSON RunEvent>\n\n`, stream ends after `done` or `error`. */
export interface RunRequest {
  taskId: string;
  budgetUsd: number;
  strategy: Strategy;
}

/** Arize span attribute keys. Both tracks must use these constants, never string literals. */
export const ATTR = {
  strategy: 'pacer.strategy',
  client: 'pacer.client',
  runId: 'pacer.run_id',
  escalated: 'pacer.escalated',
  taskId: 'task.id',
  taskType: 'task.type',
  tier: 'model.tier',
  costUsd: 'cost.usd',
  tokensIn: 'tokens.in',
  tokensOut: 'tokens.out',
  testsPassed: 'tests.passed',
} as const;

export type SpanAttrs = Record<string, string | number | boolean>;

/** Minimal span handle passed to withSpan callbacks (an OpenTelemetry Span satisfies this). */
export interface SpanHandle {
  setAttributes(attrs: SpanAttrs): unknown;
}

/** Data files (paths relative to repo root). */
export const DATA = {
  runs: 'data/runs.jsonl', // RunResult per line (Yared: scorecard.ts)
  scorecard: 'data/scorecard.json', // ScorecardEntry[] (Yared: scorecard.ts)
  results: 'data/results.json', // RunResult[] (Yared: bench.ts)
  judged: 'data/judged.json', // JudgedResult[] (Bereket: judge.ts)
} as const;

export const TASKS_DIR = 'tasks';
