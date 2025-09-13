import { Effect } from 'effect';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import { DbClient } from '../client';

export interface MigrationLogRow {
  applied_at?: Date;
  checksum: string;
  package: string;
  version: string;
}

export interface MigrationLogDB {
  migration_log: MigrationLogRow;
}

export const ensureMigrationLogTable = Effect.gen(function* () {
  const db = yield* DbClient;

  yield* Effect.tryPromise(() =>
    db.schema
      .createTable('migration_log')
      .ifNotExists()
      .addColumn('package', 'text', (c) => c.notNull())
      .addColumn('version', 'text', (c) => c.notNull())
      .addColumn('checksum', 'text', (c) => c.notNull())
      .addColumn('applied_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addPrimaryKeyConstraint('pk_migration_log', ['package', 'version'])
      .execute(),
  );
});

export const getAppliedMigrations = (packageName: string) =>
  Effect.gen(function* () {
    const db = yield* DbClient;

    const results = yield* Effect.tryPromise(() =>
      (db as Kysely<MigrationLogDB>)
        .selectFrom('migration_log')
        .select(['version', 'checksum'])
        .where('package', '=', packageName)
        .orderBy('version')
        .execute(),
    );

    return results;
  });

export const recordMigration = (packageName: string, version: string, checksum: string) =>
  Effect.gen(function* () {
    const db = yield* DbClient;

    yield* Effect.tryPromise(() =>
      (db as Kysely<MigrationLogDB>)
        .insertInto('migration_log')
        .values({
          checksum,
          package: packageName,
          version,
        })
        .execute(),
    );
  });
