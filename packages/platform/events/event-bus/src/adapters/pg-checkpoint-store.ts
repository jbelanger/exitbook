import { DatabasePool } from '@exitbook/platform-database';
import { Context, Effect, Layer } from 'effect';
import { Kysely, PostgresDialect } from 'kysely';

import type { CheckpointStore } from '../checkpoint-store';
import { CheckpointError } from '../errors';

export const KyselyTag = Context.GenericTag<Kysely<CheckpointStoreDB>>('CheckpointStore/Kysely');

export const KyselyLive = Layer.effect(
  KyselyTag,
  Effect.gen(function* () {
    const { pool } = yield* DatabasePool;
    return new Kysely<CheckpointStoreDB>({ dialect: new PostgresDialect({ pool }) });
  }),
);

// Checkpoint store schema types
export interface CheckpointStoreDB {
  subscription_checkpoints: {
    events_processed?: bigint;
    last_processed?: Date;
    position: string;
    subscription_id: string;
    updated_at?: Date;
  };
}

export const makePgCheckpointStore = (): Effect.Effect<
  CheckpointStore,
  never,
  Kysely<CheckpointStoreDB>
> =>
  Effect.gen(function* () {
    const db = yield* KyselyTag;

    return {
      load: (subscriptionKey) =>
        Effect.tryPromise(() =>
          db
            .selectFrom('subscription_checkpoints')
            .select('position')
            .where('subscription_id', '=', subscriptionKey)
            .executeTakeFirst(),
        ).pipe(
          Effect.map((result) => (result ? BigInt(result.position) : undefined)),
          Effect.mapError(
            (error) =>
              new CheckpointError({ reason: `Failed to load checkpoint: ${String(error)}` }),
          ),
        ),

      save: (subscriptionKey, position) =>
        Effect.tryPromise(() =>
          db
            .insertInto('subscription_checkpoints')
            .values({
              position: position.toString(),
              subscription_id: subscriptionKey,
              updated_at: new Date(),
            })
            .onConflict((oc) =>
              oc.column('subscription_id').doUpdateSet({
                position: position.toString(),
                updated_at: new Date(),
              }),
            )
            .execute(),
        ).pipe(
          Effect.asVoid,
          Effect.mapError(
            (error) =>
              new CheckpointError({ reason: `Failed to save checkpoint: ${String(error)}` }),
          ),
        ),

      saveWithMetadata: (subscriptionKey, position, metadata) =>
        Effect.tryPromise(() =>
          db
            .insertInto('subscription_checkpoints')
            .values({
              events_processed: BigInt(metadata.eventsProcessed),
              last_processed: metadata.lastProcessed,
              position: position.toString(),
              subscription_id: subscriptionKey,
              updated_at: new Date(),
            })
            .onConflict((oc) =>
              oc.column('subscription_id').doUpdateSet((eb) => ({
                events_processed: eb('events_processed', '+', BigInt(metadata.eventsProcessed)),
                last_processed: metadata.lastProcessed,
                position: position.toString(),
                updated_at: new Date(),
              })),
            )
            .execute(),
        ).pipe(
          Effect.asVoid,
          Effect.mapError(
            (error) =>
              new CheckpointError({
                reason: `Failed to save checkpoint with metadata: ${String(error)}`,
              }),
          ),
        ),
    } satisfies CheckpointStore;
  });
