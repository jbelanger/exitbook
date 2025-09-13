import { runAllMigrations, DbPoolLive, DbClientLive } from '@exitbook/platform-database';
import { Effect, Layer } from 'effect';

import { eventBusMigrations } from './migrations/manifest';

// Run migrations using the new centralized system with proper dependencies
const migrationProgram = runAllMigrations([eventBusMigrations]);
const dependencies = Layer.provide(DbClientLive, DbPoolLive);

Effect.runPromise(Effect.provide(migrationProgram, dependencies))
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
