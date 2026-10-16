// Owner: Yared (Engine). Cheap Haiku pass: what kind of task is this, how hard, how big.
import { z } from 'zod';
import type { Difficulty, TaskType } from './types';
import { TASK_TYPES } from './types';
import { callJson, type LlmUsage } from './llm';

export interface Profile {
  taskType: TaskType;
  difficulty: Difficulty;
  needsPlan: boolean; // multi-file / non-obvious approach → worth a separate planning step
  estOutputTokens: number; // tokens needed to write the solution files
  rationale: string;
}

const schema = z.object({
  taskType: z.enum(TASK_TYPES as [TaskType, ...TaskType[]]),
  difficulty: z.coerce.number().int().min(1).max(5),
  needsPlan: z.boolean(),
  estOutputTokens: z.coerce.number().int().min(100).max(30000),
  rationale: z.string(),
});

export function filesTokenEstimate(files: Record<string, string>): number {
  return Math.ceil(Object.entries(files).reduce((n, [p, c]) => n + p.length + c.length, 0) / 3.5);
}

export async function profileTask(prompt: string, files: Record<string, string>): Promise<Profile & LlmUsage> {
  const listing = Object.entries(files)
    .map(([p, c]) => `--- ${p} (${c.split('\n').length} lines)\n${c.length > 1500 ? `${c.slice(0, 1500)}\n...` : c}`)
    .join('\n');
  const res = await callJson({
    tier: 'haiku',
    functionId: 'profile',
    system:
      'You triage coding tasks for a model router. Classify the task, rate difficulty 1-5 ' +
      '(1 = trivial one-line fix, 3 = moderate multi-function change, 5 = tricky algorithm or subtle multi-file bug), ' +
      'say whether a separate planning step would help, and estimate output tokens needed to write the full solution files.',
    prompt: `TASK:\n${prompt}\n\nFILES:\n${listing}`,
    schema,
    schemaHint:
      '{"taskType": "boilerplate"|"refactor"|"bugfix"|"algorithm"|"tests"|"docs", "difficulty": 1-5, "needsPlan": boolean, "estOutputTokens": number, "rationale": string (one short sentence)}',
    maxOutputTokens: 2000,
  });
  return { ...res.data, difficulty: res.data.difficulty as Difficulty, tokensIn: res.tokensIn, tokensOut: res.tokensOut, costUsd: res.costUsd };
}
