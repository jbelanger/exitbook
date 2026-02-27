import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstrumentationCollector, type RequestMetric } from '../instrumentation.js';

function createMetric(overrides: Partial<RequestMetric> = {}): RequestMetric {
  return {
    provider: 'provider-a',
    service: 'blockchain',
    endpoint: '/blocks/1',
    method: 'GET',
    status: 200,
    durationMs: 100,
    timestamp: 1_000,
    ...overrides,
  };
}

describe('InstrumentationCollector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty summary when no metrics were recorded', () => {
    const collector = new InstrumentationCollector();

    expect(collector.getSummary()).toEqual({
      total: 0,
      avgDuration: 0,
      byProvider: {},
      byService: {},
      byEndpoint: {},
    });
    expect(collector.getMetrics()).toEqual([]);
  });

  it('aggregates provider, service, endpoint, and average duration values', () => {
    const collector = new InstrumentationCollector();

    collector.record(createMetric({ endpoint: '/blocks/1', durationMs: 100 }));
    collector.record(createMetric({ endpoint: '/blocks/1', durationMs: 200 }));
    collector.record(
      createMetric({
        provider: 'provider-b',
        service: 'price',
        endpoint: '/prices/btc',
        durationMs: 50,
      })
    );

    const summary = collector.getSummary();

    expect(summary.total).toBe(3);
    expect(summary.avgDuration).toBeCloseTo(116.67, 2);
    expect(summary.byProvider).toEqual({
      'provider-a': 2,
      'provider-b': 1,
    });
    expect(summary.byService).toEqual({
      blockchain: 2,
      price: 1,
    });
    expect(summary.byEndpoint['provider-a:/blocks/1']).toEqual({
      calls: 2,
      avgDuration: 150,
    });
    expect(summary.byEndpoint['provider-b:/prices/btc']).toEqual({
      calls: 1,
      avgDuration: 50,
    });
  });

  it('retains only the newest raw metrics when capacity is exceeded', () => {
    const collector = new InstrumentationCollector(3);

    collector.record(createMetric({ endpoint: '/e1', timestamp: 1_000 }));
    collector.record(createMetric({ endpoint: '/e2', timestamp: 2_000 }));
    collector.record(createMetric({ endpoint: '/e3', timestamp: 3_000 }));
    collector.record(createMetric({ endpoint: '/e4', timestamp: 4_000 }));

    expect(collector.getMetrics().map((metric) => metric.endpoint)).toEqual(['/e2', '/e3', '/e4']);
    expect(collector.getSummary().total).toBe(4);
  });

  it('returns the last metric by provider with optional status filtering', () => {
    const collector = new InstrumentationCollector();

    collector.record(createMetric({ provider: 'provider-a', endpoint: '/ok', status: 200 }));
    collector.record(createMetric({ provider: 'provider-a', endpoint: '/error', status: 500 }));
    collector.record(createMetric({ provider: 'provider-b', endpoint: '/other', status: 200 }));

    expect(collector.getLastMetricFor('provider-a')?.endpoint).toBe('/error');
    expect(collector.getLastMetricFor('provider-a', 200)?.endpoint).toBe('/ok');
    expect(collector.getLastMetricFor('provider-a', 404)).toBeUndefined();
  });

  it('counts only recent successful metrics for a provider', () => {
    vi.setSystemTime(new Date(10_000));
    const collector = new InstrumentationCollector();

    collector.record(createMetric({ provider: 'provider-a', timestamp: 4_000, status: 200 }));
    collector.record(createMetric({ provider: 'provider-a', timestamp: 7_000, status: 500 }));
    collector.record(createMetric({ provider: 'provider-b', timestamp: 8_000, status: 200 }));
    collector.record(createMetric({ provider: 'provider-a', timestamp: 9_000, status: 204 }));

    expect(collector.countRecentSuccessful('provider-a', 5_000)).toBe(1);
    expect(collector.countRecentSuccessful('provider-b', 5_000)).toBe(1);
    expect(collector.countRecentSuccessful('provider-a', 1_000)).toBe(1);
  });

  it('returns immutable summary snapshots', () => {
    const collector = new InstrumentationCollector();
    const endpoint = '/blocks/1';
    const endpointKey = `provider-a:${endpoint}`;

    collector.record(createMetric({ endpoint, durationMs: 100 }));

    const firstSummary = collector.getSummary();
    collector.record(createMetric({ endpoint, durationMs: 200 }));

    expect(firstSummary.byEndpoint[endpointKey]).toEqual({
      calls: 1,
      avgDuration: 100,
    });

    const secondSummary = collector.getSummary();
    secondSummary.byProvider['provider-a'] = 99;
    secondSummary.byEndpoint[endpointKey]!.calls = 99;
    secondSummary.byEndpoint[endpointKey]!.avgDuration = 99;

    const thirdSummary = collector.getSummary();
    expect(thirdSummary.byProvider['provider-a']).toBe(2);
    expect(thirdSummary.byEndpoint[endpointKey]).toEqual({
      calls: 2,
      avgDuration: 150,
    });
  });
});
