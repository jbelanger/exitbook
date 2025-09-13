import { Layer } from 'effect';

import { DbClientLive } from './client';
import { DbTelemetryLive } from './telemetry';

// DbClientLive with telemetry included by default
export const DbClientWithTelemetryLive = Layer.provide(DbTelemetryLive, DbClientLive);
