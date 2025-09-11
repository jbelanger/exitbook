// src/index.ts
/**
 * Main entry point for the EventStore package.
 *
 * Provides the default production-ready EventStore layer (`EventStoreDefault`),
 * the service tag (`EventStoreTag`), and core types/errors via the `./port` export.
 *
 * @packageDocumentation
 */

// The default, composed layer for production use (EventStore + PostgreSQL)
export { EventStoreDefault } from './compose/default';

// Re-exporting main interfaces and errors from the port for convenience
export * from './port';
