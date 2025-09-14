import { Metric, MetricBoundaries } from 'effect';

// Networking-specific metrics following OpenTelemetry semantic conventions
export const NetworkingMetrics = {
  circuitBreakerFailuresTotal: Metric.counter('circuit_breaker.failures.total', {
    description: 'Total number of circuit breaker failures',
  }),

  // Circuit Breaker metrics
  circuitBreakerState: Metric.gauge('circuit_breaker.state', {
    description: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  }),

  circuitBreakerStateChanges: Metric.counter('circuit_breaker.state_changes.total', {
    description: 'Total number of circuit breaker state changes',
  }),

  circuitBreakerSuccessesTotal: Metric.counter('circuit_breaker.successes.total', {
    description: 'Total number of circuit breaker successes',
  }),

  httpClientErrorsTotal: Metric.counter('http.client.errors.total', {
    description: 'Total number of HTTP client errors',
  }),

  // HTTP Client metrics
  httpClientRequestDuration: Metric.histogram(
    'http.client.request.duration',
    MetricBoundaries.exponential({ count: 20, factor: 2, start: 0.001 }),
    'HTTP client request duration in seconds',
  ),

  httpClientRequestsTotal: Metric.counter('http.client.requests.total', {
    description: 'Total number of HTTP client requests',
  }),

  // Rate Limiter metrics
  rateLimiterTokensAvailable: Metric.gauge('rate_limiter.tokens.available', {
    description: 'Current number of available tokens in rate limiter',
  }),

  rateLimiterWaitDuration: Metric.histogram(
    'rate_limiter.wait.duration',
    MetricBoundaries.exponential({ count: 15, factor: 2, start: 0.001 }),
    'Rate limiter wait duration in seconds',
  ),

  rateLimiterWaitsTotal: Metric.counter('rate_limiter.waits.total', {
    description: 'Total number of rate limiter waits',
  }),
};

// Helper functions for recording metrics with proper tags
export const recordHttpRequest = (
  method: string,
  url: string,
  statusCode: number,
  durationMs: number,
  providerId?: string,
) => {
  const durationSeconds = durationMs / 1000;

  // Extract host from URL for network.peer.name
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    host = 'unknown';
  }

  const baseTags = [
    ['http.request.method', method.toUpperCase()],
    ['http.response.status_code', String(statusCode)],
    ['network.peer.name', host],
  ] as const;

  let durationMetric = NetworkingMetrics.httpClientRequestDuration;
  let countMetric = NetworkingMetrics.httpClientRequestsTotal;

  for (const [key, value] of baseTags) {
    durationMetric = durationMetric.pipe(Metric.tagged(key, value));
    countMetric = countMetric.pipe(Metric.tagged(key, value));
  }

  if (providerId) {
    durationMetric = durationMetric.pipe(Metric.tagged('provider.id', providerId));
    countMetric = countMetric.pipe(Metric.tagged('provider.id', providerId));
  }

  return [Metric.update(durationMetric, durationSeconds), Metric.increment(countMetric)];
};

export const recordHttpError = (
  method: string,
  error: string,
  providerId?: string,
  url?: string,
) => {
  let host: string | undefined;
  if (url) {
    try {
      host = new URL(url).host;
    } catch {
      host = 'unknown';
    }
  }

  let errorMetric = NetworkingMetrics.httpClientErrorsTotal.pipe(
    Metric.tagged('http.request.method', method.toUpperCase()),
    Metric.tagged('error.type', error),
  );

  if (host) {
    errorMetric = errorMetric.pipe(Metric.tagged('network.peer.name', host));
  }

  if (providerId) {
    errorMetric = errorMetric.pipe(Metric.tagged('provider.id', providerId));
  }

  return Metric.increment(errorMetric);
};

export const recordRateLimiterWait = (key: string, durationMs: number) => {
  const waitsMetric = NetworkingMetrics.rateLimiterWaitsTotal.pipe(
    Metric.tagged('limiter.key', key),
  );
  const waitDurationMetric = NetworkingMetrics.rateLimiterWaitDuration.pipe(
    Metric.tagged('limiter.key', key),
  );

  return [Metric.increment(waitsMetric), Metric.update(waitDurationMetric, durationMs / 1000)];
};

export const recordCircuitBreakerStateChange = (
  key: string,
  fromState: string,
  toState: string,
) => {
  const stateChangeMetric = NetworkingMetrics.circuitBreakerStateChanges.pipe(
    Metric.tagged('breaker.key', key),
    Metric.tagged('from_state', fromState),
    Metric.tagged('to_state', toState),
  );

  return Metric.increment(stateChangeMetric);
};
