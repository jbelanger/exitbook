import type { DomainEvent } from '@exitbook/core';
import type { Effect } from 'effect';
import { Context, Data, Schema } from 'effect';

// The main service tags to access the EventStore in your application
export const EventStoreTag = Context.GenericTag<EventStore>('@exitbook/event-store/EventStore');
export const EventStoreDatabaseTag = Context.GenericTag<EventStoreDatabase>(
  '@exitbook/event-store/EventStoreDatabase',
);

/** ── Errors ─────────────────────────────────────────────────────────────── */
export class SaveEventError extends Data.TaggedError('SaveEventError')<{ reason: string }> {}
export class ReadEventError extends Data.TaggedError('ReadEventError')<{ reason: string }> {}
export class IdempotencyError extends Data.TaggedError('IdempotencyError')<{ reason: string }> {}
export class OptimisticLockError extends Data.TaggedError('OptimisticLockError')<{
  actualVersion: number;
  aggregateId: string;
  expectedVersion: number;
}> {}

/** ── Value objects / validation ─────────────────────────────────────────── */
export const StreamName = Schema.pattern(/^[a-z][a-z0-9_.]*-[A-Za-z0-9-]+$/); // category-id (strict)
export type StreamName = Schema.Schema.Type<typeof StreamName>;

export const ExpectedVersion = Schema.Number.pipe(
  Schema.filter((n): n is number => n >= 0, { message: () => 'expectedVersion >= 0' }),
);
export const NonEmptyArray = <A, I, R>(inner: Schema.Schema<A, I, R>) =>
  Schema.Array(inner).pipe(
    Schema.filter((a): a is readonly A[] => a.length > 0, {
      message: () => 'events must be non-empty',
    }),
  );

/** ── Ports ──────────────────────────────────────────────────────────────── */
export interface PositionedEvent extends DomainEvent {
  readonly position: bigint; // global position (monotonic)
  readonly streamName: StreamName; // authoritative stream name
}

export interface EventStore {
  readonly append: (
    streamName: StreamName,
    events: readonly DomainEvent[],
    expectedVersion: number,
    options?: { idempotencyKey?: string; metadata?: Record<string, unknown> },
  ) => Effect.Effect<void, SaveEventError | OptimisticLockError | IdempotencyError>;

  /**
   * Append events transactionally and return the persisted form
   * (with eventId/version/position filled), plus last cursor values.
   */
  readonly appendAndReturn: (
    streamName: StreamName,
    events: readonly DomainEvent[],
    expectedVersion: number,
    options?: {
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    },
  ) => Effect.Effect<
    {
      appended: readonly PositionedEvent[]; // persisted, with position
      lastPosition: bigint;
      lastVersion: number;
    },
    SaveEventError | OptimisticLockError | IdempotencyError
  >;

  readonly healthCheck: () => Effect.Effect<boolean, never>;

  readonly loadSnapshot: (
    streamName: string,
  ) => Effect.Effect<{ data: unknown; version: number } | undefined, { reason: string }>;

  /** Tail the global event log by position (authoritative, persisted). */
  readonly readAll: (
    fromPosition: bigint,
    batchSize: number,
  ) => Effect.Effect<readonly PositionedEvent[], ReadEventError>;

  /** Tail a category (by global position). */
  readonly readCategory: (
    category: string,
    fromPosition: bigint,
    batchSize: number,
  ) => Effect.Effect<readonly PositionedEvent[], ReadEventError>;

  /** Read a single stream by version (expected: strictly greater than `fromVersion`). */
  readonly readStream: (
    streamName: StreamName,
    fromVersion: number,
  ) => Effect.Effect<readonly DomainEvent[], ReadEventError>;

  readonly saveSnapshot: (
    streamName: string,
    version: number,
    data: unknown,
  ) => Effect.Effect<void, { reason: string }>;
}

export interface EventStoreDatabase {
  // low-level ops; NO domain errors here
  readonly getCurrentVersion: (streamName: string) => Effect.Effect<number, { reason: string }>;
  readonly insertEvents: (
    rows: readonly StoredEventData[],
  ) => Effect.Effect<void, { code?: string; reason: string }>;
  readonly insertIdempotencyKey: (
    key: string,
    eventId: string,
    expiresAt: Date,
  ) => Effect.Effect<void, { code?: string; reason: string }>;
  readonly insertOutboxEntries: (
    rows: readonly OutboxEntryData[],
  ) => Effect.Effect<void, { reason: string }>;
  readonly insertSnapshot: (
    streamName: string,
    version: number,
    schemaVersion: number,
    data: unknown,
  ) => Effect.Effect<void, { reason: string }>;
  readonly ping: () => Effect.Effect<void, { reason: string }>;
  readonly selectEventsByCategory: (
    category: string,
    fromPosition: number,
    batchSize: number,
  ) => Effect.Effect<readonly StoredEvent[], { reason: string }>;
  readonly selectEventsByStream: (
    streamName: string,
    from: number,
    to?: number,
  ) => Effect.Effect<readonly StoredEvent[], { reason: string }>;
  readonly selectLatestSnapshot: (
    streamName: string,
  ) => Effect.Effect<{ data: unknown; version: number } | undefined, { reason: string }>;
  readonly transaction: <A, E>(fa: Effect.Effect<A, E>) => Effect.Effect<A, E | { reason: string }>;
}

// Data structures for database operations
export interface StoredEventData {
  readonly category: string;
  readonly event_data: unknown;
  readonly event_id: string;
  readonly event_schema_version: number;
  readonly event_type: string;
  readonly global_position?: number;
  readonly metadata: unknown;
  readonly stream_name: string;
  readonly stream_version: number;
}

export interface StoredEvent extends StoredEventData {
  readonly created_at: Date;
  readonly id: number;
}

export interface OutboxEntryData {
  readonly category: string;
  readonly event_id: string;
  readonly event_type: string;
  readonly metadata: unknown;
  readonly payload: unknown;
  readonly status: 'PENDING';
  readonly stream_name: string;
}
