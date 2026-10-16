// Owner: Bereket (tasks). Cross-track exports: loadTasks, loadTask (bench, web, judge).
// Reads tasks/<id>/{task.json, files/**, tests/**}. solution/ is never loaded (reference only).
import fs from 'node:fs';
import path from 'node:path';
import type { BenchTask, TaskManifest } from './types';
import { TASKS_DIR } from './types';

function tasksRoot(): string {
  return path.join(process.cwd(), TASKS_DIR);
}

function readDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name.endsWith('.pyc')) continue;
    const abs = path.join(entry.parentPath, entry.name);
    out[path.relative(dir, abs).split(path.sep).join('/')] = fs.readFileSync(abs, 'utf8');
  }
  return out;
}

export function loadTask(id: string): BenchTask {
  const dir = path.join(tasksRoot(), id);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'task.json'), 'utf8')) as TaskManifest;
  return {
    ...manifest,
    id,
    files: readDir(path.join(dir, 'files')),
    testFiles: readDir(path.join(dir, 'tests')),
  };
}

export function loadTasks(): BenchTask[] {
  return fs
    .readdirSync(tasksRoot(), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(tasksRoot(), d.name, 'task.json')))
    .map((d) => loadTask(d.name))
    .sort((a, b) => a.id.localeCompare(b.id));
}
