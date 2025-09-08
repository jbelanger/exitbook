import type { Effect } from 'effect';
import { Data, Context } from 'effect';

// Generic event bus error
export class EventBusError extends Data.TaggedError('EventBusError')<{
  readonly eventType?: string;
  readonly message: string;
}> {}

export type EventBusErrorType = EventBusError;

// Generic event bus interface for cross-cutting messaging
export interface EventBus {
  readonly publish: (event: unknown) => Effect.Effect<void, EventBusError>;
}

export const EventBus = Context.GenericTag<EventBus>('@platform/EventBus');
