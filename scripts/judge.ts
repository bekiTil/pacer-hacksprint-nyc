// Owner: Bereket (Observability). LLM-as-judge code-quality evals.
// For every passed run in data/results.json, Sonnet scores the final code 1-5. Writes data/judged.json
// for the UI chart and emits an Arize span (pacer.judge) carrying the eval, keyed by pacer.run_id.
// Needs Bedrock creds (AWS_*) and data/results.json (produced by `npm run bench`).
import '../core/env';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { callJson } from '../core/llm';
import { initTracing, shutdownTracing, withSpan } from '../core/tracing';
import { ATTR, DATA } from '../core/types';
import type { JudgedResult, RunResult } from '../core/types';

const QualitySchema = z.object({
  quality: z.number().int().min(1).max(5),
  explanation: z.string(),
});

const abs = (p: string) => path.join(process.cwd(), p);

function filesToText(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([p, c]) => `--- ${p} ---\n${c}`)
    .join('\n\n');
}

async function main() {
  if (!fs.existsSync(abs(DATA.results))) {
    console.error(`No ${DATA.results} — run \`npm run bench\` first.`);
    process.exit(1);
  }
  initTracing('pacer-judge');

  const results: RunResult[] = JSON.parse(fs.readFileSync(abs(DATA.results), 'utf8'));
  const passed = results.filter((r) => r.passed && Object.keys(r.files ?? {}).length > 0);
  console.log(`Judging ${passed.length} passed run(s) of ${results.length} total.`);

  const judged: JudgedResult[] = [];
  for (const r of passed) {
    const { data, tokensIn, tokensOut, costUsd } = await callJson({
      tier: 'sonnet',
      functionId: 'judge.code_quality',
      system:
        'You are a strict senior code reviewer. Score the solution 1 (poor) to 5 (excellent) on ' +
        'readability, idiomatic style, and whether it solves the problem honestly — no hacks, no ' +
        'special-casing or writing to the tests. The code already passed its tests; judge its quality.',
      prompt: `Task type: ${r.taskType}. Rate the code quality of this solution.\n\n${filesToText(r.files)}`,
      schema: QualitySchema,
      schemaHint: '{ "quality": <integer 1-5>, "explanation": "<one short line>" }',
    });

    const jr: JudgedResult = {
      runId: r.runId,
      taskId: r.taskId,
      strategy: r.strategy,
      quality: data.quality as JudgedResult['quality'],
      explanation: data.explanation,
    };
    judged.push(jr);

    await withSpan(
      'pacer.judge',
      {
        [ATTR.runId]: r.runId,
        [ATTR.taskId]: r.taskId,
        [ATTR.taskType]: r.taskType,
        [ATTR.strategy]: r.strategy,
        [ATTR.client]: 'bench',
        [ATTR.costUsd]: costUsd,
        [ATTR.tokensIn]: tokensIn,
        [ATTR.tokensOut]: tokensOut,
        // Eval attributes (judge-specific; not part of the shared ATTR contract).
        'eval.code_quality.score': data.quality,
        'eval.code_quality.label': String(data.quality),
        'eval.code_quality.explanation': data.explanation,
      },
      async () => {},
    );

    console.log(`  ${r.strategy.padEnd(14)} ${r.taskId.padEnd(28)} quality=${data.quality}  ${data.explanation.slice(0, 80)}`);
  }

  fs.writeFileSync(abs(DATA.judged), JSON.stringify(judged, null, 2));
  console.log(`Wrote ${judged.length} eval(s) → ${DATA.judged}`);

  await shutdownTracing();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
