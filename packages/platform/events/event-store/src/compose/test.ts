import { Layer, Effect, Ref } from 'effect';

import { EventStoreDatabaseTag } from '..';
import type { EventStoreDatabase, StoredEventData, OutboxEntryData, StoredEvent } from '../port';
import { IdempotencyError } from '../port';

import { EventStoreLive } from './default';

// In-memory fake EventStore database for testing
const makeFakeEventStoreDatabase = (): Effect.Effect<EventStoreDatabase, never> =>
  Effect.gen(function* () {
    const events = yield* Ref.make<StoredEvent[]>([]);
    const snapshots = yield* Ref.make<
      {
        data: unknown;
        schema_version: number;
        stream_name: string;
        version: number;
      }[]
    >([]);
    const outboxEntries = yield* Ref.make<
      {
        category: string;
        event_id: string;
        event_type: string;
        metadata: unknown;
        payload: unknown;
        status: 'PENDING' | 'PROCESSED' | 'FAILED';
        stream_name: string;
      }[]
    >([]);
    const idempotencyKeys = yield* Ref.make<Set<string>>(new Set());

    let idCounter = 1;
    let globalPos = 0;

    return {
      getCurrentVersion: (streamName: string) =>
        Effect.gen(function* () {
          const allEvents = yield* Ref.get(events);
          const streamEvents = allEvents.filter((e) => e.stream_name === streamName);
          return streamEvents.length > 0
            ? Math.max(...streamEvents.map((e) => e.stream_version))
            : 0;
        }),

      insertEvents: (eventsData: readonly StoredEventData[]) =>
        Effect.gen(function* () {
          const storedEvents: StoredEvent[] = eventsData.map((e) => ({
            ...e,
            created_at: new Date(),
            global_position: ++globalPos,
            id: idCounter++,
          }));
          yield* Ref.update(events, (existing) => [...existing, ...storedEvents]);
        }),

      insertIdempotencyKey: (key: string, _eventId: string, _expiresAt: Date) =>
        Effect.gen(function* () {
          const keys = yield* Ref.get(idempotencyKeys);
          if (keys.has(key)) {
            return yield* Effect.fail(
              new IdempotencyError({
                reason: `Duplicate idempotency key: ${key}`,
              }),
            );
          }
          yield* Ref.update(idempotencyKeys, (keys) => new Set([...keys, key]));
        }),

      insertOutboxEntries: (entries: readonly OutboxEntryData[]) =>
        Ref.update(outboxEntries, (existing) => [...existing, ...entries]).pipe(Effect.asVoid),

      insertSnapshot: (streamName: string, version: number, schemaVersion: number, data: unknown) =>
        Ref.update(snapshots, (existing) => {
          const filtered = existing.filter(
            (s) => !(s.stream_name === streamName && s.version === version),
          );
          return [
            ...filtered,
            { data, schema_version: schemaVersion, stream_name: streamName, version },
          ];
        }).pipe(Effect.asVoid),

      ping: () => Effect.void,

      selectEventsByCategory: (category: string, fromPosition?: number, batchSize?: number) =>
        Effect.gen(function* () {
          const allEvents = yield* Ref.get(events);
          let filtered = allEvents.filter((e) => e.category === category);

          if (fromPosition !== undefined) {
            filtered = filtered.filter((e) => (e.global_position || 0) > fromPosition);
          }

          if (batchSize !== undefined) {
            filtered = filtered.slice(0, batchSize);
          }

          return filtered;
        }),

      selectEventsByStream: (streamName: string, fromVersion?: number, toVersion?: number) =>
        Effect.gen(function* () {
          const allEvents = yield* Ref.get(events);
          let filtered = allEvents.filter((e) => e.stream_name === streamName);

          if (fromVersion !== undefined) {
            filtered = filtered.filter((e) => e.stream_version > fromVersion);
          }

          if (toVersion !== undefined) {
            filtered = filtered.filter((e) => e.stream_version <= toVersion);
          }

          return filtered.sort((a, b) => a.stream_version - b.stream_version);
        }),

      selectLatestSnapshot: (streamName: string) =>
        Effect.gen(function* () {
          const allSnapshots = yield* Ref.get(snapshots);
          const streamSnapshots = allSnapshots
            .filter((s) => s.stream_name === streamName)
            .sort((a, b) => b.version - a.version);

          if (streamSnapshots.length === 0) return;
          const snapshot = streamSnapshots[0]!;
          return {
            data: snapshot.data,
            schema_version: snapshot.schema_version,
            version: snapshot.version,
          };
        }),

      transaction: <A, E>(effect: Effect.Effect<A, E, never>) => effect,
    };
  });

// Layer that provides the fake EventStore database
const FakeEventStoreDatabaseLive = Layer.effect(
  EventStoreDatabaseTag,
  makeFakeEventStoreDatabase(),
);

// Test composition - EventStore + in-memory fake adapter
export const EventStoreTest = Layer.provide(EventStoreLive, FakeEventStoreDatabaseLive);
