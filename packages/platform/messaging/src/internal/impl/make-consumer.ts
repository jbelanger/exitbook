import { context as otelContext, propagation, trace, SpanKind } from '@opentelemetry/api';
import { CloudEvent } from 'cloudevents';
import { Effect, Layer } from 'effect';

import type {
  MessageBusConsumer,
  MessageTransport,
  Subscription,
  IncomingMessage,
} from '../../port';
import { MessageBusConsumerTag, MessageTransportTag } from '../../port';

// ✅ factory takes transport and closes over it
export const makeMessageBusConsumer = (transport: MessageTransport): MessageBusConsumer => ({
  subscribe: (topic: string, groupId: string, handler) =>
    Effect.map(
      transport.subscribe(topic, groupId, (message) => {
        // Extract W3C trace context from message headers
        const ctx = propagation.extract(otelContext.active(), message.headers);
        const tracer = trace.getTracer('@exitbook/messaging', '1.0.0');

        // Start a CONSUMER span
        const span = tracer.startSpan(`${topic} receive`, {
          attributes: {
            'messaging.consumer.group.name': groupId,
            'messaging.destination.name': topic,
            'messaging.system': 'rabbitmq',
            ...(message.key && { 'messaging.message.id': message.key }),
          },
          kind: SpanKind.CONSUMER,
        });

        // Run handler in the extracted context with span
        return otelContext.with(trace.setSpan(ctx, span), () => {
          const obj =
            typeof message.payload === 'string' ? JSON.parse(message.payload) : message.payload;
          const ce = new CloudEvent(obj as Partial<CloudEvent>);

          const incomingMessage: IncomingMessage = {
            headers: message.headers,
            key: message.key,
            offset: message.offset,
            payload: ce.data,
          };

          return handler(incomingMessage).pipe(
            Effect.tapBoth({
              onFailure: (error: unknown) =>
                Effect.sync(() => {
                  span.recordException(error instanceof Error ? error : new Error(String(error)));
                  span.setStatus({ code: 2 });
                  span.end();
                }),
              onSuccess: () =>
                Effect.sync(() => {
                  span.setStatus({ code: 1 });
                  span.end();
                }),
            }),
          );
        });
      }),
      (): Subscription => ({
        stop: () => Effect.orDie(transport.unsubscribe(topic, groupId)),
      }),
    ),
});

// MessageBusConsumer layer - depends on MessageTransport
export const MessageBusConsumerLive = Layer.effect(
  MessageBusConsumerTag,
  Effect.map(MessageTransportTag, makeMessageBusConsumer),
);
