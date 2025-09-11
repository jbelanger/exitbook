import { Layer } from 'effect';

import { makeFakeMessageTransport } from '../adapters/fake-transport';
import { MessageTransportTag, MessageBusConfigTag } from '../port';

import { MessageBusProducerLive, MessageBusConsumerLive } from './default';

// Fake transport layer for testing
const FakeMessageTransportLive = Layer.effect(MessageTransportTag, makeFakeMessageTransport());

// Fake config layer for testing
const FakeMessageBusConfigLive = Layer.succeed(MessageBusConfigTag, {
  serviceName: 'test-service',
  version: '1.0.0',
});

// Test composition - MessageBus layers with fake dependencies
export const MessageBusTest = Layer.provide(
  Layer.mergeAll(MessageBusProducerLive, MessageBusConsumerLive),
  Layer.mergeAll(FakeMessageTransportLive, FakeMessageBusConfigLive),
);
