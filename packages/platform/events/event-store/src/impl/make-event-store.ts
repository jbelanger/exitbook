import type { DomainEvent } from '@exitbook/core';
import type { CloudEventOptions } from '@exitbook/platform-messaging';
import { Effect, pipe } from 'effect';

import { extractCategory } from '../model';
import { createOutboxEntries } from '../outbox/mapper';
import type {
  EventStore,
  EventStoreDatabase,
  StoredEventData,
  StoredEvent,
  PositionedEvent,
  StreamName,
} from '../port';
import { SaveEventError, ReadEventError, OptimisticLockError, IdempotencyError } from '../port';
import { eventRegistry } from '../registry';

interface AppendOptions {
  readonly idempotencyKey?: string;
  readonly metadata?: CloudEventOptions | undefined;
}

/**
 * Creates an EventStore implementation that depends on a low-level database port.
 */
export const makeEventStore = (db: EventStoreDatabase): EventStore => {
  /**
   * Handles the idempotency check using the "insert-first" pattern.
   * If an idempotency key is provided, it attempts to insert it. A unique
   * constraint violation indicates a duplicate request.
   */
  const handleIdempotency = (
    options: AppendOptions,
    firstEventId: string,
  ): Effect.Effect<void, IdempotencyError | SaveEventError> => {
    if (!options.idempotencyKey) {
      return Effect.void;
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // Key expires in 24 hours

    return db
      .insertIdempotencyKey(options.idempotencyKey, firstEventId, expiresAt)
      .pipe(
        Effect.mapError((error) =>
          error instanceof IdempotencyError ? error : new SaveEventError({ reason: error.reason }),
        ),
      );
  };

  /**
   * Performs an optimistic concurrency check by comparing the expected version
   * with the current version of the event stream.
   */
  const checkOptimisticLock = (
    streamName: string,
    expectedVersion: number,
  ): Effect.Effect<void, OptimisticLockError | SaveEventError> =>
    db.getCurrentVersion(streamName).pipe(
      Effect.mapError((error) => new SaveEventError({ reason: error.reason })),
      Effect.flatMap((currentVersion) =>
        currentVersion !== expectedVersion
          ? Effect.fail(
              new OptimisticLockError({
                actualVersion: currentVersion,
                aggregateId: streamName,
                expectedVersion,
              }),
            )
          : Effect.void,
      ),
    );

  /**
   * Encodes domain events into the format required for database storage.
   */
  const prepareEventsForStorage = (
    streamName: string,
    events: readonly DomainEvent[],
    expectedVersion: number,
    options?: AppendOptions,
  ): Effect.Effect<readonly StoredEventData[], SaveEventError> => {
    const category = extractCategory(streamName);
    let streamVersion = expectedVersion;

    return Effect.forEach(events, (event) => {
      streamVersion++;
      return pipe(
        eventRegistry.encode(event),
        Effect.map(
          (encodedData): StoredEventData => ({
            category,
            event_data: encodedData,
            event_id: event.eventId,
            event_schema_version: 1,
            event_type: event._tag,
            metadata: {
              ...options?.metadata,
              timestamp: event.timestamp,
            },
            stream_name: streamName,
            stream_version: streamVersion,
          }),
        ),
      );
    }).pipe(Effect.mapError((error) => new SaveEventError({ reason: error.reason })));
  };

  /**
   * Inserts the prepared events and their corresponding outbox entries into the database.
   */
  const storeEventsAndOutbox = (
    eventsToStore: readonly StoredEventData[],
  ): Effect.Effect<readonly StoredEvent[], SaveEventError> => {
    if (eventsToStore.length === 0) {
      return Effect.succeed([]);
    }

    return db.insertEvents(eventsToStore).pipe(
      Effect.flatMap((insertedEvents) => {
        // Create outbox entries using the mapper
        const outboxEntries = createOutboxEntries(insertedEvents);
        return db.insertOutboxEntries(outboxEntries).pipe(Effect.map(() => insertedEvents));
      }),
      Effect.mapError((error) => new SaveEventError({ reason: error.reason })),
    );
  };

  // ### Main EventStore Implementation ###
  return {
    append: (streamName, events, expectedVersion, options) =>
      Effect.gen(function* () {
        // The main workflow is now a clear sequence of steps
        yield* handleIdempotency(options ?? {}, events[0]?.eventId ?? 'unknown');
        yield* checkOptimisticLock(streamName, expectedVersion);

        const eventsToStore = yield* prepareEventsForStorage(
          streamName,
          events,
          expectedVersion,
          options,
        );

        yield* storeEventsAndOutbox(eventsToStore);
      }).pipe(
        // The entire operation is wrapped in a single transaction
        (workflow) => db.transaction(workflow),
        // A final error mapping ensures any uncaught error is correctly typed
        Effect.mapError((error) =>
          'reason' in error ? new SaveEventError({ reason: String(error.reason) }) : error,
        ),
        Effect.asVoid,
      ),

    appendAndReturn: (streamName, events, expectedVersion, options) =>
      Effect.gen(function* () {
        yield* handleIdempotency(options ?? {}, events[0]?.eventId ?? 'unknown');
        yield* checkOptimisticLock(streamName, expectedVersion);

        const eventsToStore = yield* prepareEventsForStorage(
          streamName,
          events,
          expectedVersion,
          options,
        );

        const insertedEvents = yield* storeEventsAndOutbox(eventsToStore);

        if (insertedEvents.length === 0) {
          return {
            appended: [],
            lastPosition: 0n,
            lastVersion: expectedVersion,
          };
        }

        // Build PositionedEvent[] from the inserted StoredEvent[] results
        const positionedEvents = yield* Effect.forEach(insertedEvents, (storedEvent) => {
          return eventRegistry
            .decode(String(storedEvent.event_type), storedEvent.event_data, {
              eventId: storedEvent.event_id,
              streamName: storedEvent.stream_name,
              streamVersion: storedEvent.stream_version,
              timestamp: storedEvent.created_at,
            })
            .pipe(
              Effect.map(
                (decoded) =>
                  ({
                    ...decoded,
                    position: BigInt(String(storedEvent.global_position || '0')),
                    streamName: streamName,
                  }) as PositionedEvent,
              ),
              Effect.mapError((error) => new SaveEventError({ reason: String(error.reason) })),
            );
        });

        const lastInsertedEvent = insertedEvents[insertedEvents.length - 1]!;
        return {
          appended: positionedEvents,
          lastPosition: BigInt(String(lastInsertedEvent.global_position || '0')),
          lastVersion: lastInsertedEvent.stream_version,
        };
      }).pipe(
        (workflow) => db.transaction(workflow),
        Effect.mapError((error) =>
          'reason' in error ? new SaveEventError({ reason: String(error.reason) }) : error,
        ),
      ),

    healthCheck: () =>
      db.ping().pipe(
        Effect.map(() => true),
        Effect.catchAll(() => Effect.succeed(false)),
      ),

    loadSnapshot: (streamName: string) =>
      db
        .selectLatestSnapshot(streamName)
        .pipe(
          Effect.map((result) =>
            result ? { data: result.data, version: result.version } : undefined,
          ),
        ),

    readAll: (fromPosition: bigint, batchSize: number) =>
      pipe(
        // NOTE: Converting bigint to number for database layer compatibility
        // Consider using string-based SQL queries for truly large positions to avoid overflow
        db.selectAllByPosition(Number(fromPosition), batchSize),
        Effect.mapError((error) => new ReadEventError({ reason: error.reason })),
        Effect.flatMap((storedEvents) =>
          Effect.forEach(storedEvents, (stored) =>
            eventRegistry
              .decode(stored.event_type, stored.event_data, {
                eventId: stored.event_id,
                streamName: stored.stream_name,
                streamVersion: stored.stream_version,
                timestamp: stored.created_at,
              })
              .pipe(
                Effect.map(
                  (decoded) =>
                    ({
                      ...decoded,
                      position: BigInt(String(stored.global_position || '0')),
                      streamName: stored.stream_name as StreamName,
                    }) as PositionedEvent,
                ),
                Effect.mapError((error) => new ReadEventError({ reason: error.reason })),
              ),
          ),
        ),
      ),

    readCategory: (category: string, fromPosition: bigint, batchSize: number) =>
      pipe(
        db.selectEventsByCategory(category, Number(fromPosition), batchSize),
        Effect.mapError((error) => new ReadEventError({ reason: error.reason })),
        Effect.flatMap((storedEvents) =>
          Effect.forEach(storedEvents, (stored) =>
            eventRegistry
              .decode(stored.event_type, stored.event_data, {
                eventId: stored.event_id,
                streamName: stored.stream_name,
                streamVersion: stored.stream_version,
                timestamp: stored.created_at,
              })
              .pipe(
                Effect.map(
                  (decoded) =>
                    ({
                      ...decoded,
                      position: BigInt(String(stored.global_position || '0')),
                      streamName: stored.stream_name as StreamName,
                    }) as PositionedEvent,
                ),
                Effect.mapError((error) => new ReadEventError({ reason: error.reason })),
              ),
          ),
        ),
      ),

    readStream: (streamName: string, fromVersion = 0, toVersion?: number) =>
      pipe(
        db.selectEventsByStream(streamName, fromVersion, toVersion),
        Effect.mapError((error) => new ReadEventError({ reason: error.reason })),
        Effect.flatMap((storedEvents) =>
          Effect.forEach(storedEvents, (stored) =>
            eventRegistry
              .decode(stored.event_type, stored.event_data, {
                eventId: stored.event_id,
                streamName: stored.stream_name,
                streamVersion: stored.stream_version,
                timestamp: stored.created_at,
              })
              .pipe(Effect.mapError((error) => new ReadEventError({ reason: error.reason }))),
          ),
        ),
      ),

    saveSnapshot: (streamName: string, version: number, data: unknown) =>
      db.insertSnapshot(streamName, version, 1, data),
  };
};
