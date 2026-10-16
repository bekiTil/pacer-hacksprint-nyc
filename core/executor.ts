// Owner: Yared (Engine). Cross-track export: executor (web /api/run, scripts/bench.ts).
// Everyone imports `executor` from here. Real engine since the 1:30 sync.
// Set PACER_MOCK=1 to fall back to the mock (e.g. UI work without spending Bedrock/Daytona credits).
import type { Executor } from './types';
import { mockExecutor } from './mockExecutor';
import { realExecutor } from './realExecutor';

export const executor: Executor = process.env.PACER_MOCK === '1' ? mockExecutor : realExecutor;
