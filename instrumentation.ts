// Owner: Bereket (Observability). Next.js server instrumentation.
// Next calls register() once when the server process boots. We send OpenInference
// traces (the AI SDK spans from the executor + our withSpan spans) to Arize AX.
import { registerOTel } from '@vercel/otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OpenInferenceSimpleSpanProcessor } from '@arizeai/openinference-vercel';

export function register() {
  const spaceId = process.env.ARIZE_SPACE_ID;
  const apiKey = process.env.ARIZE_API_KEY;
  const project = process.env.ARIZE_PROJECT_NAME || 'pacer';

  if (!spaceId || !apiKey) {
    console.warn('[pacer] ARIZE_SPACE_ID / ARIZE_API_KEY not set — tracing disabled');
    return;
  }

  registerOTel({
    serviceName: project,
    // Resource attributes: Arize AX files traces under the `model_id` project.
    attributes: {
      model_id: project,
      'openinference.project.name': project,
    },
    spanProcessors: [
      new OpenInferenceSimpleSpanProcessor({
        exporter: new OTLPTraceExporter({
          url: 'https://otlp.arize.com/v1/traces',
          headers: { space_id: spaceId, api_key: apiKey },
        }),
      }),
    ],
  });
}
