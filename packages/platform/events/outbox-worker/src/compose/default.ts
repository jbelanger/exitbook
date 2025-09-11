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

import { MessageBusDefault } from '@exitbook/platform-messaging';
import { Layer } from 'effect';

import { PgOutboxDatabaseLive } from '../adapters/pg-outbox-db';
import { OutboxMetricsNoOp } from '../observability';
import { OutboxProcessorLive } from '../outbox-processor';

// This is the main layer that applications should use
// It composes the outbox processor with all its production dependencies:
// - PostgreSQL database adapter
// - Messaging infrastructure (RabbitMQ)
// - Outbox processor implementation
export const OutboxWorkerDefault = Layer.provide(
  OutboxProcessorLive,
  Layer.mergeAll(PgOutboxDatabaseLive, MessageBusDefault, OutboxMetricsNoOp),
) as unknown;

// Re-export for convenience
export { OutboxProcessor, defaultOutboxConfig, makeOutboxProcessorLive } from '../outbox-processor';
export type { OutboxDatabase, OutboxConfig } from '../outbox-processor';
export { PgOutboxDatabaseLive } from '../adapters/pg-outbox-db';
export { OutboxMetricsNoOp, OutboxMetricsConsole, OutboxMetrics } from '../observability';
export { runOutboxDaemon, defaultConfig } from '../daemon';
