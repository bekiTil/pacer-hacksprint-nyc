// Owner: Yared (Engine). Daytona quality gate.
// Cross-track export: runTests (one-shot, used by the plugin's pacer_test tool).
// The executor uses openSandbox() to reuse one sandbox across all test runs of a single task run.
import { Daytona, type Sandbox } from '@daytonaio/sdk';
import type { TestRunResult } from './types';

const WORKDIR = 'workspace';
const MAX_OUTPUT = 2000;
const TEST_TIMEOUT_S = 90;

// Daytona org limit is 10 CPUs total; cap concurrent sandboxes so parallel runs queue instead of failing.
const MAX_SANDBOXES = Number(process.env.PACER_MAX_SANDBOXES ?? 4);
let active = 0;
const waiters: (() => void)[] = [];
async function acquire(): Promise<void> {
  if (active < MAX_SANDBOXES) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve)); // slot handed over by release()
}
function release(): void {
  const next = waiters.shift();
  if (next) next();
  else active--;
}

let client: Daytona | null = null;
function daytona(): Daytona {
  if (!process.env.DAYTONA_API_KEY) throw new Error('DAYTONA_API_KEY is not set (.env.local)');
  client ??= new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
  return client;
}

function truncate(s: string, max = MAX_OUTPUT): string {
  return s.length <= max ? s : `${s.slice(0, Math.floor(max * 0.3))}\n...[truncated]...\n${s.slice(-Math.floor(max * 0.7))}`;
}

export interface SandboxSession {
  id: string;
  test(files: Record<string, string>, testFiles: Record<string, string>, testCmd: string, opts?: { maxOutput?: number }): Promise<TestRunResult>;
  close(): Promise<void>;
}

export async function openSandbox(): Promise<SandboxSession> {
  await acquire();
  let sandbox: Sandbox;
  const params = {
    language: 'python',
    autoStopInterval: 15, // safety net if close() never runs
    autoDeleteInterval: 0,
    labels: { app: 'pacer' },
  };
  try {
    try {
      sandbox = await daytona().create(params, { timeout: 120 });
    } catch (err) {
      console.warn(`[sandbox] create failed, retrying once: ${String(err).slice(0, 120)}`);
      sandbox = await daytona().create(params, { timeout: 120 });
    }
  } catch (err) {
    release();
    throw err;
  }
  let closed = false;
  let pytestReady = false;

  return {
    id: sandbox.id,
    async test(files, testFiles, testCmd, opts) {
      if (!pytestReady) {
        await sandbox.process.executeCommand('python -m pytest --version || pip install -q pytest', undefined, undefined, 120);
        pytestReady = true;
      }
      // Fresh workspace each time so files from a previous attempt can't leak into this one.
      await sandbox.process.executeCommand(`rm -rf ${WORKDIR} && mkdir -p ${WORKDIR}`);
      const all = { ...files, ...testFiles }; // tests win on path collision
      const dirs = new Set(
        Object.keys(all)
          .map((p) => p.split('/').slice(0, -1).join('/'))
          .filter(Boolean),
      );
      if (dirs.size) {
        await sandbox.process.executeCommand(`mkdir -p ${[...dirs].map((d) => `'${WORKDIR}/${d}'`).join(' ')}`);
      }
      await sandbox.fs.uploadFiles(
        Object.entries(all).map(([p, content]) => ({ source: Buffer.from(content, 'utf8'), destination: `${WORKDIR}/${p}` })),
      );
      const res = await sandbox.process.executeCommand(testCmd, WORKDIR, undefined, TEST_TIMEOUT_S);
      return { passed: res.exitCode === 0, output: truncate(res.result ?? '', opts?.maxOutput) };
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await sandbox.delete();
      } catch (err) {
        console.warn(`[sandbox] failed to delete ${sandbox.id}: ${String(err)}`);
      } finally {
        release();
      }
    },
  };
}

/** One-shot: create sandbox → upload → run testCmd → delete (always). */
export async function runTests(
  files: Record<string, string>,
  testFiles: Record<string, string>,
  testCmd: string,
): Promise<TestRunResult> {
  const session = await openSandbox();
  try {
    return await session.test(files, testFiles, testCmd);
  } finally {
    await session.close();
  }
}
