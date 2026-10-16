// Owner: Bereket (UI). Task picker data. loadTasks() reads the filesystem, so it must run server-side.
import { loadTasks } from '@/core/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const tasks = loadTasks().map(({ id, title, type, difficulty, prompt }) => ({
    id,
    title,
    type,
    difficulty,
    prompt,
  }));
  return Response.json(tasks);
}
