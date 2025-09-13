/**
 * Outbox Worker Package
 *
 * Provides outbox processing capabilities for event-driven systems.
 * This package is separate from the event store to maintain clean boundaries.
 */

// Core outbox worker components
export {
  OutboxProcessorTag,
  OutboxProcessorLive,
  OutboxProcessError,
  OutboxReadError,
  type OutboxConfig,
  type OutboxStatus,
  type StatusTransitions,
  defaultOutboxConfig,
} from './processor';

export {
  OutboxDaemonTag,
  OutboxDaemonLive,
  type DaemonConfig,
  defaultDaemonConfig,
} from './daemon';

export {
  OutboxMetricsTag,
  OtelOutboxMetricsLive,
  NoOpOutboxMetricsLive,
  makeOtelOutboxMetrics,
  makeNoOpOutboxMetrics,
} from './metrics';

// Composition
export { OutboxWorkerDefault, runOutboxDaemon } from './compose/live';
