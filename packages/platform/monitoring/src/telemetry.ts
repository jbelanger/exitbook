import { hostname } from 'node:os';

import { NodeSdk } from '@effect/opentelemetry';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { Layer, Effect, Config } from 'effect';

// Configuration
const TelemetryConfig = Config.all({
  environment: Config.string('NODE_ENV').pipe(Config.withDefault('development')),
  otlpGrpc: Config.string('OTLP_GRPC_ENDPOINT').pipe(Config.withDefault('http://localhost:4317')),
  otlpHttp: Config.string('OTLP_HTTP_ENDPOINT').pipe(Config.withDefault('http://localhost:4318')),
  sampling: Config.number('TRACE_SAMPLING_RATE').pipe(Config.withDefault(0.1)),
  serviceName: Config.string('SERVICE_NAME').pipe(Config.withDefault('exitbook')),
  serviceVersion: Config.string('SERVICE_VERSION').pipe(Config.withDefault('1.0.0')),
});

// Main telemetry layer
export const TelemetryLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const cfg = yield* TelemetryConfig;

    // Environment-based sampling: 1.0 in dev, configurable in production
    const samplingRate = cfg.environment === 'development' ? 1.0 : cfg.sampling;
    const sampler = new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(samplingRate),
    });

    return NodeSdk.layer(() => ({
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: cfg.otlpHttp,
        }),
        exportIntervalMillis: 10000,
      }),
      resource: {
        attributes: {
          'deployment.environment': cfg.environment,
          'host.name': process.env['HOSTNAME'] || hostname(),
          'service.instance.id': process.env['HOSTNAME'] || `${process.pid}`,
        },
        serviceName: cfg.serviceName,
        serviceVersion: cfg.serviceVersion,
      },
      spanProcessor: new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: cfg.otlpGrpc,
        }),
        {
          maxExportBatchSize: 512,
          maxQueueSize: 2048,
        },
      ),
      tracerConfig: { sampler },
    }));
  }),
);
