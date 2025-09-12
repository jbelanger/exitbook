import { Layer } from 'effect';

import { TelemetryLive, HealthMonitorLive, StructuredLoggerLive } from './index';

// Complete monitoring stack with structured logging
export const MonitoringDefault = Layer.mergeAll(
  TelemetryLive,
  HealthMonitorLive,
  StructuredLoggerLive,
);

// Re-export for convenience
export { TelemetryLive, HealthMonitorLive, StructuredLoggerLive };
