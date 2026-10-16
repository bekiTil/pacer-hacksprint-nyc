'use client';

// Owner: Bereket (UI). Pacer dashboard: live run timeline + benchmark results + scorecard heatmap.
// Streams RunEvents from POST /api/run (the shared executor; mock when PACER_MOCK=1).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { STRATEGIES, TASK_TYPES, TIER_ORDER } from '@/core/types';
import type {
  JudgedResult,
  Plan,
  RunEvent,
  RunResult,
  ScorecardEntry,
  Strategy,
  Tier,
} from '@/core/types';

type TaskLite = { id: string; title: string; type: string; difficulty: number; prompt: string };

const TIER_BADGE: Record<Tier, string> = {
  haiku: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40',
  sonnet: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/40',
  opus: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/40',
};

const STRATEGY_LABEL: Record<Strategy, string> = {
  'all-haiku': 'All Haiku',
  'all-opus': 'All Opus',
  'pacer-cold': 'Pacer (cold)',
  'pacer-learned': 'Pacer (learned)',
};

const fmtUsd = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
const fmtTok = (n: number) => n.toLocaleString();

function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold capitalize ${TIER_BADGE[tier]}`}>
      {tier}
    </span>
  );
}

export default function Home() {
  const [tab, setTab] = useState<'run' | 'results'>('run');
  return (
    <div className="mx-auto min-h-screen w-full max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Pacer ⏱️</h1>
        <p className="text-sm opacity-70">
          Budget-aware model planner: cheap model first, upgrade only when the tests say so.
        </p>
      </header>

      <nav className="mb-6 flex gap-2">
        {(['run', 'results'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-foreground text-background'
                : 'border border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10'
            }`}
          >
            {t === 'run' ? 'Live run' : 'Results'}
          </button>
        ))}
      </nav>

      {tab === 'run' ? <RunTab /> : <ResultsTab />}
    </div>
  );
}

function RunTab() {
  const [tasks, setTasks] = useState<TaskLite[]>([]);
  const [taskId, setTaskId] = useState('');
  const [budget, setBudget] = useState(0.5);
  const [strategy, setStrategy] = useState<Strategy>('pacer-cold');
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch('/api/tasks')
      .then((r) => r.json())
      .then((ts: TaskLite[]) => {
        setTasks(ts);
        if (ts.length) setTaskId((cur) => cur || ts[0].id);
      })
      .catch(() => setError('Could not load tasks'));
  }, []);

  const selectedTask = tasks.find((t) => t.id === taskId);
  const runningCost = useMemo(
    () => events.reduce((s, e) => s + (e.kind === 'step_end' ? e.costUsd : 0), 0),
    [events],
  );

  const run = useCallback(async () => {
    if (!taskId || running) return;
    setRunning(true);
    setEvents([]);
    setPlan(null);
    setResult(null);
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, budgetUsd: budget, strategy }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`run failed (${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.replace(/^data: ?/, '').trim();
          if (!line) continue;
          const ev = JSON.parse(line) as RunEvent;
          setEvents((prev) => [...prev, ev]);
          if (ev.kind === 'plan') setPlan(ev.plan);
          else if (ev.kind === 'done') setResult(ev.result);
          else if (ev.kind === 'error') setError(ev.message);
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }, [taskId, budget, strategy, running]);

  const costPct = Math.min(100, budget > 0 ? (runningCost / budget) * 100 : 0);
  const reservePct = 70; // 30% held in reserve → spend line at 70% of budget

  return (
    <div className="flex flex-col gap-6">
      {/* Controls */}
      <section className="rounded-xl border border-black/10 p-4 dark:border-white/15">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Task</span>
            <select
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              disabled={running}
              className="rounded-md border border-black/15 bg-transparent px-2 py-1.5 dark:border-white/20"
            >
              {tasks.map((t) => (
                <option key={t.id} value={t.id} className="text-black">
                  {t.title} · {t.type} · d{t.difficulty}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Budget: {fmtUsd(budget)}</span>
            <input
              type="range"
              min={0.05}
              max={2}
              step={0.05}
              value={budget}
              disabled={running}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="accent-foreground"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <span className="text-sm font-medium">Strategy</span>
          <div className="flex flex-wrap gap-2">
            {STRATEGIES.map((s) => (
              <button
                key={s}
                onClick={() => setStrategy(s)}
                disabled={running}
                className={`rounded-full px-3 py-1 text-sm transition-colors ${
                  strategy === s
                    ? 'bg-foreground text-background'
                    : 'border border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10'
                }`}
              >
                {STRATEGY_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        {selectedTask && <p className="mt-4 text-xs opacity-70">{selectedTask.prompt}</p>}

        <button
          onClick={run}
          disabled={running || !taskId}
          className="mt-4 rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run'}
        </button>
      </section>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Plan card */}
      {plan && (
        <section className="rounded-xl border border-black/10 p-4 dark:border-white/15">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Plan</h2>
            <span className="text-xs opacity-70">
              {plan.taskType} · difficulty {plan.difficulty} · est {fmtUsd(plan.estCostUsd)}
            </span>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            {plan.steps.map((s, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="opacity-40">→</span>}
                <span className="opacity-70">{s.name}</span>
                <TierBadge tier={s.tier} />
              </span>
            ))}
          </div>
          <p className="text-sm italic opacity-80">{plan.reason}</p>
        </section>
      )}

      {/* Cost bar */}
      {(running || events.length > 0) && (
        <section className="rounded-xl border border-black/10 p-4 dark:border-white/15">
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium">Spend</span>
            <span>
              {fmtUsd(runningCost)} / {fmtUsd(budget)}
            </span>
          </div>
          <div className="relative h-3 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/15">
            <div
              className={`h-full rounded-full transition-all ${costPct >= reservePct ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${costPct}%` }}
            />
            <div
              className="absolute top-0 h-full w-px bg-black/50 dark:bg-white/60"
              style={{ left: `${reservePct}%` }}
              title="70% spend line — 30% held in reserve for fixes"
            />
          </div>
        </section>
      )}

      {/* Timeline */}
      {events.length > 0 && (
        <section className="rounded-xl border border-black/10 p-4 dark:border-white/15">
          <h2 className="mb-3 font-semibold">Timeline</h2>
          <ol className="flex flex-col gap-2 text-sm">
            {events.map((e, i) => (
              <TimelineRow key={i} e={e} />
            ))}
          </ol>
        </section>
      )}

      {/* Final result */}
      {result && (
        <section
          className={`rounded-xl border p-4 ${
            result.passed
              ? 'border-emerald-500/40 bg-emerald-500/10'
              : 'border-red-500/40 bg-red-500/10'
          }`}
        >
          <h2 className="mb-2 font-semibold">{result.passed ? '✅ Passed' : '❌ Failed'}</h2>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Stat label="Total cost" value={fmtUsd(result.totalCostUsd)} />
            <Stat label="Tokens" value={fmtTok(result.totalTokens)} />
            <Stat label="Escalations" value={String(result.escalations)} />
            <Stat label="Tiers" value={result.tiersTried.join(' → ')} />
          </div>
        </section>
      )}
    </div>
  );
}

function TimelineRow({ e }: { e: RunEvent }) {
  switch (e.kind) {
    case 'plan':
      return <li className="opacity-60">📋 plan ready</li>;
    case 'step_start':
      return (
        <li className="flex items-center gap-2">
          <span>▶</span>
          <span className="capitalize opacity-70">{e.step}</span>
          <TierBadge tier={e.tier} />
          <span className="opacity-50">running…</span>
        </li>
      );
    case 'step_end':
      return (
        <li className="flex flex-wrap items-center gap-2 border-l-2 border-black/10 pl-3 dark:border-white/15">
          <span className="capitalize font-medium">{e.step}</span>
          <TierBadge tier={e.tier} />
          <span className="opacity-60">
            {fmtTok(e.tokensIn)}+{fmtTok(e.tokensOut)} tok · {fmtUsd(e.costUsd)}
          </span>
          {e.handoff && <span className="w-full truncate text-xs italic opacity-60">↪ {e.handoff}</span>}
        </li>
      );
    case 'test':
      return (
        <li className="flex items-center gap-2">
          <span>{e.passed ? '✅' : '❌'}</span>
          <span className="opacity-70">test on</span>
          <TierBadge tier={e.tier} />
          <span className="truncate text-xs opacity-50">{e.output.split('\n').slice(-1)[0]}</span>
        </li>
      );
    case 'escalate':
      return (
        <li className="flex items-center gap-2 font-medium text-amber-600 dark:text-amber-400">
          <span>⬆</span>
          <TierBadge tier={e.from} />
          <span>→</span>
          <TierBadge tier={e.to} />
          <span className="text-xs font-normal opacity-70">{e.reason}</span>
        </li>
      );
    case 'error':
      return <li className="text-red-600 dark:text-red-400">⚠ {e.message}</li>;
    case 'done':
      return null;
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs opacity-60">{label}</div>
      <div className="font-mono font-semibold">{value}</div>
    </div>
  );
}

/* ----------------------------------------------------------------- Results tab */

type StratAgg = {
  strategy: Strategy;
  label: string;
  runs: number;
  passRate: number;
  totalCost: number;
  avgCost: number;
  avgEscalations: number;
  avgQuality: number;
};

function aggregate(results: RunResult[], judged: JudgedResult[]): StratAgg[] {
  const qById = new Map(judged.map((j) => [j.runId, j.quality]));
  return STRATEGIES.map((s) => {
    const rs = results.filter((r) => r.strategy === s);
    const n = rs.length;
    const passes = rs.filter((r) => r.passed).length;
    const cost = rs.reduce((a, r) => a + r.totalCostUsd, 0);
    const esc = rs.reduce((a, r) => a + r.escalations, 0);
    const quals = rs
      .map((r) => qById.get(r.runId))
      .filter((q): q is 1 | 2 | 3 | 4 | 5 => q !== undefined);
    return {
      strategy: s,
      label: STRATEGY_LABEL[s],
      runs: n,
      passRate: n ? passes / n : 0,
      totalCost: cost,
      avgCost: n ? cost / n : 0,
      avgEscalations: n ? esc / n : 0,
      avgQuality: quals.length ? quals.reduce((a, b) => a + b, 0) / quals.length : 0,
    };
  }).filter((d) => d.runs > 0);
}

function ResultsTab() {
  const [results, setResults] = useState<RunResult[]>([]);
  const [judged, setJudged] = useState<JudgedResult[]>([]);
  const [scorecard, setScorecard] = useState<ScorecardEntry[]>([]);

  useEffect(() => {
    fetch('/api/results')
      .then((r) => r.json())
      .then((d: { results: RunResult[]; judged: JudgedResult[] }) => {
        setResults(d.results);
        setJudged(d.judged);
      })
      .catch(() => {});
    fetch('/api/scorecard')
      .then((r) => r.json())
      .then(setScorecard)
      .catch(() => {});
  }, []);

  const agg = useMemo(() => aggregate(results, judged), [results, judged]);
  const chartData = agg.map((a) => ({
    name: a.label,
    'avg cost ($)': Number(a.avgCost.toFixed(4)),
    'pass rate (%)': Math.round(a.passRate * 100),
    'quality (×20)': Math.round(a.avgQuality * 20),
  }));

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-black/10 p-4 dark:border-white/15">
        <h2 className="mb-3 font-semibold">Cost vs pass rate by strategy</h2>
        {chartData.length === 0 ? (
          <p className="text-sm opacity-60">
            No results yet — run <code>npm run bench</code> to produce <code>data/results.json</code>.
          </p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 12 }} label={{ value: '$', position: 'insideLeft' }} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="avg cost ($)" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" dataKey="pass rate (%)" stroke="#10b981" strokeWidth={2} />
                <Line yAxisId="right" dataKey="quality (×20)" stroke="#3b82f6" strokeWidth={2} strokeDasharray="4 2" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {agg.length > 0 && (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left opacity-60">
                <th className="py-1">Strategy</th>
                <th>Runs</th>
                <th>Pass</th>
                <th>Total $</th>
                <th>Avg esc.</th>
                <th>Quality</th>
              </tr>
            </thead>
            <tbody>
              {agg.map((a) => (
                <tr key={a.strategy} className="border-t border-black/10 dark:border-white/10">
                  <td className="py-1 font-medium">{a.label}</td>
                  <td>{a.runs}</td>
                  <td>{Math.round(a.passRate * 100)}%</td>
                  <td className="font-mono">{fmtUsd(a.totalCost)}</td>
                  <td>{a.avgEscalations.toFixed(1)}</td>
                  <td>{a.avgQuality ? a.avgQuality.toFixed(1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Heatmap scorecard={scorecard} />
    </div>
  );
}

function Heatmap({ scorecard }: { scorecard: ScorecardEntry[] }) {
  const byKey = new Map(scorecard.map((e) => [`${e.taskType}|${e.tier}`, e]));
  const hasData = scorecard.length > 0;

  return (
    <section className="rounded-xl border border-black/10 p-4 dark:border-white/15">
      <h2 className="mb-1 font-semibold">Scorecard heatmap</h2>
      <p className="mb-3 text-xs opacity-60">
        Pass rate per task type × tier. The learned planner starts on the cheapest tier that clears 80%.
      </p>
      {!hasData ? (
        <p className="text-sm opacity-60">No runs recorded yet — run some tasks to fill the scorecard.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th className="p-1 text-left opacity-60">type \ tier</th>
                {TIER_ORDER.map((t) => (
                  <th key={t} className="p-1 capitalize opacity-60">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TASK_TYPES.map((type) => (
                <tr key={type}>
                  <td className="p-1 font-medium">{type}</td>
                  {TIER_ORDER.map((tier) => {
                    const e = byKey.get(`${type}|${tier}`);
                    return (
                      <td key={tier} className="p-1">
                        {e ? (
                          <div
                            className="flex h-12 w-20 flex-col items-center justify-center rounded text-xs text-white"
                            style={{ backgroundColor: `hsl(${Math.round(e.passRate * 120)} 65% 42%)` }}
                            title={`${e.runs} run(s), avg ${fmtUsd(e.avgCostUsd)}`}
                          >
                            <span className="font-semibold">{Math.round(e.passRate * 100)}%</span>
                            <span className="opacity-80">{e.runs}×</span>
                          </div>
                        ) : (
                          <div className="flex h-12 w-20 items-center justify-center rounded bg-black/5 text-xs opacity-40 dark:bg-white/10">
                            —
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
