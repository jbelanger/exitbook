import { DatabasePool } from '@exitbook/platform-database';
import { Effect, Layer } from 'effect';
import { Kysely, PostgresDialect, sql } from 'kysely';

import type { EventMetadata } from '../model';
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
            updated_at: sql`now()`,
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
              id: Number(row.id),
              metadata: row.metadata as EventMetadata,
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
            updated_at: sql`now()`,
          })
          .where('event_id', '=', eventId)
          .execute(),
      ).pipe(
        Effect.asVoid,
        Effect.mapError((error) => new OutboxProcessError({ reason: String(error) })),
      ),

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
              id: Number(row.id),
              metadata: row.metadata as EventMetadata,
            })) as OutboxEntry[],
        ),
        Effect.mapError((error) => new OutboxReadError({ reason: String(error) })),
      ),

    transaction: <A, E>(effect: Effect.Effect<A, E, never>) =>
      Effect.tryPromise(async () => {
        return await db.transaction().execute(async () => {
          return await Effect.runPromise(effect);
        });
      }).pipe(Effect.mapError((error) => new OutboxProcessError({ reason: String(error) }))),

    updateEventForRetry: (
      eventId: string,
      attempts: number,
      nextAttemptAt: Date,
      lastError?: string,
    ) =>
      Effect.tryPromise(() =>
        db
          .updateTable('event_outbox')
          .set({
            attempts,
            next_attempt_at: nextAttemptAt,
            status: 'PENDING',
            updated_at: sql`now()`,
            ...(lastError && { last_error: lastError.substring(0, 2000) }), // Truncate to reasonable length
          })
          .where('event_id', '=', eventId)
          .execute(),
      ).pipe(
        Effect.asVoid,
        Effect.mapError((error) => new OutboxProcessError({ reason: String(error) })),
      ),

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
            updated_at: sql`now()`,
            ...(processedAt && status === 'PROCESSED' && { processed_at: processedAt }),
          })
          .where('event_id', '=', eventId)
          .execute(),
      ).pipe(
        Effect.asVoid,
        Effect.mapError((error) => new OutboxProcessError({ reason: String(error) })),
      ),
  } satisfies OutboxDatabase;
});

// Layer factory for OutboxDatabase
export const PgOutboxDatabaseLive = Layer.effect(OutboxDatabaseTag, makePgOutboxDatabase);

// Re-export the interface and tag for convenience
export { OutboxDatabase } from '../outbox-processor';
