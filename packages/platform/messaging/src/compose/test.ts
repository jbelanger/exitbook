import { Layer } from 'effect';

import { makeFakeMessageTransport } from '../adapters/fake-transport';
import { MessageBusProducerLive, MessageBusConsumerLive } from '../index';
import { MessageTransport, MessageBusConfig } from '../port';
import type { MessageBusProducer, MessageBusConsumer } from '../port';

// Fake transport layer for testing
const FakeMessageTransportLive = Layer.effect(MessageTransport, makeFakeMessageTransport());

// Fake config layer for testing
const FakeMessageBusConfigLive = Layer.succeed(MessageBusConfig, {
  serviceName: 'test-service',
  version: '1.0.0',
});

// Test composition - MessageBus layers with fake dependencies
const TestDependencies = Layer.mergeAll(FakeMessageTransportLive, FakeMessageBusConfigLive);

export const MessageBusTest = Layer.provide(
  Layer.mergeAll(MessageBusProducerLive, MessageBusConsumerLive),
  TestDependencies,
);

// Individual test exports

export const MessageBusProducerTest: Layer.Layer<MessageBusProducer> = Layer.provide(
  MessageBusProducerLive,
  TestDependencies,
);

export const MessageBusConsumerTest: Layer.Layer<MessageBusConsumer> = Layer.provide(
  MessageBusConsumerLive,
  FakeMessageTransportLive,
);
