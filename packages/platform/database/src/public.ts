/**
 * @exitbook/platform-database - Centralized Database Management
 *
 * Provides a single, instrumented database client with comprehensive telemetry,
 * typed view helpers, and coordinated migration management across packages.
 */

// Pool management
export { DbPool, DbPoolLive } from './pool';

// Centralized client with instrumentation
export { DbClient, DbClientLive } from './client';
export { DbClientWithTelemetryLive } from './compose.js';

// Transaction helper: Db.tx() for transactions
export { Db } from './tx';

// Telemetry layer with metrics, tracing, and slow query logging
export { DbTelemetryLive } from './telemetry';

// Health monitoring
export { dbHealth } from './health';

// Centralized migration system with per-package coordination
export { runAllMigrations } from './migrations/runAll';
export type { MigrationManifest } from './migrations/runAll';
