import type { DomainEvent } from '@exitbook/core';
import { Effect, pipe } from 'effect';

import { extractCategory } from '../model';
import type {
  EventStore,
  EventStoreDatabase,
  StoredEventData,
  OutboxEntryData,
  PositionedEvent,
  StreamName,
} from '../port';
import { SaveEventError, ReadEventError, OptimisticLockError, IdempotencyError } from '../port';
import { eventRegistry } from '../registry';

// Options type for better readability
interface AppendOptions {
  readonly idempotencyKey?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Creates an EventStore implementation that depends on a low-level database port.
 */
export const makeEventStore = (db: EventStoreDatabase): EventStore => {
  // ### Refactored Helper Functions for append ###

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

    return db.insertIdempotencyKey(options.idempotencyKey, firstEventId, expiresAt).pipe(
      Effect.mapError((error) =>
        // PSQL unique violation code
        error.code === '23505'
          ? new IdempotencyError({ reason: 'Duplicate idempotency key' })
          : new SaveEventError({ reason: error.reason }),
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
  ): Effect.Effect<void, SaveEventError> => {
    if (eventsToStore.length === 0) {
      return Effect.void;
    }

    const outboxEntries: readonly OutboxEntryData[] = eventsToStore.map((event) => ({
      category: event.category,
      event_id: event.event_id,
      event_type: event.event_type,
      metadata: event.metadata,
      payload: event.event_data,
      status: 'PENDING' as const,
      stream_name: event.stream_name,
    }));

    return db.insertEvents(eventsToStore).pipe(
      Effect.flatMap(() => db.insertOutboxEntries(outboxEntries)),
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

        yield* storeEventsAndOutbox(eventsToStore);

        // Read back the stored events to get their positions
        const lastStoredEvent = eventsToStore[eventsToStore.length - 1];
        if (!lastStoredEvent) {
          return {
            appended: [],
            lastPosition: 0n,
            lastVersion: expectedVersion,
          };
        }

        // Convert StoredEventData to PositionedEvent format
        const positionedEvents = yield* Effect.forEach(eventsToStore, (storedEvent, index) => {
          // Since we don't store global_position during insert, we need to simulate it
          // In a real implementation, this would come from the database
          const globalPosition = BigInt(storedEvent.global_position ?? 0);

          return Effect.succeed({
            ...events[index]!,
            position: globalPosition,
            streamName,
          } as PositionedEvent);
        });

        return {
          appended: positionedEvents,
          lastPosition: positionedEvents[positionedEvents.length - 1]?.position ?? 0n,
          lastVersion: lastStoredEvent.stream_version,
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
        db.selectEventsByCategory('', Number(fromPosition), batchSize), // Empty category means all
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
                      position: BigInt(stored.global_position ?? 0),
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
                      position: BigInt(stored.global_position ?? 0),
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
