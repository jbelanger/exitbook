import { traced } from '@exitbook/platform-monitoring';
import { context as otelContext, propagation, SpanKind } from '@opentelemetry/api';
import { Effect, pipe, Layer } from 'effect';

import type { MessageBusProducer, MessageTransport } from '../../port';
import { MessageBusProducerTag, MessageTransportTag } from '../../port';
import { CloudEvents } from '../../util/toCloudEvent';

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
    const headers: Record<string, string> = {
      'content-type': 'application/cloudevents+json',
    };

    // Inject W3C trace context
    propagation.inject(otelContext.active(), headers);

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

    return traced(
      `${topic} send`,
      transport.publish(topic, payloadJson, {
        ...(opts?.key && { key: opts.key }),
        headers,
        ...(opts?.timeoutMs && { timeoutMs: opts.timeoutMs }),
      }),
      SpanKind.PRODUCER,
      {
        'messaging.destination.name': topic,
        'messaging.system': 'rabbitmq',
        ...(opts?.key && { 'messaging.message.id': opts.key }),
      },
    );
  },

  publishBatch: (topic: string, items) => {
    const enrichedMessages = items.map((item) => {
      const headers: Record<string, string> = {
        'content-type': 'application/cloudevents+json',
      };

      // Inject trace context for each message
      propagation.inject(otelContext.active(), headers);

      return {
        ...(item.opts?.key && { key: item.opts.key }),
        headers,
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
      };
    });

    return traced(
      `${topic} send_batch`,
      transport.publishBatch(topic, enrichedMessages),
      SpanKind.PRODUCER,
      {
        'messaging.batch.size': items.length,
        'messaging.destination.name': topic,
        'messaging.system': 'rabbitmq',
      },
    );
  },
});

// MessageBusProducer layer - depends on MessageTransport and MessageBusConfig
export const MessageBusProducerLive = Layer.effect(
  MessageBusProducerTag,
  Effect.map(MessageTransportTag, (transport) => makeMessageBusProducer(transport)),
);
