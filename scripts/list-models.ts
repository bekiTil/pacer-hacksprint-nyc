// Owner: Yared. Prints Claude inference profiles available in AWS_REGION.
import '../core/env';
import { BedrockClient, ListInferenceProfilesCommand, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock';

async function main() {
  const client = new BedrockClient({ region: process.env.AWS_REGION });
  const profiles = await client.send(new ListInferenceProfilesCommand({ maxResults: 1000 }));
  for (const p of profiles.inferenceProfileSummaries ?? []) {
    if (/claude/i.test(p.inferenceProfileId ?? '')) console.log('profile', p.inferenceProfileId, p.status);
  }
  const models = await client.send(new ListFoundationModelsCommand({ byProvider: 'Anthropic' }));
  for (const m of models.modelSummaries ?? []) console.log('model  ', m.modelId, m.inferenceTypesSupported?.join(','));
}
main().catch((e) => { console.error(e.name, e.message); process.exit(1); });
