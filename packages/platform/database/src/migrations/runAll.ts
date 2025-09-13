import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { Effect } from 'effect';
import { Migrator, FileMigrationProvider } from 'kysely';

import { DbClient } from '../client';

import { ensureMigrationLogTable, recordMigration, getAppliedMigrations } from './log';

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
      // Verify migration drift first
      yield* verifyMigrationDrift(manifest);

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

            // Calculate checksum for the migration (try .ts first, fallback to .js)
            try {
              let migrationContent: string;
              const tsPath = path.join(manifest.folder, `${result.migrationName}.ts`);
              const jsPath = path.join(manifest.folder, `${result.migrationName}.js`);

              try {
                migrationContent = yield* Effect.tryPromise(() => fs.readFile(tsPath, 'utf-8'));
              } catch (tsError) {
                if ((tsError as NodeJS.ErrnoException).code === 'ENOENT') {
                  migrationContent = yield* Effect.tryPromise(() => fs.readFile(jsPath, 'utf-8'));
                } else {
                  throw tsError;
                }
              }

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

const verifyMigrationDrift = (manifest: MigrationManifest) =>
  Effect.gen(function* () {
    console.log(`  🔍 Verifying migration drift for ${manifest.package}...`);

    // Get applied migrations from database
    const appliedMigrations = yield* getAppliedMigrations(manifest.package);

    // Verify each applied migration still matches
    for (const applied of appliedMigrations) {
      // Try .ts first, fallback to .js for production environments
      const tsFilePath = path.join(manifest.folder, `${applied.version}.ts`);
      const jsFilePath = path.join(manifest.folder, `${applied.version}.js`);

      let content: string;
      let filePath: string;

      try {
        content = yield* Effect.tryPromise(() => fs.readFile(tsFilePath, 'utf-8'));
        filePath = tsFilePath;
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
          try {
            content = yield* Effect.tryPromise(() => fs.readFile(jsFilePath, 'utf-8'));
            filePath = jsFilePath;
          } catch (_jsError) {
            const error = new Error(
              `Migration drift detected in ${manifest.package}: ${applied.version}\n` +
                `Migration file is missing: tried both ${tsFilePath} and ${jsFilePath}\n` +
                `This migration was previously applied but neither TypeScript nor JavaScript file exists.`,
            );
            throw error;
          }
        } else {
          throw readError;
        }
      }

      const currentChecksum = crypto.createHash('sha256').update(content).digest('hex');

      if (currentChecksum !== applied.checksum) {
        const error = new Error(
          `Migration drift detected in ${manifest.package}: ${applied.version}\n` +
            `Expected checksum: ${applied.checksum}\n` +
            `Current checksum:  ${currentChecksum}\n` +
            `Migration file has been modified after being applied: ${filePath}`,
        );
        throw error;
      }
    }

    console.log(`    ✅ Migration drift verification passed for ${manifest.package}`);
  });
