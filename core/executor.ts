// Owner: Yared (Engine). Cross-track export: executor (web /api/run, scripts/bench.ts).
// Everyone imports `executor` from here. Until the 1:30 sync it delegates to the mock,
// so the UI switches to the real engine with no code change on Bereket's side.
import type { Executor } from './types';
import { mockExecutor } from './mockExecutor';

export const executor: Executor = mockExecutor;
