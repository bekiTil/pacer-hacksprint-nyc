// Owner: Bereket (Observability). Cross-track exports: initTracing, withSpan (executor, bench, MCP server).
// withSpan creates real OpenTelemetry spans via the global tracer; initTracing wires the OTLP
// exporter to Arize AX for plain-Node entry points (bench script, MCP server). Next.js uses
// instrumentation.ts instead, so a web process never calls initTracing.
//
// `@arizeai/openinference-vercel` is ESM-only, and every Node entry point here runs under tsx's
// CJS loader (the repo is CJS — core/env.ts relies on __dirname), which cannot statically import
// an import-only package. So the exporter is built with a dynamic import(). initTracing keeps its
// frozen synchronous signature and kicks off setup; `ready` resolves when the provider is live,
// and both withSpan and shutdownTracing await it so no span is dropped before the exporter exists.
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { SpanAttrs, SpanHandle } from './types';

const tracer = trace.getTracer('pacer');

interface Flushable {
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}
let provider: Flushable | null = null;
let ready: Promise<void> | null = null;

/** Call once at startup in scripts and the MCP server. No-op if Arize keys are missing or already inited. */
export function initTracing(serviceName: string): void {
  if (ready) return;
  const spaceId = process.env.ARIZE_SPACE_ID;
  const apiKey = process.env.ARIZE_API_KEY;
  const project = process.env.ARIZE_PROJECT_NAME || 'pacer';
  if (!spaceId || !apiKey) {
    console.warn('[pacer] ARIZE_SPACE_ID / ARIZE_API_KEY not set — tracing disabled');
    return;
  }
  ready = (async () => {
    const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-proto');
    const { OpenInferenceSimpleSpanProcessor } = await import('@arizeai/openinference-vercel');
    const { resourceFromAttributes } = await import('@opentelemetry/resources');
    const exporter = new OTLPTraceExporter({
      url: 'https://otlp.arize.com/v1/traces',
      headers: { space_id: spaceId, api_key: apiKey },
    });
    const p = new NodeTracerProvider({
      resource: resourceFromAttributes({
        'service.name': serviceName,
        model_id: project,
        'openinference.project.name': project,
      }),
      spanProcessors: [new OpenInferenceSimpleSpanProcessor({ exporter })],
    });
    p.register();
    provider = p;
  })().catch((err) => {
    console.warn('[pacer] tracing init failed:', err);
  });
}

/** Flush pending spans before a script exits. */
export async function shutdownTracing(): Promise<void> {
  if (ready) await ready;
  if (!provider) return;
  await provider.forceFlush();
  await provider.shutdown();
  provider = null;
  ready = null;
}

/** Run fn inside a span. Use ATTR keys from core/types.ts for attrs. Errors are recorded and re-thrown. */
export async function withSpan<T>(name: string, attrs: SpanAttrs, fn: (span: SpanHandle) => Promise<T>): Promise<T> {
  if (ready) await ready; // ensure the exporter is live before the first span ends
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
