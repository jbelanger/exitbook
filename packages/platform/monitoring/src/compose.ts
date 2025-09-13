import { Layer } from 'effect';

import { HealthMonitorLive } from './health-monitor';
import { StructuredLoggerLive } from './logger';
import { TelemetryLive } from './telemetry';

// Complete monitoring stack with structured logging
export const MonitoringDefault = Layer.mergeAll(
  TelemetryLive,
  HealthMonitorLive,
  StructuredLoggerLive,
);

// Re-export for convenience
export { TelemetryLive, HealthMonitorLive, StructuredLoggerLive };
