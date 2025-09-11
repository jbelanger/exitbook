import { Layer } from 'effect';

import { makeFakeMessageTransport } from '../adapters/fake-transport';
import { RabbitMQTransportLive, RabbitMQConfig } from '../adapters/rabbitmq-transport';
import { MessageTransportTag, MessageBusConfigTag } from '../port';

import {
  MessageBusProducerLive,
  MessageBusConsumerLive,
  createDefaultRabbitMQConfig,
} from './default';

// Environment-based transport selection
export const createEnvironmentMessageBus = (env?: {
  MESSAGING_TRANSPORT?: string;
  RABBITMQ_URL?: string;
  SERVICE_NAME?: string;
  SERVICE_VERSION?: string;
}) => {
  const transport = env?.['MESSAGING_TRANSPORT'] || process.env['MESSAGING_TRANSPORT'] || 'fake';
  const serviceName = env?.['SERVICE_NAME'] || process.env['SERVICE_NAME'] || 'unknown-service';
  const serviceVersion = env?.['SERVICE_VERSION'] || process.env['SERVICE_VERSION'] || '1.0.0';

  // Config layer - always needed
  const ConfigLive = Layer.succeed(MessageBusConfigTag, {
    serviceName,
    version: serviceVersion,
  });

  // Transport selection based on environment
  if (transport === 'rabbitmq') {
    const rabbitmqUrl =
      env?.['RABBITMQ_URL'] || process.env['RABBITMQ_URL'] || 'amqp://localhost:5672';

    const RabbitMQConfigLive = Layer.succeed(RabbitMQConfig, {
      ...createDefaultRabbitMQConfig(),
      url: rabbitmqUrl, // Override URL from environment
    });

    return Layer.provide(
      Layer.mergeAll(MessageBusProducerLive, MessageBusConsumerLive),
      Layer.mergeAll(RabbitMQTransportLive, RabbitMQConfigLive, ConfigLive),
    );
  }

  // Default to fake transport for development/testing
  const FakeTransportLive = Layer.effect(MessageTransportTag, makeFakeMessageTransport());

  return Layer.provide(
    Layer.mergeAll(MessageBusProducerLive, MessageBusConsumerLive),
    Layer.mergeAll(FakeTransportLive, ConfigLive),
  );
};

// Convenience exports for specific environments
export const MessageBusProduction = createEnvironmentMessageBus({
  MESSAGING_TRANSPORT: 'rabbitmq',
});

export const MessageBusDevelopment = createEnvironmentMessageBus({
  MESSAGING_TRANSPORT: 'fake',
});
