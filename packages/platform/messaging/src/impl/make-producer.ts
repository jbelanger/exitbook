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

  publish: (topic: string, payload: unknown, options?) => {
    const headers: Record<string, string> = {
      'x-service': config.serviceName,
      'x-version': config.version || '1.0',
      ...options?.headers,
    };

    if (options?.correlationId) {
      headers['x-correlation-id'] = options.correlationId;
    }

    if (options?.causationId) {
      headers['x-causation-id'] = options.causationId;
    }

    if (options?.userId) {
      headers['x-user-id'] = options.userId;
    }

    return transport.publish(topic, payload, {
      ...(options?.key && { key: options.key }),
      headers,
    });
  },

  publishBatch: (topic: string, messages) => {
    const enrichedMessages = messages.map((msg) => ({
      ...msg,
      headers: {
        'x-service': config.serviceName,
        'x-version': config.version || '1.0',
        ...msg.headers,
      },
    }));

    return transport.publishBatch(topic, enrichedMessages);
  },
});
