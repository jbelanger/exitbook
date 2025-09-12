import { Layer } from 'effect';

import { TelemetryLive, HealthMonitorLive } from './index';

// Complete monitoring stack
export const MonitoringDefault = Layer.mergeAll(TelemetryLive, HealthMonitorLive);

// Re-export for convenience
export { TelemetryLive, HealthMonitorLive };
