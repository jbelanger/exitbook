import { DatabasePool } from '@exitbook/platform-database';
import { Context, Layer, Effect } from 'effect';
import { Kysely, PostgresDialect } from 'kysely';

import type { EventStoreDB } from './pg-eventstore-db';

export const KyselyTag = Context.GenericTag<Kysely<EventStoreDB>>('EventStore/Kysely');

export const KyselyLive = Layer.effect(
  KyselyTag,
  Effect.gen(function* () {
    const { pool } = yield* DatabasePool;
    return new Kysely<EventStoreDB>({ dialect: new PostgresDialect({ pool }) });
  }),
);
