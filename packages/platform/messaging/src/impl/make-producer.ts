import { Effect, pipe, Layer } from 'effect';

import type { MessageBusProducer, MessageTransport } from '../port';
import { MessageBusProducerTag, MessageTransportTag } from '../port';
import { CloudEvents } from '../util/toCloudEvent';

// Helper to detect if payload is already a CloudEvent
const looksLikeCloudEvent = (payload: unknown): boolean => {
  try {
    const obj = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return obj && typeof obj === 'object' && 'type' in obj && 'specversion' in obj;
  } catch {
    return false;
  }
};

// ✅ factory takes transport and config and closes over them
export const makeMessageBusProducer = (transport: MessageTransport): MessageBusProducer => ({
  healthCheck: () =>
    pipe(
      transport.healthCheck(),
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false)),
    ),

  publish: (topic: string, payload: unknown, opts?) => {
    // Skip re-wrapping if payload is already a CloudEvent
    const payloadJson = looksLikeCloudEvent(payload)
      ? typeof payload === 'string'
        ? payload
        : JSON.stringify(payload)
      : JSON.stringify(
          CloudEvents.create(topic, payload, {
            causationId: opts?.causationId,
            correlationId: opts?.correlationId,
            userId: opts?.userId,
          }),
        );

    return transport.publish(topic, payloadJson, {
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
      payload: looksLikeCloudEvent(item.payload)
        ? typeof item.payload === 'string'
          ? item.payload
          : JSON.stringify(item.payload)
        : JSON.stringify(
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
