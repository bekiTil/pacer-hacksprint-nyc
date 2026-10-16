// Owner: Yared. Benchmark: every task × every strategy through the real executor → data/results.json.
// Usage: npx tsx scripts/bench.ts [--tasks id1,id2] [--strategies all-haiku,pacer-cold] [--concurrency 4] [--budget 1] [--keep-scorecard] [--out data/other.json]
// Strategies run in order (all-haiku, all-opus, pacer-cold, pacer-learned) so pacer-learned
// learns from everything before it. Tasks within a strategy run in parallel.
import '../core/env';
import fs from 'node:fs';
import path from 'node:path';
import type { BenchTask, RunResult, Strategy } from '../core/types';
import { DATA, STRATEGIES } from '../core/types';
import { loadTasks } from '../core/tasks';
import { realExecutor } from '../core/realExecutor';
import { resetScorecard } from '../core/scorecard';
import { initTracing, shutdownTracing } from '../core/tracing';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function runOne(task: BenchTask, strategy: Strategy, budgetUsd: number): Promise<RunResult> {
  const start = Date.now();
  let cost = 0;
  let tokens = 0;
  for await (const e of realExecutor.run(task, { strategy, budgetUsd, client: 'bench' })) {
    if (e.kind === 'step_end') {
      cost += e.costUsd;
      tokens += e.tokensIn + e.tokensOut;
    }
    if (e.kind === 'escalate') console.log(`  ↑ ${task.id} [${strategy}] ${e.from} → ${e.to}`);
    if (e.kind === 'error') console.log(`  ✖ ${task.id} [${strategy}] ${e.message}`);
    if (e.kind === 'done') {
      const r = e.result;
      console.log(`  ${r.passed ? '✅' : '❌'} ${task.id} [${strategy}] $${r.totalCostUsd.toFixed(4)} ${r.tiersTried.join('→')} ${(r.durationMs / 1000).toFixed(0)}s`);
      return r;
    }
  }
  // Executor errored before `done`: record a failed run with what we spent.
  return {
    runId: `error-${start}-${task.id}-${strategy}`,
    taskId: task.id,
    taskType: task.type,
    strategy,
    client: 'bench',
    passed: false,
    totalCostUsd: cost,
    totalTokens: tokens,
    escalations: 0,
    finalTier: 'haiku',
    tiersTried: [],
    durationMs: Date.now() - start,
    files: {},
  };
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function summarize(results: RunResult[], strategies: Strategy[]) {
  const rows = strategies.map((s) => {
    const rs = results.filter((r) => r.strategy === s);
    const pass = rs.filter((r) => r.passed).length;
    const cost = rs.reduce((n, r) => n + r.totalCostUsd, 0);
    return { strategy: s, passRate: `${pass}/${rs.length}`, totalCostUsd: Number(cost.toFixed(4)), avgEscalations: Number((rs.reduce((n, r) => n + r.escalations, 0) / (rs.length || 1)).toFixed(2)) };
  });
  console.table(rows);
  const opus = rows.find((r) => r.strategy === 'all-opus');
  for (const r of rows) {
    if (opus && r.strategy.startsWith('pacer') && opus.totalCostUsd > 0) {
      console.log(`${r.strategy}: ${((1 - r.totalCostUsd / opus.totalCostUsd) * 100).toFixed(0)}% cheaper than all-opus`);
    }
  }
}

async function main() {
  initTracing('pacer-bench');
  const taskFilter = arg('tasks')?.split(',');
  const tasks = loadTasks().filter((t) => !taskFilter || taskFilter.includes(t.id));
  const strategies = (arg('strategies')?.split(',') as Strategy[] | undefined) ?? [...STRATEGIES];
  const concurrency = Number(arg('concurrency') ?? 4);
  const budget = Number(arg('budget') ?? 1);
  if (!process.argv.includes('--keep-scorecard')) resetScorecard();

  console.log(`Bench: ${tasks.length} tasks × ${strategies.join(', ')} (concurrency ${concurrency}, budget $${budget})`);
  const results: RunResult[] = [];
  for (const s of strategies) {
    console.log(`\n== ${s} ==`);
    results.push(...(await pool(tasks, concurrency, (t) => runOne(t, s, budget))));
  }

  const out = path.join(process.cwd(), arg('out') ?? DATA.results);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${results.length} results → ${path.relative(process.cwd(), out)}`);
  summarize(results, strategies);
  await shutdownTracing();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
