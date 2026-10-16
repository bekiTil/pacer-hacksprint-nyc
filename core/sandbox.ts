// Owner: Yared (Engine). Cross-track export: runTests (used by executor and the plugin's pacer_test tool).
// STUB: signature is final, body is replaced in Y2 (Daytona sandbox).
import type { TestRunResult } from './types';

export async function runTests(
  files: Record<string, string>,
  testFiles: Record<string, string>,
  testCmd: string,
): Promise<TestRunResult> {
  return {
    passed: false,
    output: `STUB runTests: would run "${testCmd}" on ${Object.keys(files).length} files + ${Object.keys(testFiles).length} test files in Daytona`,
  };
}
