import { traced } from '@exitbook/platform-monitoring';
import { context as otelContext, propagation, SpanKind } from '@opentelemetry/api';
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

        // Run handler in the extracted context with traced() wrapper
        return otelContext.with(ctx, () => {
          const obj =
            typeof message.payload === 'string' ? JSON.parse(message.payload) : message.payload;
          const ce = new CloudEvent(obj as Partial<CloudEvent>);

          const incomingMessage: IncomingMessage = {
            headers: message.headers,
            key: message.key,
            offset: message.offset,
            payload: ce.data,
          };

          return traced(`${topic} receive`, handler(incomingMessage), SpanKind.CONSUMER, {
            'messaging.consumer.group.name': groupId,
            'messaging.destination.name': topic,
            ...(message.key && { 'messaging.message.id': message.key }),
            'messaging.system': 'rabbitmq',
          });
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
