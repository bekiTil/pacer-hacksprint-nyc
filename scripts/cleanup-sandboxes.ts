// Owner: Yared. Deletes leftover Pacer sandboxes (label app=pacer), e.g. after a crashed bench run.
import '../core/env';
import { Daytona } from '@daytonaio/sdk';

async function main() {
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
  let n = 0;
  for await (const sb of daytona.list()) {
    if (sb.labels?.app !== 'pacer') continue;
    await sb.delete().catch((e) => console.warn(`failed ${sb.id}: ${e}`));
    n++;
  }
  console.log(`deleted ${n} pacer sandbox(es)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
