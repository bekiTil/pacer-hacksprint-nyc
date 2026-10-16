// Owner: Yared. Smoke test: one JSON call per Bedrock tier.
import '../core/env';
import { z } from 'zod';
import { callJson } from '../core/llm';
import { TIER_ORDER } from '../core/types';
(async () => {
  await Promise.all(TIER_ORDER.map(async (tier) => {
    const t0 = Date.now();
    try {
      const r = await callJson({ tier, system: 'You are terse.', prompt: 'Give the capital of France.', schema: z.object({ answer: z.string() }), schemaHint: '{"answer": string}', functionId: 'smoke' });
      console.log(tier, JSON.stringify(r.data), r.tokensIn, r.tokensOut, r.costUsd.toFixed(6), `${Date.now() - t0}ms`);
    } catch (e: any) { console.log(tier, 'ERR', e.name, e.message?.slice(0, 300)); }
  }));
})();
