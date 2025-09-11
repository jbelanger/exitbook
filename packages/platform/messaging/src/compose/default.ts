import { Layer, Effect } from 'effect';

import { RabbitMQTransportLive, RabbitMQConfig } from '../adapters/rabbitmq-transport';
import { makeMessageBusConsumer } from '../impl/make-consumer';
import { makeMessageBusProducer } from '../impl/make-producer';
import {
  MessageBusProducerTag,
  MessageBusConsumerTag,
  MessageTransportTag,
  MessageBusConfigTag,
} from '../port';

// Main MessageBus layers - depend on MessageTransport
export const MessageBusProducerLive = Layer.effect(
  MessageBusProducerTag,
  Effect.all([MessageTransportTag, MessageBusConfigTag]).pipe(
    Effect.map(([transport, config]) => makeMessageBusProducer(transport, config)),
  ),
);

export const MessageBusConsumerLive = Layer.effect(
  MessageBusConsumerTag,
  Effect.map(MessageTransportTag, makeMessageBusConsumer),
);

// Default production composition - MessageBus + RabbitMQ transport + default config
export const MessageBusDefault = Layer.provide(
  Layer.mergeAll(MessageBusProducerLive, MessageBusConsumerLive),
  Layer.mergeAll(
    RabbitMQTransportLive,
    Layer.succeed(MessageBusConfigTag, {
      serviceName: process.env['SERVICE_NAME'] || 'exitbook-platform',
      version: process.env['SERVICE_VERSION'] || '1.0.0',
    }),
    Layer.succeed(RabbitMQConfig, {
      durable: true,
      exchangeName: 'events',
      exchangeType: 'topic',
      maxRetries: 3,
      publishTimeoutMs: 5000,
      retryDelays: [5000, 30000, 120000], // 5s, 30s, 2m
      url: process.env['RABBITMQ_URL'] || 'amqp://localhost:5672',
    }),
  ),
);
