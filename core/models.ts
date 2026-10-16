// Owner: Yared (Engine). Tier → Bedrock model + pricing. Bedrock model IDs live ONLY here.
import type { Tier } from './types';
import { TIER_ORDER } from './types';

export interface TierInfo {
  label: string;
  modelId: string; // Bedrock model / inference profile ID
  inPerMTok: number; // USD per 1M input tokens
  outPerMTok: number; // USD per 1M output tokens
}

// Defaults are what works on our Bedrock account; override per tier with BEDROCK_MODEL_* in .env.local.
// Label and price are derived from the model ID, so an override is always priced correctly.
// Prices: Anthropic list rates per 1M tokens (input/output).
const PRICES: { match: RegExp; label: string; inPerMTok: number; outPerMTok: number }[] = [
  { match: /haiku-5-5/, label: 'Claude Haiku 5.5', inPerMTok: 0.1, outPerMTok: 0.5 },
  { match: /haiku-4-5/, label: 'Claude Haiku 4.5', inPerMTok: 1, outPerMTok: 5 },
  { match: /sonnet-5-5/, label: 'Claude Sonnet 5.5', inPerMTok: 2, outPerMTok: 10 },
  { match: /sonnet-5(?!-)/, label: 'Claude Sonnet 5', inPerMTok: 2, outPerMTok: 10 },
  { match: /sonnet-4-6/, label: 'Claude Sonnet 4.6', inPerMTok: 3, outPerMTok: 15 },
  { match: /opus-5-5/, label: 'Claude Opus 5.5', inPerMTok: 4, outPerMTok: 20 },
  { match: /opus-(5|4-[5-8])/, label: 'Claude Opus', inPerMTok: 5, outPerMTok: 25 },
];

function tierInfo(modelId: string): TierInfo {
  const p = PRICES.find((x) => x.match.test(modelId));
  if (!p) throw new Error(`No price known for Bedrock model ${modelId}; add it to PRICES in core/models.ts`);
  return { label: p.label, modelId, inPerMTok: p.inPerMTok, outPerMTok: p.outPerMTok };
}

export const TIERS: Record<Tier, TierInfo> = {
  // Haiku 5.5 is blocked on our account (private marketplace eligibility), so the default is Haiku 4.5.
  haiku: tierInfo(process.env.BEDROCK_MODEL_HAIKU || 'us.anthropic.claude-haiku-4-5-20251001-v1:0'),
  sonnet: tierInfo(process.env.BEDROCK_MODEL_SONNET || 'us.anthropic.claude-sonnet-5-5'),
  opus: tierInfo(process.env.BEDROCK_MODEL_OPUS || 'us.anthropic.claude-opus-5-5'),
};

export function costUsd(tier: Tier, tokensIn: number, tokensOut: number): number {
  const t = TIERS[tier];
  return (tokensIn * t.inPerMTok + tokensOut * t.outPerMTok) / 1_000_000;
}

/** haiku → sonnet → opus → null */
export function nextTier(tier: Tier): Tier | null {
  return TIER_ORDER[TIER_ORDER.indexOf(tier) + 1] ?? null;
}
