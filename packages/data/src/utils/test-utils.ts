import { DataSession } from '../data-session.js';
import type { KyselyDB } from '../database.js';
import { createDatabase, runMigrations } from '../database.js';

/**
 * Create an in-memory database with migrations applied. For use in tests only.
 */
export async function createTestDatabase(): Promise<KyselyDB> {
  const dbResult = createDatabase(':memory:');
  if (dbResult.isErr()) {
    throw dbResult.error;
  }

  const db = dbResult.value;
  const migrationResult = await runMigrations(db);
  if (migrationResult.isErr()) {
    await db.destroy();
    throw migrationResult.error;
  }

  return db;
}

/**
 * Create an in-memory DataSession with migrations applied. For use in tests only.
 */
export async function createTestDataSession(): Promise<DataSession> {
  const db = await createTestDatabase();
  return new DataSession(db);
}
