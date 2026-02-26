import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import { closeSqliteDatabase } from '../close.js';
import { createSqliteDatabase } from '../database.js';

describe('createSqliteDatabase', () => {
  it('creates an in-memory sqlite database', async () => {
    const dbResult = createSqliteDatabase<Record<string, never>>(':memory:');
    expect(dbResult.isOk()).toBe(true);

    const db = dbResult._unsafeUnwrap();
    const row = await sql<{ value: number }>`select 1 as value`.execute(db);
    expect(row.rows[0]?.value).toBe(1);

    const closeResult = await closeSqliteDatabase(db);
    expect(closeResult.isOk()).toBe(true);
  });
});
