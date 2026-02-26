import { sql } from 'kysely';
import type { Migration } from 'kysely';
import { describe, expect, it } from 'vitest';

import { closeSqliteDatabase } from '../close.js';
import { createSqliteDatabase } from '../database.js';
import { runMigrations } from '../migrations.js';

describe('runMigrations', () => {
  it('executes registered migrations', async () => {
    const dbResult = createSqliteDatabase<Record<string, never>>(':memory:');
    expect(dbResult.isOk()).toBe(true);
    const db = dbResult._unsafeUnwrap();

    const migrations: Record<string, Migration> = {
      '001_create_notes': {
        up: async (kysely) => {
          await kysely.schema
            .createTable('notes')
            .addColumn('id', 'integer', (c) => c.primaryKey())
            .execute();
        },
      },
    };

    const migrationResult = await runMigrations(db, migrations);
    expect(migrationResult.isOk()).toBe(true);

    const tableCheck = await sql<{ name: string }>`
      select name from sqlite_master where type = 'table' and name = 'notes'
    `.execute(db);
    expect(tableCheck.rows[0]?.name).toBe('notes');

    const closeResult = await closeSqliteDatabase(db);
    expect(closeResult.isOk()).toBe(true);
  });
});
