```ts
/**
 * Example: Running migrations for multiple packages together
 *
 * This demonstrates the new centralized migration system where
 * all package migrations can be run together with proper coordination.
 */

import {
  runAllMigrations,
  DbPoolLive,
  DbClientLive,
} from '@exitbook/platform-database';
import { Effect, Layer } from 'effect';

// Import migration manifests from feature packages
import { eventBusMigrations } from '@exitbook/platform-event-bus/src/migrations/manifest';
import { eventStoreMigrations } from '@exitbook/platform-event-store/src/migrations/manifest';

// Run all migrations together with proper dependency coordination
const migrationProgram = runAllMigrations([
  eventStoreMigrations, // Run event-store migrations first
  eventBusMigrations, // Then event-bus migrations
]);

const dependencies = Layer.provide(DbClientLive, DbPoolLive);

Effect.runPromise(Effect.provide(migrationProgram, dependencies))
  .then((success) => {
    console.log(
      success
        ? '✅ All migrations completed successfully'
        : '❌ Migration failed',
    );
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Migration execution failed:', error);
    process.exit(1);
  });
```
