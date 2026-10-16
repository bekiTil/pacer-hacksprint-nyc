// Owner: Yared (Engine). Turns a user's task description (and optional starter code) into a
// benchmark-style task: decomposed into steps, with hidden pytest tests per step, a reference
// solution, and starter files. Validated in Daytona (solution passes, starter fails) before saving.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { BenchTask, Difficulty, Subtask, TaskManifest, TaskType, Tier } from './types';
import { TASK_TYPES, TASKS_DIR } from './types';
import { callText } from './llm';
import { openSandbox } from './sandbox';

export interface TaskGenInput {
  description: string;
  starterCode?: string; // optional existing code the task should build on
  starterFileName?: string; // defaults to the module name the generator picks
}

const GEN_SYSTEM = `You turn a coding request into a small, self-contained Python benchmark task that an AI coding agent must solve.

Break the work into 2-4 sequential STEPS that build on each other (step 2 may rely on step 1, etc.).
For every step write a hidden pytest file that checks ONLY that step's behaviour. Then write the starter
files the agent receives and a complete reference solution.

Rules:
- Python 3.11 standard library only. Deterministic tests (no network, time, randomness unless seeded/injected).
- Tests import from the module(s) by name, e.g. "from inventory import add_item". Put all files at the repository root.
- Each test file: 3-6 focused tests, including at least one edge case. Name them test_step1.py, test_step2.py, ...
- Starter files: if starter code is provided, use it unchanged as the starter; otherwise create the module with the
  needed functions/classes as stubs that raise NotImplementedError (with signatures and one-line docstrings).
- The reference solution must make ALL tests pass. The starter must FAIL every step's tests.
- The task prompt must fully specify the behaviour the tests check (no hidden surprises), written for an engineer.

Reply in EXACTLY this format and nothing else:

<meta>{"title": "...", "type": "boilerplate|refactor|bugfix|algorithm|tests|docs", "difficulty": 1-5, "prompt": "full task description for the agent"}</meta>
<step n="1" kind="boilerplate|refactor|bugfix|algorithm|tests|docs" difficulty="1-5" title="short title">what this step must implement</step>
<step n="2" ...>...</step>
<file role="starter" path="module.py">
...
</file>
<file role="solution" path="module.py">
...
</file>
<file role="test" path="test_step1.py">
...
</file>
<file role="test" path="test_step2.py">
...
</file>`;

interface Draft {
  meta: { title: string; type: TaskType; difficulty: Difficulty; prompt: string };
  subtasks: Subtask[];
  starter: Record<string, string>;
  solution: Record<string, string>;
  tests: Record<string, string>;
}

const clampDifficulty = (n: unknown): Difficulty => Math.min(5, Math.max(1, Math.round(Number(n) || 3))) as Difficulty;
const asType = (t: unknown): TaskType => (TASK_TYPES.includes(t as TaskType) ? (t as TaskType) : 'boilerplate');

export function parseDraft(text: string): Draft {
  const metaRaw = text.match(/<meta>([\s\S]*?)<\/meta>/)?.[1];
  if (!metaRaw) throw new Error('generator reply has no <meta> block');
  const meta = JSON.parse(metaRaw.trim());
  const files = { starter: {} as Record<string, string>, solution: {} as Record<string, string>, test: {} as Record<string, string> };
  for (const m of text.matchAll(/<file role="(starter|solution|test)" path="([^"]+)">\n?([\s\S]*?)\n?<\/file>/g)) {
    files[m[1] as keyof typeof files][m[2].replace(/^\.?\//, '')] = `${m[3].replace(/\s+$/, '')}\n`;
  }
  const subtasks: Subtask[] = [...text.matchAll(/<step n="(\d+)" kind="([^"]*)" difficulty="([^"]*)" title="([^"]*)">([\s\S]*?)<\/step>/g)].map((m) => ({
    title: m[4].trim(),
    description: m[5].trim(),
    kind: asType(m[2]),
    difficulty: clampDifficulty(m[3]),
    testFile: `test_step${m[1]}.py`,
  }));
  if (!subtasks.length) throw new Error('generator reply has no <step> blocks');
  for (const s of subtasks) if (!files.test[s.testFile]) throw new Error(`missing ${s.testFile}`);
  if (!Object.keys(files.starter).length || !Object.keys(files.solution).length) throw new Error('missing starter or solution files');
  return {
    meta: { title: String(meta.title), type: asType(meta.type), difficulty: clampDifficulty(meta.difficulty), prompt: String(meta.prompt) },
    subtasks,
    starter: files.starter,
    solution: files.solution,
    tests: files.test,
  };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task';
}

/** Generates, validates in Daytona (solution passes all steps, starter fails each step), and saves the task. */
export async function generateTask(input: TaskGenInput, onProgress: (msg: string) => void = () => {}): Promise<BenchTask> {
  let prompt = `REQUEST:\n${input.description}`;
  if (input.starterCode?.trim()) {
    prompt += `\n\nSTARTER CODE (use unchanged as the starter file${input.starterFileName ? ` named ${input.starterFileName}` : ''}):\n${input.starterCode}`;
  }
  const tiers: Tier[] = ['sonnet', 'opus'];
  let lastError = '';
  for (const tier of tiers) {
    onProgress(`${tier === 'sonnet' ? 'Sonnet' : 'Opus'} is breaking the task into steps and writing tests…`);
    const res = await callText({
      tier,
      functionId: 'taskgen',
      system: GEN_SYSTEM,
      prompt: lastError ? `${prompt}\n\nA previous attempt was invalid: ${lastError}\nFix that.` : prompt,
      maxOutputTokens: 16000,
    });
    let draft: Draft;
    try {
      draft = parseDraft(res.text);
    } catch (err) {
      lastError = String(err);
      onProgress(`Draft was malformed (${lastError.slice(0, 80)}), retrying…`);
      continue;
    }
    onProgress(`Draft: "${draft.meta.title}" in ${draft.subtasks.length} steps. Validating in a Daytona sandbox…`);

    const sandbox = await openSandbox();
    try {
      const sol = await sandbox.test({ ...draft.starter, ...draft.solution }, draft.tests, 'python -m pytest -q');
      if (!sol.passed) {
        lastError = `the reference solution fails its own tests:\n${sol.output.slice(-800)}`;
        onProgress('Reference solution failed its own tests, regenerating…');
        continue;
      }
      const stillPassing: string[] = [];
      for (const s of draft.subtasks) {
        const st = await sandbox.test(draft.starter, { [s.testFile]: draft.tests[s.testFile] }, `python -m pytest -q ${s.testFile}`);
        if (st.passed) stillPassing.push(s.testFile);
      }
      if (stillPassing.length) {
        lastError = `the starter already passes ${stillPassing.join(', ')}; starter must fail every step's tests`;
        onProgress('Starter already passes some tests, regenerating…');
        continue;
      }
    } finally {
      await sandbox.close();
    }

    const id = `user-${slug(draft.meta.title)}-${randomBytes(2).toString('hex')}`;
    const dir = path.join(process.cwd(), TASKS_DIR, id);
    const manifest: TaskManifest = {
      id,
      title: draft.meta.title,
      type: draft.meta.type,
      difficulty: draft.meta.difficulty,
      prompt: draft.meta.prompt,
      testCmd: 'python -m pytest -q',
      subtasks: draft.subtasks,
      source: 'user',
    };
    const write = (sub: string, files: Record<string, string>) => {
      for (const [p, c] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, sub, p)), { recursive: true });
        fs.writeFileSync(path.join(dir, sub, p), c);
      }
    };
    write('files', draft.starter);
    write('tests', draft.tests);
    write('solution', draft.solution);
    fs.writeFileSync(path.join(dir, 'task.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    onProgress(`Saved task ${id}: solution passes, starter fails every step.`);
    return { ...manifest, files: draft.starter, testFiles: draft.tests };
  }
  throw new Error(`Could not generate a valid task: ${lastError.slice(0, 300)}`);
}
