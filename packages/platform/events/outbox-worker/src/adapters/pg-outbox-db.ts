import { DatabasePool } from '@exitbook/platform-database';
import { Effect, Layer } from 'effect';
import { Kysely, PostgresDialect, sql } from 'kysely';

import type { OutboxDatabase, OutboxEntry } from '../outbox-processor';
import {
  OutboxReadError,
  OutboxProcessError,
  OutboxDatabase as OutboxDatabaseTag,
} from '../outbox-processor';

// Database schema for outbox table
interface OutboxDB {
  event_outbox: {
    attempts: number;
    category: string;
    created_at: Date;
    event_id: string;
    event_position: string;
    event_schema_version: number;
    event_type: string;
    id: string;
    last_error?: string;
    metadata: unknown;
    next_attempt_at: Date;
    payload: unknown;
    processed_at?: Date;
    status: string;
    stream_name: string;
    updated_at: Date;
  };
}

const makeKysely = Effect.gen(function* () {
  const { pool } = yield* DatabasePool;
  return new Kysely<OutboxDB>({ dialect: new PostgresDialect({ pool }) });
});

// Helper to map database errors to OutboxProcessError
const mapProcessError = (error: unknown) => new OutboxProcessError({ reason: String(error) });

// Helper to create timestamp update object
const withNow = () => ({ updated_at: sql<Date>`now()` });

export const makePgOutboxDatabase = Effect.gen(function* () {
  const db = yield* makeKysely;

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

        return result;
      }).pipe(
        Effect.map(
          (rows) =>
            rows.map((row) => ({
              ...row,
              event_position: BigInt(row.event_position),
              id: Number(row.id),
            })) as OutboxEntry[],
        ),
        Effect.mapError((error) => new OutboxReadError({ reason: String(error) })),
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
      ).pipe(Effect.asVoid, Effect.mapError(mapProcessError)),

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
              event_position: BigInt(row.event_position),
              id: Number(row.id),
            })) as OutboxEntry[],
        ),
        Effect.mapError((error) => new OutboxReadError({ reason: String(error) })),
      ),

    transaction: <A, E>(effect: Effect.Effect<A, E, never>) =>
      Effect.tryPromise(async () => {
        return await db.transaction().execute(async () => {
          return await Effect.runPromise(effect);
        });
      }).pipe(Effect.mapError(mapProcessError)),

    updateEventForRetry: (eventId: string, nextAttemptAt: Date, lastError?: string) =>
      Effect.tryPromise(() =>
        db
          .updateTable('event_outbox')
          .set((eb) => ({
            attempts: eb('attempts', '+', 1), // Increment attempts on DB side
            next_attempt_at: nextAttemptAt,
            status: 'PENDING',
            ...withNow(),
            ...(lastError && { last_error: lastError.substring(0, 2000) }), // Truncate to reasonable length
          }))
          .where('event_id', '=', eventId)
          .execute(),
      ).pipe(Effect.asVoid, Effect.mapError(mapProcessError)),

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
      ).pipe(Effect.asVoid, Effect.mapError(mapProcessError)),
  } satisfies OutboxDatabase;
});

// Layer factory for OutboxDatabase
export const PgOutboxDatabaseLive = Layer.effect(OutboxDatabaseTag, makePgOutboxDatabase);

// Re-export the interface and tag for convenience
export { OutboxDatabase } from '../outbox-processor';
