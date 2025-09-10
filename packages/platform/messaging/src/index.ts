// Main exports for MessageBus platform package
export * from './port';
export * from './impl/make-producer';
export * from './impl/make-consumer';
export * from './adapters/fake-transport';

// Layer exports for composition
import { Layer, Effect } from 'effect';

import { makeMessageBusConsumer } from './impl/make-consumer';
import { makeMessageBusProducer } from './impl/make-producer';
import { MessageBusProducer, MessageBusConsumer, MessageTransport, MessageBusConfig } from './port';

// ✅ Live layers require dependencies at composition time and provide resolved services
export const MessageBusProducerLive = Layer.effect(
  MessageBusProducer,
  Effect.all([MessageTransport, MessageBusConfig]).pipe(
    Effect.map(([transport, config]) => makeMessageBusProducer(transport, config)),
  ),
);

export const MessageBusConsumerLive = Layer.effect(
  MessageBusConsumer,
  Effect.map(MessageTransport, makeMessageBusConsumer),
);

// Composition exports
export * from './compose/default';
export * from './compose/test';
