import { EventStoreWithOutboxDefault } from '@exitbook/platform-event-store/compose/live';
import { MessageBusDefault } from '@exitbook/platform-messaging';
import { MonitoringDefault, InfrastructureHealthChecks } from '@exitbook/platform-monitoring';
import { Layer, Effect } from 'effect';

import {
  OutboxDaemonLive,
  OutboxDaemonTag,
  type DaemonConfig,
  defaultDaemonConfig,
} from '../daemon';
import { OtelOutboxMetricsLive } from '../metrics';
import { OutboxProcessorLive, defaultOutboxConfig } from '../processor';

// 1) Base monitoring and infra
const MonitoringStack = Layer.provide(
  InfrastructureHealthChecks, // depends on HealthMonitor from MonitoringDefault
  MonitoringDefault, // provides Telemetry and HealthMonitor
);

// 2) Base deps that the processor needs (DB, producer, metrics, monitoring)
const BaseDeps = Layer.mergeAll(
  EventStoreWithOutboxDefault, // provides OutboxDatabase
  MessageBusDefault, // provides MessageBusProducer
  OtelOutboxMetricsLive, // provides OutboxMetrics
  MonitoringStack, // provides Telemetry, HealthMonitor, and registers health checks
);

// 2) Provide deps to the processor so it can be constructed
const ProcessorProvided = Layer.provide(OutboxProcessorLive(defaultOutboxConfig), BaseDeps);

// 3) Provide the processor to the daemon
export const OutboxWorkerDefault = Layer.provide(
  OutboxDaemonLive(defaultDaemonConfig),
  ProcessorProvided,
);

/**
 * One-liner runner (keeps same API)
 */
export const runOutboxDaemon = (config?: Partial<DaemonConfig>) => {
  const program = Effect.gen(function* () {
    const daemon = yield* OutboxDaemonTag;
    yield* daemon.start();
    yield* Effect.never;
  });

  // If config is provided, create a custom layer with the config
  if (config) {
    const fullConfig = { ...defaultDaemonConfig, ...config };

    // Create custom layer with provided config
    const customWorkerLayer = Layer.provide(
      OutboxDaemonLive(fullConfig),
      Layer.provide(OutboxProcessorLive(fullConfig), BaseDeps),
    );

    return Effect.provide(program, customWorkerLayer);
  }

  // Otherwise use the default layer
  return Effect.provide(program, OutboxWorkerDefault);
};
