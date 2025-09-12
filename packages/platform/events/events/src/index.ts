// Meta package re-exports for unified event platform access
// This follows ADR-0002 section 15.1

// Re-export core event bus facade
export type { UnifiedEventBus, IUnifiedEventBus } from '@exitbook/platform-event-bus';

// Re-export event store types and interfaces
export type { PositionedEvent, StreamName, EventStore } from '@exitbook/platform-event-store';

// Re-export core domain event type
export type { DomainEvent } from '@exitbook/core';

// Re-export messaging interfaces
export type {
  MessageBusProducer,
  MessageBusConsumer,
  IncomingMessage,
  PublishOptions,
} from '@exitbook/platform-messaging';

// Re-export default composition layers
export { UnifiedEventBusDefault } from '@exitbook/platform-event-bus';
