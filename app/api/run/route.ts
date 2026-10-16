// Owner: Bereket (UI). POST a RunRequest, stream RunEvents back as SSE.
// Uses the shared `executor` (real engine, or the mock when PACER_MOCK=1).
import type { NextRequest } from 'next/server';
import { executor } from '@/core/executor';
import { loadTask } from '@/core/tasks';
import type { RunEvent, RunRequest } from '@/core/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RunRequest;
  const task = loadTask(body.taskId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: RunEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      try {
        for await (const ev of executor.run(task, {
          budgetUsd: body.budgetUsd,
          strategy: body.strategy,
          client: 'web',
        })) {
          send(ev);
        }
      } catch (err) {
        // Backstop: the executor normally ends with its own done/error event.
        send({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
