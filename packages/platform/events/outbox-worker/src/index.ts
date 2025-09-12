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
  ConsoleOutboxMetricsLive,
  NoOpOutboxMetricsLive,
  makeConsoleOutboxMetrics,
  makeNoOpOutboxMetrics,
} from './metrics';

export {
  createStatusTransitions,
  type StatusTransitions,
  type OutboxStatus,
} from './status-transitions';

// Composition
export { OutboxWorkerDefault } from './compose/default';
