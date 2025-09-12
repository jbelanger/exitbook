import { Layer } from 'effect';

import { makeFakeMessageTransport } from '../adapters/fake-transport';
import { makeRabbitMQTransportLive } from '../adapters/rabbitmq-transport';
import { MessageBusConsumerLive } from '../impl/make-consumer';
import { MessageBusProducerLive } from '../impl/make-producer';
import { MessageTransportTag } from '../port';

export const createDefaultRabbitMQConfig = () => ({
  durable: true,
  exchangeName: 'events',
  exchangeType: 'topic' as const,
  maxRetries: 3,
  publishTimeoutMs: 5000,
  retryDelays: [5000, 30000, 120000], // 5s, 30s, 2m
  url: process.env['RABBITMQ_URL'] || 'amqp://localhost:5672',
});

// Environment-based transport selection - default production composition
const createMessageBusDefault = () => {
  const transport = process.env['MESSAGING_TRANSPORT'] || 'rabbitmq';

  // Transport selection based on environment
  if (transport === 'rabbitmq') {
    const rabbitmqConfig = createDefaultRabbitMQConfig();
    const RabbitMQTransportLive = makeRabbitMQTransportLive(rabbitmqConfig);

    return Layer.provide(
      Layer.mergeAll(MessageBusProducerLive, MessageBusConsumerLive),
      RabbitMQTransportLive,
    );
  }

  // Default to fake transport for development/testing when not explicitly rabbitmq
  const FakeTransportLive = Layer.effect(MessageTransportTag, makeFakeMessageTransport());

  return Layer.provide(
    Layer.mergeAll(MessageBusProducerLive, MessageBusConsumerLive),
    FakeTransportLive,
  );
};

export const MessageBusDefault = createMessageBusDefault();
