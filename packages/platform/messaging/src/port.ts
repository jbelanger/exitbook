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

// ADR headers interface for type safety
export interface ADRHeaders extends Record<string, string> {
  'schema-version': string;
  'x-causation-id': string;
  'x-correlation-id': string;
  'x-service': string;
  'x-service-version': string;
  'x-user-id'?: string;
}

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

// Service tags following event-store pattern
export const MessageBusProducerTag = Context.GenericTag<MessageBusProducer>(
  '@platform/messaging/MessageBusProducer',
);

export const MessageBusConsumerTag = Context.GenericTag<MessageBusConsumer>(
  '@platform/messaging/MessageBusConsumer',
);

export const MessageTransportTag = Context.GenericTag<MessageTransport>(
  '@platform/messaging/MessageTransport',
);

export const MessageBusConfigTag = Context.GenericTag<MessageBusConfig>(
  '@platform/messaging/MessageBusConfig',
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

// Transport interface that messaging adapters implement
export interface MessageTransport {
  readonly healthCheck: () => Effect.Effect<void, MessageBusError, never>;

  readonly publish: (
    topic: string,
    payload: unknown,
    options?: {
      headers?: MessageHeaders;
      key?: string;
      timeoutMs?: number;
    },
  ) => Effect.Effect<void, PublishError, never>;

  readonly publishBatch: (
    topic: string,
    messages: readonly {
      headers?: MessageHeaders;
      key?: string;
      payload: unknown;
      timeoutMs?: number;
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

// Configuration for message bus
export interface MessageBusConfig {
  readonly serviceName: string;
  readonly version?: string;
}

// ADR-compliant topic helper function
export const topic = (category: string, type: string, version = 'v1'): string =>
  `domain.${category}.${type}.${version}`;
