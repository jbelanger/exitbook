import { Context, Effect } from 'effect';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import type {
  EventStoreDatabase,
  StoredEvent,
  OutboxEntryData,
  OutboxDatabase,
  OutboxEntry,
} from '../../port';
import { IdempotencyError } from '../../port';

export const KyselyTag = Context.GenericTag<Kysely<EventStoreDB>>(
  '@exitbook/platform-event-store/EventStoreDB',
);

// Event store schema types
export interface EventStoreDB {
  event_idempotency: {
    event_id: string;
    expires_at: Date;
    idempotency_key: string;
  };
  event_outbox: {
    attempts: number;
    category: string;
    created_at?: Date;
    event_data: unknown;
    event_id: string;
    event_position: bigint;
    event_schema_version: number;
    event_type: string;
    id?: string;
    last_error?: string;
    metadata: unknown;
    next_attempt_at: Date;
    occurred_at?: Date;
    processed_at?: Date;
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

// Strictly DB concerns only; no SaveEventError/ReadEventError here.
export const makePgEventStoreDatabase = Effect.gen(function* () {
  const db = yield* KyselyTag;

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
              occurred_at: row.occurred_at,
              stream_name: row.stream_name,
              stream_version: row.stream_version,
            })),
          )
          .returning([
            'id',
            'created_at',
            'occurred_at',
            'global_position',
            'stream_version',
            'event_id',
            'event_type',
            'event_data',
            'metadata',
            'category',
            'stream_name',
            'event_schema_version',
          ])
          .execute(),
      ).pipe(
        Effect.map(
          (results) =>
            results.map((row) => ({
              ...row,
              global_position: row.global_position?.toString(),
            })) as StoredEvent[],
        ),
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
        Effect.mapError((error: unknown) => {
          // Map PostgreSQL unique violation to typed IdempotencyError
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === '23505'
          ) {
            return new IdempotencyError({ reason: 'Duplicate idempotency key' });
          }
          return { reason: String(error) };
        }),
      ),

    insertOutboxEntries: (rows: readonly OutboxEntryData[]) =>
      Effect.tryPromise(() =>
        db
          .insertInto('event_outbox')
          .values(
            rows.map((row) => ({
              attempts: 0,
              category: row.category,
              event_data: row.event_data,
              event_id: row.event_id,
              event_position: row.event_position,
              event_schema_version: row.event_schema_version,
              event_type: row.event_type,
              metadata: row.metadata,
              next_attempt_at: new Date(),
              occurred_at: row.occurred_at,
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

    selectAllByPosition: (fromPosition: number, batchSize: number) =>
      Effect.tryPromise(() =>
        db
          .selectFrom('event_store')
          .selectAll()
          .where('global_position', '>', fromPosition)
          .orderBy('global_position', 'asc')
          .limit(batchSize)
          .execute(),
      ).pipe(
        Effect.map(
          (rows) =>
            rows.map((row) => ({
              ...row,
              global_position: row.global_position?.toString(),
            })) as StoredEvent[],
        ),
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
        Effect.map(
          (rows) =>
            rows.map((row) => ({
              ...row,
              global_position: row.global_position?.toString(),
            })) as StoredEvent[],
        ),
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
        Effect.map(
          (rows) =>
            rows.map((row) => ({
              ...row,
              global_position: row.global_position?.toString(),
            })) as StoredEvent[],
        ),
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

// Outbox database implementation using the same Kysely instance
export const makePgOutboxDatabase = Effect.gen(function* () {
  const db = yield* KyselyTag;

  // Helper to create timestamp update object
  const withNow = () => ({ updated_at: sql<Date>`now()` });

  // Helper to map database errors
  const mapError = (error: unknown) => ({ reason: String(error) });

  return {
    claimPendingEvents: (batchSize: number) =>
      Effect.tryPromise(async () => {
        // Use CTE with SKIP LOCKED for concurrent processing
        const result = await db
          .with('to_claim', (cte) =>
            cte
              .selectFrom('event_outbox')
              .select('id')
              .where('status', '=', 'PENDING')
              .where('next_attempt_at', '<=', new Date())
              .orderBy('id')
              .limit(batchSize)
              .forUpdate()
              .skipLocked(),
          )
          .updateTable('event_outbox')
          .set({
            attempts: sql`attempts + 1`,
            status: 'PROCESSING',
            updated_at: sql<Date>`now()`,
          })
          .from('to_claim')
          .whereRef('event_outbox.id', '=', 'to_claim.id')
          .returningAll()
          .execute();

        return result.map((row) => ({
          ...row,
          event_position:
            typeof row.event_position === 'string'
              ? BigInt(row.event_position)
              : row.event_position,
          id: row.id || '',
        })) as OutboxEntry[];
      }).pipe(Effect.mapError(mapError)),

    getDLQSize: () =>
      Effect.tryPromise(() =>
        db
          .selectFrom('event_outbox')
          .select((eb) => eb.fn.count('id').as('count'))
          .where('status', '=', 'FAILED')
          .executeTakeFirst(),
      ).pipe(
        Effect.map((result) => Number(result?.count ?? 0)),
        Effect.mapError(mapError),
      ),

    getQueueDepth: () =>
      Effect.tryPromise(() =>
        db
          .selectFrom('event_outbox')
          .select((eb) => eb.fn.count('id').as('count'))
          .where('status', '=', 'PENDING')
          .where('next_attempt_at', '<=', new Date())
          .executeTakeFirst(),
      ).pipe(
        Effect.map((result) => Number(result?.count ?? 0)),
        Effect.mapError(mapError),
      ),

    markAsDLQ: (eventId: string) =>
      Effect.tryPromise(() =>
        db
          .updateTable('event_outbox')
          .set({
            status: 'FAILED',
            ...withNow(),
          })
          .where('event_id', '=', eventId)
          .execute(),
      ).pipe(Effect.asVoid, Effect.mapError(mapError)),

    selectPendingEvents: (batchSize: number) =>
      Effect.tryPromise(() =>
        db
          .selectFrom('event_outbox')
          .selectAll()
          .where('status', '=', 'PENDING')
          .where('next_attempt_at', '<=', new Date())
          .orderBy('id')
          .limit(batchSize)
          .execute(),
      ).pipe(
        Effect.map(
          (rows) =>
            rows.map((row) => ({
              ...row,
              event_position:
                typeof row.event_position === 'string'
                  ? BigInt(row.event_position)
                  : row.event_position,
              id: row.id || '',
            })) as OutboxEntry[],
        ),
        Effect.mapError(mapError),
      ),

    transaction: <A, E>(effect: Effect.Effect<A, E, never>) =>
      Effect.tryPromise(async () => {
        return await db.transaction().execute(async () => {
          return await Effect.runPromise(effect);
        });
      }).pipe(Effect.mapError(mapError)),

    updateEventForRetry: (eventId: string, nextAttemptAt: Date, lastError?: string) =>
      Effect.tryPromise(() =>
        db
          .updateTable('event_outbox')
          .set({
            next_attempt_at: nextAttemptAt,
            status: 'PENDING',
            ...withNow(),
            ...(lastError && { last_error: lastError.substring(0, 2000) }),
          })
          .where('event_id', '=', eventId)
          .execute(),
      ).pipe(Effect.asVoid, Effect.mapError(mapError)),

    updateEventStatus: (
      eventId: string,
      status: 'PROCESSED' | 'FAILED' | 'PROCESSING',
      processedAt?: Date,
    ) =>
      Effect.tryPromise(() =>
        db
          .updateTable('event_outbox')
          .set({
            status,
            ...withNow(),
            ...(processedAt && status === 'PROCESSED' && { processed_at: processedAt }),
          })
          .where('event_id', '=', eventId)
          .execute(),
      ).pipe(Effect.asVoid, Effect.mapError(mapError)),
  } satisfies OutboxDatabase;
});
