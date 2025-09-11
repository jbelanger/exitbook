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

// Default production composition - use shared configuration function
export const createDefaultMessageBusConfig = () => ({
  serviceName: process.env['SERVICE_NAME'] || 'exitbook-platform',
  version: process.env['SERVICE_VERSION'] || '1.0.0',
});

export const createDefaultRabbitMQConfig = () => ({
  durable: true,
  exchangeName: 'events',
  exchangeType: 'topic' as const,
  maxRetries: 3,
  publishTimeoutMs: 5000,
  retryDelays: [5000, 30000, 120000], // 5s, 30s, 2m
  url: process.env['RABBITMQ_URL'] || 'amqp://localhost:5672',
});

export const MessageBusDefault = Layer.provide(
  Layer.mergeAll(MessageBusProducerLive, MessageBusConsumerLive),
  Layer.mergeAll(
    RabbitMQTransportLive,
    Layer.sync(MessageBusConfigTag, createDefaultMessageBusConfig),
    Layer.sync(RabbitMQConfig, createDefaultRabbitMQConfig),
  ),
);
