import type { Effect } from 'effect';
import { Context, Data } from 'effect';

// Message bus errors
export class MessageBusError extends Data.TaggedError('MessageBusError')<{
  readonly reason: string;
}> {}

export class MessageValidationError extends Data.TaggedError('MessageValidationError')<{
  readonly reason: string;
}> {}

export class MessagePublishError extends Data.TaggedError('MessagePublishError')<{
  readonly reason: string;
}> {}

// Message headers type
export type MessageHeaders = Record<string, string>;

// Producer port (for publishing messages)
export interface MessageBusProducer {
  readonly healthCheck: () => Effect.Effect<boolean, never, never>;

  readonly publish: (
    topic: string,
    payload: unknown,
    options?: {
      causationId?: string;
      correlationId?: string;
      headers?: MessageHeaders;
      key?: string;
      userId?: string;
    },
  ) => Effect.Effect<void, MessagePublishError, never>;

  readonly publishBatch: (
    topic: string,
    messages: readonly {
      headers?: MessageHeaders;
      key?: string;
      payload: unknown;
    }[],
  ) => Effect.Effect<void, MessagePublishError, never>;
}

export const MessageBusProducer = Context.GenericTag<MessageBusProducer>(
  '@platform/MessageBusProducer',
);

// Consumer port (for consuming messages)
export interface MessageBusConsumer {
  readonly subscribe: (
    topic: string,
    groupId: string,
    handler: (message: {
      headers: MessageHeaders;
      key?: string;
      offset: string;
      payload: unknown;
      timestamp: Date;
    }) => Effect.Effect<void, unknown>,
  ) => Effect.Effect<void, MessageBusError, never>;

  readonly unsubscribe: (
    topic: string,
    groupId: string,
  ) => Effect.Effect<void, MessageBusError, never>;
}

export const MessageBusConsumer = Context.GenericTag<MessageBusConsumer>(
  '@platform/MessageBusConsumer',
);

// Transport interface that messaging adapters implement
export interface MessageTransport {
  readonly healthCheck: () => Effect.Effect<void, MessageBusError, never>;

  readonly publish: (
    topic: string,
    payload: unknown,
    options?: {
      headers?: MessageHeaders;
      key?: string;
    },
  ) => Effect.Effect<void, MessagePublishError, never>;

  readonly publishBatch: (
    topic: string,
    messages: readonly {
      headers?: MessageHeaders;
      key?: string;
      payload: unknown;
    }[],
  ) => Effect.Effect<void, MessagePublishError, never>;

  readonly subscribe: (
    topic: string,
    groupId: string,
    handler: (message: {
      headers: MessageHeaders;
      key?: string;
      offset: string;
      payload: unknown;
      timestamp: Date;
    }) => Effect.Effect<void, unknown>,
  ) => Effect.Effect<void, MessageBusError, never>;

  readonly unsubscribe: (
    topic: string,
    groupId: string,
  ) => Effect.Effect<void, MessageBusError, never>;
}

export const MessageTransport = Context.GenericTag<MessageTransport>('@platform/MessageTransport');

// Configuration for message bus
export interface MessageBusConfig {
  readonly serviceName: string;
  readonly version?: string;
}

export const MessageBusConfig = Context.GenericTag<MessageBusConfig>('@platform/MessageBusConfig');
