// Owner: Bereket (UI). Learned scorecard (taskType × tier → passRate) for the heatmap.
import { getScorecard } from '@/core/scorecard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await getScorecard());
}
