import { DataContext } from '../data-context.js';
import type { KyselyDB } from '../storage/initialization.js';
import { createDatabase } from '../storage/initialization.js';
import { runMigrations } from '../storage/migrations.js';

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
 * Create an in-memory DataContext with migrations applied. For use in tests only.
 */
export async function createTestDataContext(): Promise<DataContext> {
  const db = await createTestDatabase();
  return new DataContext(db);
}
