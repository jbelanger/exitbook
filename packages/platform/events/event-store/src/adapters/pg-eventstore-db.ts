import { DatabasePool, type PgPool } from '@exitbook/platform-database';
import { Effect } from 'effect';
import { Kysely, PostgresDialect } from 'kysely';

import type { EventStoreDatabase, StoredEvent, OutboxEntryData } from '../port';

// Event store schema types
export interface EventStoreDB {
  event_idempotency: {
    event_id: string;
    expires_at: Date;
    idempotency_key: string;
  };
  event_outbox: {
    category: string;
    created_at?: Date;
    event_id: string;
    event_type: string;
    id?: string;
    metadata: unknown;
    payload: unknown;
    status: string;
    stream_name: string;
    updated_at?: Date;
  };
  event_snapshots: {
    created_at?: Date;
    data: unknown;
    schema_version: number;
    stream_name: string;
    version: number;
  };
  event_store: {
    category: string;
    created_at?: Date;
    event_data: unknown;
    event_id: string;
    event_schema_version: number;
    event_type: string;
    global_position?: number;
    id?: number;
    metadata: unknown;
    occurred_at?: Date;
    stream_name: string;
    stream_version: number;
  };
}

const makeKysely = Effect.gen(function* () {
  const { pool } = yield* DatabasePool;
  return new Kysely<EventStoreDB>({ dialect: new PostgresDialect({ pool }) });
});

// Strictly DB concerns only; no SaveEventError/ReadEventError here.
export const makePgEventStoreDatabase = (): Effect.Effect<EventStoreDatabase, never, PgPool> =>
  Effect.gen(function* () {
    const db = yield* makeKysely;

    return {
      getCurrentVersion: (streamName) =>
        Effect.tryPromise(() =>
          db
            .selectFrom('event_store')
            .select((eb) => eb.fn.coalesce(eb.fn.max('stream_version'), eb.val(0)).as('version'))
            .where('stream_name', '=', streamName)
            .executeTakeFirst(),
        ).pipe(
          Effect.map((result) => result?.version ?? 0),
          Effect.mapError((error) => ({ reason: String(error) })),
        ),

      insertEvents: (rows) =>
        Effect.tryPromise(() =>
          db
            .insertInto('event_store')
            .values(
              rows.map((row) => ({
                category: row.category,
                event_data: row.event_data,
                event_id: row.event_id,
                event_schema_version: row.event_schema_version,
                event_type: row.event_type,
                metadata: row.metadata,
                stream_name: row.stream_name,
                stream_version: row.stream_version,
              })),
            )
            .execute(),
        ).pipe(
          Effect.asVoid,
          Effect.mapError((error) => ({ reason: String(error) })),
        ),

      insertIdempotencyKey: (k, eventId, exp) =>
        Effect.tryPromise(() =>
          db
            .insertInto('event_idempotency')
            .values({ event_id: eventId, expires_at: exp, idempotency_key: k })
            .execute(),
        ).pipe(
          Effect.asVoid,
          Effect.mapError((error) => ({ reason: String(error) })),
        ),

      insertOutboxEntries: (rows: readonly OutboxEntryData[]) =>
        Effect.tryPromise(() =>
          db
            .insertInto('event_outbox')
            .values(
              rows.map((row) => ({
                category: row.category,
                event_id: row.event_id,
                event_type: row.event_type,
                metadata: row.metadata,
                payload: row.payload,
                status: row.status,
                stream_name: row.stream_name,
              })),
            )
            .execute(),
        ).pipe(
          Effect.asVoid,
          Effect.mapError((error) => ({ reason: String(error) })),
        ),

      insertSnapshot: (streamName: string, version: number, schemaVersion: number, data: unknown) =>
        Effect.tryPromise(() =>
          db
            .insertInto('event_snapshots')
            .values({ data, schema_version: schemaVersion, stream_name: streamName, version })
            .onConflict((oc) =>
              oc
                .columns(['stream_name', 'version'])
                .doUpdateSet({ data, schema_version: schemaVersion }),
            )
            .execute(),
        ).pipe(
          Effect.asVoid,
          Effect.mapError((error) => ({ reason: String(error) })),
        ),

      ping: () =>
        Effect.tryPromise(() =>
          db
            .selectFrom('event_store')
            .select((eb) => eb.val(1).as('ping'))
            .limit(1)
            .execute(),
        ).pipe(
          Effect.asVoid,
          Effect.mapError((error) => ({ reason: String(error) })),
        ),

      selectEventsByCategory: (category: string, fromPosition: number, batchSize: number) =>
        Effect.tryPromise(() =>
          db
            .selectFrom('event_store')
            .selectAll()
            .where('category', '=', category)
            .where('global_position', '>', fromPosition)
            .orderBy('global_position', 'asc')
            .limit(batchSize)
            .execute(),
        ).pipe(
          Effect.map((rows) => rows as StoredEvent[]),
          Effect.mapError((error) => ({ reason: String(error) })),
        ),

      selectEventsByStream: (streamName: string, from: number, to?: number) =>
        Effect.tryPromise(() => {
          let query = db
            .selectFrom('event_store')
            .selectAll()
            .where('stream_name', '=', streamName)
            .where('stream_version', '>', from);

          if (to !== undefined) {
            query = query.where('stream_version', '<=', to);
          }

          return query.orderBy('stream_version', 'asc').execute();
        }).pipe(
          Effect.map((rows) => rows as StoredEvent[]),
          Effect.mapError((error) => ({ reason: String(error) })),
        ),

      selectLatestSnapshot: (streamName: string) =>
        Effect.tryPromise(() =>
          db
            .selectFrom('event_snapshots')
            .select(['data', 'version'])
            .where('stream_name', '=', streamName)
            .orderBy('version', 'desc')
            .limit(1)
            .executeTakeFirst(),
        ).pipe(
          Effect.map((result) => result ?? undefined),
          Effect.mapError((error) => ({ reason: String(error) })),
        ),

      transaction: <A, E>(fa: Effect.Effect<A, E>) =>
        Effect.tryPromise(async () => {
          return await db.transaction().execute(async () => {
            return await Effect.runPromise(fa);
          });
        }).pipe(Effect.mapError((error) => ({ reason: String(error) }))),
    } satisfies EventStoreDatabase;
  });

// Ensure DB uniqueness at DDL level (enforced race-proofing)
export const createIndexesSql = `
CREATE UNIQUE INDEX IF NOT EXISTS ux_event_stream_version ON event_store(stream_name, stream_version);
`;
