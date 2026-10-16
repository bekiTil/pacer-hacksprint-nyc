// Owner: Yared (Engine). Tier → Bedrock model + pricing. Bedrock model IDs live ONLY here.
import type { Tier } from './types';
import { TIER_ORDER } from './types';

export interface TierInfo {
  label: string;
  modelId: string; // Bedrock model / inference profile ID
  inPerMTok: number; // USD per 1M input tokens
  outPerMTok: number; // USD per 1M output tokens
}

// IDs are overridable via env so we can swap to whatever `aws bedrock list-inference-profiles` shows
// without touching code. Prices are Anthropic list rates; TODO(yared): confirm against Bedrock pricing.
export const TIERS: Record<Tier, TierInfo> = {
  haiku: {
    label: 'Claude Haiku 5.5',
    modelId: process.env.BEDROCK_MODEL_HAIKU || 'us.anthropic.claude-haiku-5-5',
    inPerMTok: 0.1,
    outPerMTok: 0.5,
  },
  sonnet: {
    label: 'Claude Sonnet 5.5',
    modelId: process.env.BEDROCK_MODEL_SONNET || 'us.anthropic.claude-sonnet-5-5',
    inPerMTok: 2,
    outPerMTok: 10,
  },
  opus: {
    label: 'Claude Opus 5.5',
    modelId: process.env.BEDROCK_MODEL_OPUS || 'us.anthropic.claude-opus-5-5',
    inPerMTok: 4,
    outPerMTok: 20,
  },
};

export function costUsd(tier: Tier, tokensIn: number, tokensOut: number): number {
  const t = TIERS[tier];
  return (tokensIn * t.inPerMTok + tokensOut * t.outPerMTok) / 1_000_000;
}

/** haiku → sonnet → opus → null */
export function nextTier(tier: Tier): Tier | null {
  return TIER_ORDER[TIER_ORDER.indexOf(tier) + 1] ?? null;
}
