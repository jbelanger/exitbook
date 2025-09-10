import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { Kysely, Migrator, FileMigrationProvider, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

export async function runMigrations(migrationFolder: string) {
  const pool = new Pool({ connectionString: process.env['DB_URL'] });
  const db = new Kysely({ dialect: new PostgresDialect({ pool }) });

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      migrationFolder,
      path,
    }),
  });

  const { error, results } = await migrator.migrateToLatest();

  if (results) {
    results.forEach((it) => {
      if (it.status === 'Success') {
        console.log(`✅ Migration "${it.migrationName}" was executed successfully`);
      } else if (it.status === 'Error') {
        console.error(`❌ Failed to execute migration "${it.migrationName}"`);
      }
    });
  }

  await db.destroy();

  if (error) {
    console.error('❌ Migration failed');
    console.error(error);
    process.exitCode = 1;
    return false;
  } else {
    console.log('✅ All migrations executed successfully');
    return true;
  }
}
