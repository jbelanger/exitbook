import { metrics } from '@opentelemetry/api';
import type { Histogram, Counter } from '@opentelemetry/api';

export const DB_METRICS = {
  QUERY_DURATION: 'db.query.duration_ms',
  QUERY_ERRORS: 'db.query.errors',
} as const;

let initialized = false;
let queryDurationHistogram: Histogram;
let queryErrorCounter: Counter;

export function installDbInstruments() {
  if (initialized) {
    return { queryDurationHistogram, queryErrorCounter };
  }

  const meter = metrics.getMeter('@exitbook/platform-database');

  queryDurationHistogram = meter.createHistogram(DB_METRICS.QUERY_DURATION, {
    description: 'Database query duration in milliseconds',
    unit: 'ms',
  });

  queryErrorCounter = meter.createCounter(DB_METRICS.QUERY_ERRORS, {
    description: 'Database query error count',
  });

  initialized = true;
  return { queryDurationHistogram, queryErrorCounter };
}
