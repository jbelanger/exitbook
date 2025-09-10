/**
 * Outbox Worker Package
 *
 * This package implements the outbox pattern worker daemon as specified in ADR-0002.
 *
 * Key responsibilities:
 * - Poll outbox entries from the event store
 * - Publish messages via the messaging infrastructure
 * - Handle retries with exponential backoff
 * - Support horizontal scaling with FOR UPDATE SKIP LOCKED
 * - Provide at-least-once delivery guarantees
 */

// Core outbox processing
export * from './outbox-processor';

// Daemon runner for deployable processes
export * from './daemon';

// Shared model types
export * from './model';
