import { randomUUID } from 'node:crypto';

import { Effect, pipe } from 'effect';

import type { MessageBusProducer, MessageTransport, MessageBusConfig, ADRHeaders } from '../port';

export interface UuidGenerator {
  readonly generate: () => Effect.Effect<string, never>;
}

// Helper to generate ADR-compliant headers
const generateADRHeaders = (
  config: MessageBusConfig,
  userHeaders?: Record<string, string>,
): ADRHeaders => {
  const { ['x-service']: _xs, ['x-service-version']: _xsv, ...rest } = userHeaders ?? {};
  const correlationId = rest['x-correlation-id'] || randomUUID();
  const causationId = rest['x-causation-id'] || randomUUID();

  return {
    'schema-version': rest['schema-version'] || '1.0.0',
    'x-causation-id': causationId,
    'x-correlation-id': correlationId,
    'x-service': config.serviceName,
    'x-service-version': config.version || '1.0.0',
    ...(rest['x-user-id'] && { 'x-user-id': rest['x-user-id'] }),
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
