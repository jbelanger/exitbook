import { randomUUID } from 'node:crypto';

import { Effect, pipe } from 'effect';

import type { MessageBusProducer, MessageTransport, MessageBusConfig, ADRHeaders } from '../port';
import { HeaderNames } from '../port';

export interface UuidGenerator {
  readonly generate: () => Effect.Effect<string, never>;
}

// Helper to generate ADR-compliant headers
const generateADRHeaders = (
  config: MessageBusConfig,
  userHeaders?: Record<string, string>,
): ADRHeaders => {
  const {
    [HeaderNames.X_SERVICE]: _xs,
    [HeaderNames.X_SERVICE_VERSION]: _xsv,
    ...rest
  } = userHeaders ?? {};
  const correlationId = rest[HeaderNames.X_CORRELATION_ID] || randomUUID();
  const causationId = rest[HeaderNames.X_CAUSATION_ID] || randomUUID();

  return {
    [HeaderNames.SCHEMA_VERSION]: rest[HeaderNames.SCHEMA_VERSION] || '1.0.0',
    [HeaderNames.X_CAUSATION_ID]: causationId,
    [HeaderNames.X_CORRELATION_ID]: correlationId,
    [HeaderNames.X_SERVICE]: config.serviceName,
    [HeaderNames.X_SERVICE_VERSION]: config.version || '1.0.0',
    ...(rest[HeaderNames.X_USER_ID] && { [HeaderNames.X_USER_ID]: rest[HeaderNames.X_USER_ID] }),
    ...rest,
  };
};

// ✅ factory takes transport and config and closes over them
export const makeMessageBusProducer = (
  transport: MessageTransport,
  config: MessageBusConfig,
): MessageBusProducer => ({
  healthCheck: () =>
    pipe(
      transport.healthCheck(),
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false)),
    ),

  publish: (topic: string, payload: unknown, opts?) => {
    const headers = generateADRHeaders(config, opts?.headers);

    return transport.publish(topic, payload, {
      ...(opts?.key && { key: opts.key }),
      ...(opts?.timeoutMs && { timeoutMs: opts.timeoutMs }),
      headers,
    });
  },

  publishBatch: (topic: string, items) => {
    const enrichedMessages = items.map((item) => ({
      payload: item.payload,
      ...(item.opts?.key && { key: item.opts.key }),
      ...(item.opts?.timeoutMs && { timeoutMs: item.opts.timeoutMs }),
      headers: generateADRHeaders(config, item.opts?.headers),
    }));

    return transport.publishBatch(topic, enrichedMessages);
  },
});
