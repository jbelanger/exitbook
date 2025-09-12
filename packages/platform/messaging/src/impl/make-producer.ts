import { Effect, pipe, Layer } from 'effect';

import type { MessageBusProducer, MessageTransport } from '../port';
import { MessageBusProducerTag, MessageTransportTag } from '../port';
import { CloudEvents } from '../util/toCloudEvent';

// ✅ factory takes transport and config and closes over them
export const makeMessageBusProducer = (transport: MessageTransport): MessageBusProducer => ({
  healthCheck: () =>
    pipe(
      transport.healthCheck(),
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false)),
    ),

  publish: (topic: string, payload: unknown, opts?) => {
    const ce = CloudEvents.create(topic, payload, {
      causationId: opts?.causationId,
      correlationId: opts?.correlationId,
      userId: opts?.userId,
    });

    return transport.publish(topic, JSON.stringify(ce), {
      ...(opts?.key && { key: opts.key }),
      headers: { 'content-type': 'application/cloudevents+json' },
      ...(opts?.timeoutMs && { timeoutMs: opts.timeoutMs }),
    });
  },

  publishBatch: (topic: string, items) => {
    const enrichedMessages = items.map((item) => ({
      ...(item.opts?.key && { key: item.opts.key }),
      headers: { 'content-type': 'application/cloudevents+json' },
      ...(item.opts?.timeoutMs && { timeoutMs: item.opts.timeoutMs }),
      payload: JSON.stringify(
        CloudEvents.create(topic, item.payload, {
          causationId: item.opts?.causationId,
          correlationId: item.opts?.correlationId,
          userId: item.opts?.userId,
        }),
      ),
    }));

    return transport.publishBatch(topic, enrichedMessages);
  },
});

// MessageBusProducer layer - depends on MessageTransport and MessageBusConfig
export const MessageBusProducerLive = Layer.effect(
  MessageBusProducerTag,
  Effect.map(MessageTransportTag, (transport) => makeMessageBusProducer(transport)),
);
