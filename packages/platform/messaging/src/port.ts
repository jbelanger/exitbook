import type { Effect } from 'effect';
import { Context, Data } from 'effect';

// Message bus errors
export class PublishError extends Data.TaggedError('PublishError')<{
  readonly reason: string;
}> {}

export class SubscribeError extends Data.TaggedError('SubscribeError')<{
  readonly reason: string;
}> {}

export class MessageBusError extends Data.TaggedError('MessageBusError')<{
  readonly reason: string;
}> {}

export class MessageValidationError extends Data.TaggedError('MessageValidationError')<{
  readonly reason: string;
}> {}

// Message headers type
export type MessageHeaders = Record<string, string>;

// Publish options interface matching ADR spec
export interface PublishOptions {
  headers?: Record<string, string>;
  key?: string;
  timeoutMs?: number;
}

// Producer port (for publishing messages)
export interface MessageBusProducer {
  readonly healthCheck: () => Effect.Effect<boolean, never, never>;

  readonly publish: (
    topic: string,
    payload: unknown,
    opts?: PublishOptions,
  ) => Effect.Effect<void, PublishError, never>;

  readonly publishBatch: (
    topic: string,
    items: readonly { opts?: PublishOptions; payload: unknown }[],
  ) => Effect.Effect<void, PublishError, never>;
}

export const MessageBusProducer = Context.GenericTag<MessageBusProducer>(
  '@platform/MessageBusProducer',
);

// Incoming message interface matching ADR spec
export interface IncomingMessage<T = unknown> {
  headers: Record<string, string>;
  key?: string | undefined;
  offset?: unknown;
  payload: T;
}

// Subscription interface matching ADR spec
export interface Subscription {
  stop(): Effect.Effect<void, never>;
}

// Consumer port (for consuming messages)
export interface MessageBusConsumer {
  readonly subscribe: (
    topic: string,
    groupId: string,
    handler: (m: IncomingMessage) => Effect.Effect<void, never>,
  ) => Effect.Effect<Subscription, SubscribeError>;
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
  ) => Effect.Effect<void, PublishError, never>;

  readonly publishBatch: (
    topic: string,
    messages: readonly {
      headers?: MessageHeaders;
      key?: string;
      payload: unknown;
    }[],
  ) => Effect.Effect<void, PublishError, never>;

  readonly subscribe: (
    topic: string,
    groupId: string,
    handler: (message: {
      headers: MessageHeaders;
      key?: string;
      offset?: unknown;
      payload: unknown;
    }) => Effect.Effect<void, unknown>,
  ) => Effect.Effect<void, SubscribeError, never>;

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
