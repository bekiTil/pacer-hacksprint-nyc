// Owner: Yared (Engine). Thin Bedrock wrapper: one call → text or validated JSON + token/cost accounting.
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { generateText } from 'ai';
import type { z } from 'zod';
import type { Tier } from './types';
import { TIERS, costUsd } from './models';

let provider: ReturnType<typeof createAmazonBedrock> | null = null;
function bedrock() {
  provider ??= createAmazonBedrock({ region: process.env.AWS_REGION ?? 'us-east-1' });
  return provider;
}

export interface LlmUsage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export async function callText(opts: {
  tier: Tier;
  system: string;
  prompt: string;
  functionId: string;
  maxOutputTokens?: number;
}): Promise<{ text: string } & LlmUsage> {
  const res = await generateText({
    model: bedrock()(TIERS[opts.tier].modelId),
    system: opts.system,
    prompt: opts.prompt,
    maxOutputTokens: opts.maxOutputTokens ?? 16000,
    experimental_telemetry: { isEnabled: true, functionId: `${opts.functionId}:${opts.tier}` },
  });
  const tokensIn = res.usage.inputTokens ?? 0;
  const tokensOut = res.usage.outputTokens ?? 0;
  return { text: res.text, tokensIn, tokensOut, costUsd: costUsd(opts.tier, tokensIn, tokensOut) };
}

/** Extract the first JSON object from model text (tolerates ```json fences and surrounding prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`No JSON object in model output: ${text.slice(0, 200)}`);
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * JSON via prompt + parse + zod validation (one repair retry). We don't use forced tool use:
 * Opus/Sonnet 5.5 reject forced tool_choice.
 */
export async function callJson<S extends z.ZodType>(opts: {
  tier: Tier;
  system: string;
  prompt: string;
  schema: S;
  schemaHint: string; // human-readable shape shown to the model
  functionId: string;
  maxOutputTokens?: number;
}): Promise<{ data: z.infer<S> } & LlmUsage> {
  const system = `${opts.system}\n\nRespond with ONLY a JSON object (no prose, no code fences) of this shape:\n${opts.schemaHint}`;
  let usage: LlmUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  let prompt = opts.prompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await callText({ ...opts, system, prompt });
    usage = { tokensIn: usage.tokensIn + res.tokensIn, tokensOut: usage.tokensOut + res.tokensOut, costUsd: usage.costUsd + res.costUsd };
    try {
      return { data: opts.schema.parse(extractJson(res.text)), ...usage };
    } catch (err) {
      if (attempt === 1) throw err;
      prompt = `${opts.prompt}\n\nYour previous reply was not valid JSON for the required shape (${String(err).slice(0, 300)}). Reply again with ONLY the JSON object.`;
    }
  }
  throw new Error('unreachable');
}
