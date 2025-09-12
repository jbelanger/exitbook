// Default composition
export { MessageBusDefault } from './compose/live';

// Test composition (needed by event-bus tests and local dev)
export { MessageBusTest } from './compose/test';

// Factories
export { makeMessageBusProducer } from './producer';
export { makeMessageBusConsumer } from './consumer';

// Core types + tags + topic helper
export {
  type MessageBusProducer,
  type MessageBusConsumer,
  type IncomingMessage,
  type PublishOptions,
  type MessageHeaders,
  MessageBusProducerTag,
  MessageBusConsumerTag,
  MessageTransportTag,
  topic,
} from './port';

// CloudEvent convenience API (used by event-store outbox mapper)
export {
  CloudEvents,
  getTracking,
  type CloudEventInit,
  type DomainCloudEvent,
  type CloudEventOptions,
} from './util/toCloudEvent';
