import { Effect, pipe } from 'effect';

import type { MessageBusProducer, MessageTransport, MessageBusConfig } from '../port';

export interface UuidGenerator {
  readonly generate: () => Effect.Effect<string, never>;
}

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
    const headers: Record<string, string> = {
      'x-service': config.serviceName,
      'x-version': config.version || '1.0',
      ...opts?.headers,
    };

    return transport.publish(topic, payload, {
      ...(opts?.key && { key: opts.key }),
      headers,
    });
  },

  publishBatch: (topic: string, items) => {
    const enrichedMessages = items.map((item) => ({
      payload: item.payload,
      ...(item.opts?.key && { key: item.opts.key }),
      headers: {
        'x-service': config.serviceName,
        'x-version': config.version || '1.0',
        ...item.opts?.headers,
      },
    }));

    return transport.publishBatch(topic, enrichedMessages);
  },
});
