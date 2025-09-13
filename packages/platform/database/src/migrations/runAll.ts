import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { Effect } from 'effect';
import { Migrator, FileMigrationProvider } from 'kysely';

import { DbClient } from '../client';

import { ensureMigrationLogTable, recordMigration } from './log';

export type MigrationManifest = Readonly<{
  folder: string;
  package: string;
}>;

export const runAllMigrations = (manifests: readonly MigrationManifest[]) =>
  Effect.gen(function* () {
    console.log(`🔄 Running migrations for ${manifests.length} packages...`);

    // Ensure migration log table exists
    yield* ensureMigrationLogTable;

    let allSuccessful = true;

    for (const manifest of manifests) {
      console.log(`📦 Processing migrations for package: ${manifest.package}`);

      const success = yield* runPackageMigrations(manifest);
      if (!success) {
        allSuccessful = false;
        break;
      }
    }

    if (allSuccessful) {
      console.log('✅ All package migrations completed successfully');
    } else {
      console.error('❌ Migration process failed');
    }

    return allSuccessful;
  });

const runPackageMigrations = (manifest: MigrationManifest) =>
  Effect.gen(function* () {
    const db = yield* DbClient;

    try {
      // Use the standard Kysely migrator to apply all migrations
      const migrator = new Migrator({
        db: db,
        provider: new FileMigrationProvider({
          fs,
          migrationFolder: manifest.folder,
          path,
        }),
      });

      const { error, results } = yield* Effect.tryPromise(() => migrator.migrateToLatest());

      if (results) {
        for (const result of results) {
          if (result.status === 'Success') {
            console.log(`    ✅ Applied migration: ${result.migrationName}`);

            // Calculate checksum for the migration
            try {
              const migrationContent = yield* Effect.tryPromise(() =>
                fs.readFile(path.join(manifest.folder, `${result.migrationName}.ts`), 'utf-8'),
              );
              const checksum = crypto.createHash('sha256').update(migrationContent).digest('hex');

              // Record the migration in the log
              yield* recordMigration(manifest.package, result.migrationName, checksum);
            } catch (logError) {
              console.warn(`    ⚠️  Failed to log migration ${result.migrationName}:`, logError);
            }
          } else if (result.status === 'Error') {
            console.error(`    ❌ Failed to apply migration: ${result.migrationName}`);
            return false;
          }
        }
      }

      if (error) {
        console.error(`❌ Migration failed for package ${manifest.package}:`, error);
        return false;
      }

      console.log(`  ✅ All migrations applied for ${manifest.package}`);
      return true;
    } catch (error) {
      console.error(`❌ Migration failed for package ${manifest.package}:`, error);
      return false;
    }
  });
