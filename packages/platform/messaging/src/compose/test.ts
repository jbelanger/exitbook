import { Layer } from 'effect';

import { makeFakeMessageTransport } from '../internal/adapters/fake-transport';
import { MessageBusConsumerLive } from '../internal/impl/make-consumer';
import { MessageBusProducerLive } from '../internal/impl/make-producer';
import { MessageTransportTag } from '../port';

// Test composition - MessageBus layers with fake dependencies
export const MessageBusTest = Layer.provide(
  Layer.mergeAll(MessageBusProducerLive, MessageBusConsumerLive),
  Layer.effect(MessageTransportTag, makeFakeMessageTransport()),
);
