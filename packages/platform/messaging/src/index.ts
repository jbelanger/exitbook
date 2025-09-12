// Compose layers (main integration points)
export { MessageBusDefault } from './compose/default';
export { MessageBusTest } from './compose/test';

// Re-exporting main interfaces and errors from the port for convenience
export {
  // Core interfaces and types
  type MessageBusProducer,
  type MessageBusConsumer,
  type MessageTransport,
  type MessageBusConfig,
  type IncomingMessage,
  type Subscription,
  type MessageHeaders,
  type MessageHeaderName,
  type PublishOptions,
  type ADRHeaders,

  // Service tags
  MessageBusProducerTag,
  MessageBusConsumerTag,
  MessageTransportTag,
  MessageBusConfigTag,

  // Constants and utilities
  HeaderNames,
  topic,

  // Errors
  PublishError,
  SubscribeError,
  MessageBusError,
  MessageValidationError,
} from './port';

// Utility functions
export { headersFromMetadata, type EventMetadataForHeaders } from './util/headers-from-metadata';
