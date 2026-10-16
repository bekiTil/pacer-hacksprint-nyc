// Owner: Bereket (Observability). Cross-track exports: initTracing, withSpan (executor, bench, MCP server).
// STUB: signatures are final; withSpan already creates real OpenTelemetry spans via the global tracer,
// so spans flow to Arize as soon as Bereket wires the exporter in initTracing / instrumentation.ts.
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { SpanAttrs, SpanHandle } from './types';

const tracer = trace.getTracer('pacer');

/** Call once at startup in scripts and the MCP server (Next.js uses instrumentation.ts instead). */
export function initTracing(serviceName: string): void {
  void serviceName; // TODO(bereket): NodeTracerProvider + OTLP exporter → Arize AX
}

/** Flush pending spans before a script exits. */
export async function shutdownTracing(): Promise<void> {}

/** Run fn inside a span. Use ATTR keys from core/types.ts for attrs. Errors are recorded and re-thrown. */
export async function withSpan<T>(name: string, attrs: SpanAttrs, fn: (span: SpanHandle) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes: attrs }, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}
