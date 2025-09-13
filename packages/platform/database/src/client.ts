import { Context, Layer, Effect } from 'effect';
import { Kysely, PostgresDialect } from 'kysely';

import { DbPool } from './pool';
import { DbTelemetryLive } from './telemetry';

export const DbClient = Context.GenericTag<Kysely<unknown>>('@exitbook/platform-database/DbClient');

export const DbClientLive = Layer.effect(
  DbClient,
  Effect.gen(function* () {
    const { pool } = yield* DbPool;
    const client = new Kysely({ dialect: new PostgresDialect({ pool }) });
    return client;
  }),
);

// DbClientLive with telemetry included by default
export const DbClientWithTelemetryLive = Layer.provide(DbTelemetryLive, DbClientLive);
