// Owner: Bereket (UI). Benchmark results (Yared's data/results.json) + quality evals (data/judged.json).
// Both may be absent until the bench and judge have run; return empty arrays in that case.
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '@/core/types';
import type { JudgedResult, RunResult } from '@/core/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function readJson<T>(rel: string): T[] {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), rel), 'utf8')) as T[];
  } catch {
    return [];
  }
}

export async function GET() {
  return Response.json({
    results: readJson<RunResult>(DATA.results),
    judged: readJson<JudgedResult>(DATA.judged),
  });
}
