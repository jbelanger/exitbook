import { Layer } from 'effect';

import { makeFakeMessageTransport } from '../adapters/fake-transport';
import { MessageBusConsumerLive } from '../impl/make-consumer';
import { MessageBusProducerLive } from '../impl/make-producer';
import { MessageTransportTag } from '../port';

// Test composition - MessageBus layers with fake dependencies
export const MessageBusTest = Layer.provide(
  Layer.mergeAll(MessageBusProducerLive, MessageBusConsumerLive),
  Layer.effect(MessageTransportTag, makeFakeMessageTransport()),
);
