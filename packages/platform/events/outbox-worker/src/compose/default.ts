/**
 * Default composition layer for the Outbox Worker.
 *
 * This provides a production-ready layer that composes:
 * - OutboxProcessor with database and messaging dependencies
 * - Daemon configuration and setup
 *
 * According to ADR-0002, the outbox worker should:
 * - Poll outbox entries using FOR UPDATE SKIP LOCKED
 * - Publish via the messaging infrastructure
 * - Handle retries with exponential backoff
 * - Support horizontal scaling
 */

import { OutboxProcessorLive } from '../outbox-processor';

// This is the main layer that applications should use
// It composes the outbox processor with its dependencies
export const OutboxWorkerDefault = OutboxProcessorLive;

// Re-export for convenience
export {
  OutboxProcessor,
  MessagePublisher,
  defaultOutboxConfig,
  makeOutboxProcessorLive,
} from '../outbox-processor';
export type { OutboxDatabase, OutboxConfig } from '../outbox-processor';
export { PgOutboxDatabaseLive } from '../adapters/pg-outbox-db';
export { runOutboxDaemon, defaultConfig } from '../daemon';
