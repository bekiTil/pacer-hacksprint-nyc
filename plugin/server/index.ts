// Owner: Bereket (plugin). Pacer MCP server (stdio). Exposes the engine's planTask/runTests/recordResult
// to Claude Code so /pacer can plan → dispatch to tier agents → test in Daytona → escalate → log to Arize.
// Runs under tsx from this repo (relative imports reach ../../core, node_modules resolves upward).
import '../../core/env';
import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { planTask } from '../../core/planner';
import { runTests } from '../../core/sandbox';
import { recordResult } from '../../core/scorecard';
import { initTracing, shutdownTracing, withSpan } from '../../core/tracing';
import { ATTR } from '../../core/types';
import type { RunResult } from '../../core/types';

const STRATEGY = z.enum(['all-haiku', 'all-opus', 'pacer-cold', 'pacer-learned']);
const TASK_TYPE = z.enum(['boilerplate', 'refactor', 'bugfix', 'algorithm', 'tests', 'docs']);
const TIER = z.enum(['haiku', 'sonnet', 'opus']);

initTracing('pacer-mcp');

const server = new McpServer({ name: 'pacer', version: '0.1.0' });

server.registerTool(
  'pacer_plan',
  {
    title: 'Plan a coding task within budget',
    description:
      'Profiles the task with a cheap model and returns a per-step model plan (Haiku/Sonnet/Opus) that fits the budget, keeping ~30% in reserve for fixes. Returns JSON {taskType, difficulty, steps[{name,tier,estTokens}], estCostUsd, budgetUsd, reason}.',
    inputSchema: {
      task: z.string().describe('What to do, e.g. "fix the failing test in tasks/03-bugfix-lru".'),
      budgetUsd: z.number().describe('Dollar budget for the whole task.'),
      strategy: STRATEGY.optional().describe('Planning strategy; defaults to pacer-cold.'),
      files: z
        .record(z.string(), z.string())
        .optional()
        .describe('Relevant file contents the model should see (relative path → content).'),
    },
  },
  async ({ task, budgetUsd, strategy, files }) => {
    const plan = await planTask(task, files ?? {}, budgetUsd, strategy ?? 'pacer-cold');
    return { content: [{ type: 'text', text: JSON.stringify(plan, null, 2) }] };
  },
);

server.registerTool(
  'pacer_test',
  {
    title: 'Run tests in a Daytona sandbox',
    description:
      'Uploads the given files from your working directory to an isolated Daytona sandbox and runs testCmd. Returns PASS/FAIL and the (truncated) test output. The sandbox is always destroyed afterwards.',
    inputSchema: {
      paths: z
        .array(z.string())
        .describe('File paths relative to the working directory to upload (source + test files).'),
      testCmd: z.string().describe('Command to run, e.g. "python -m pytest -q".'),
    },
  },
  async ({ paths, testCmd }) => {
    const files: Record<string, string> = {};
    for (const rel of paths) {
      const abs = path.resolve(process.cwd(), rel);
      files[rel] = fs.readFileSync(abs, 'utf8');
    }
    const res = await runTests(files, {}, testCmd);
    return { content: [{ type: 'text', text: `${res.passed ? 'PASS' : 'FAIL'}\n\n${res.output}` }] };
  },
);

server.registerTool(
  'pacer_log',
  {
    title: 'Record a run result and emit an Arize span',
    description:
      'Appends this run to the scorecard (data/runs.jsonl → scorecard.json) and emits an Arize span tagged pacer.client=claude-code so the Claude Code run shows up alongside the web and bench runs.',
    inputSchema: {
      taskId: z.string(),
      taskType: TASK_TYPE,
      strategy: STRATEGY,
      passed: z.boolean(),
      totalCostUsd: z.number(),
      totalTokens: z.number(),
      escalations: z.number(),
      finalTier: TIER,
      tiersTried: z.array(TIER).describe('Tiers touched in order, e.g. ["haiku","sonnet"].'),
      durationMs: z.number().optional(),
      runId: z.string().optional(),
    },
  },
  async (a) => {
    const result: RunResult = {
      runId: a.runId ?? `cc-${Date.now()}`,
      taskId: a.taskId,
      taskType: a.taskType,
      strategy: a.strategy,
      client: 'claude-code',
      passed: a.passed,
      totalCostUsd: a.totalCostUsd,
      totalTokens: a.totalTokens,
      escalations: a.escalations,
      finalTier: a.finalTier,
      tiersTried: a.tiersTried,
      durationMs: a.durationMs ?? 0,
      files: {},
    };
    await withSpan(
      'pacer.run',
      {
        [ATTR.client]: 'claude-code',
        [ATTR.runId]: result.runId,
        [ATTR.taskId]: result.taskId,
        [ATTR.taskType]: result.taskType,
        [ATTR.strategy]: result.strategy,
        [ATTR.tier]: result.finalTier,
        [ATTR.costUsd]: result.totalCostUsd,
        [ATTR.tokensIn]: result.totalTokens,
        [ATTR.testsPassed]: result.passed,
        [ATTR.escalated]: result.escalations > 0,
      },
      async () => {
        await recordResult(result);
      },
    );
    return { content: [{ type: 'text', text: `logged run ${result.runId} (passed=${result.passed}, $${result.totalCostUsd.toFixed(5)})` }] };
  },
);

async function shutdown() {
  await shutdownTracing();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
  await server.connect(new StdioServerTransport());
}
main().catch((err) => {
  console.error('[pacer-mcp] fatal:', err);
  process.exit(1);
});
