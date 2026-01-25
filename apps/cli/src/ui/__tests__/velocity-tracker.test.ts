import type { RequestMetric } from '@exitbook/http';
import { describe, expect, it } from 'vitest';

import { VelocityTracker } from '../velocity-tracker.js';

describe('VelocityTracker', () => {
  const tracker = new VelocityTracker();

  describe('getRequestsPerSecond', () => {
    it('should return 0 for empty metrics', () => {
      const result = tracker.getRequestsPerSecond([]);
      expect(result).toBe(0);
    });

    it('should calculate req/s from metrics within 5s window', () => {
      const now = Date.now();
      const metrics: RequestMetric[] = [
        createMetric('provider1', now - 1000), // 1s ago
        createMetric('provider1', now - 2000), // 2s ago
        createMetric('provider2', now - 3000), // 3s ago
        createMetric('provider2', now - 4000), // 4s ago
        createMetric('provider1', now - 4500), // 4.5s ago
      ];

      // 5 requests in 5s window = 1 req/s
      const result = tracker.getRequestsPerSecond(metrics);
      expect(result).toBe(1);
    });

    it('should exclude metrics older than 5s', () => {
      const now = Date.now();
      const metrics: RequestMetric[] = [
        createMetric('provider1', now - 1000), // 1s ago (included)
        createMetric('provider1', now - 2000), // 2s ago (included)
        createMetric('provider1', now - 6000), // 6s ago (excluded)
        createMetric('provider1', now - 10000), // 10s ago (excluded)
      ];

      // 2 requests in 5s window = 0.4 req/s
      const result = tracker.getRequestsPerSecond(metrics);
      expect(result).toBe(0.4);
    });

    it('should handle high velocity scenarios', () => {
      const now = Date.now();
      const metrics: RequestMetric[] = [];

      // 500 requests in last second
      for (let i = 0; i < 500; i++) {
        metrics.push(createMetric('provider1', now - 500));
      }

      // 500 requests / 5s = 100 req/s
      const result = tracker.getRequestsPerSecond(metrics);
      expect(result).toBe(100);
    });
  });

  describe('getProviderVelocity', () => {
    it('should return 0 for provider with no requests', () => {
      const now = Date.now();
      const metrics: RequestMetric[] = [createMetric('provider1', now - 1000), createMetric('provider2', now - 2000)];

      const result = tracker.getProviderVelocity(metrics, 'provider3');
      expect(result).toBe(0);
    });

    it('should calculate req/s for specific provider', () => {
      const now = Date.now();
      const metrics: RequestMetric[] = [
        createMetric('provider1', now - 1000),
        createMetric('provider1', now - 2000),
        createMetric('provider2', now - 1500),
        createMetric('provider1', now - 3000),
      ];

      // provider1: 3 requests / 5s = 0.6 req/s
      const result = tracker.getProviderVelocity(metrics, 'provider1');
      expect(result).toBe(0.6);
    });

    it('should filter by provider and exclude old metrics', () => {
      const now = Date.now();
      const metrics: RequestMetric[] = [
        createMetric('provider1', now - 1000), // included
        createMetric('provider1', now - 6000), // excluded (too old)
        createMetric('provider2', now - 1000), // excluded (wrong provider)
        createMetric('provider1', now - 2000), // included
      ];

      // provider1: 2 requests / 5s = 0.4 req/s
      const result = tracker.getProviderVelocity(metrics, 'provider1');
      expect(result).toBe(0.4);
    });
  });

  describe('getProviderVelocityByService', () => {
    it('should filter by both provider and service type', () => {
      const now = Date.now();
      const metrics: RequestMetric[] = [
        createMetric('provider1', now - 1000, 'blockchain'),
        createMetric('provider1', now - 1500, 'metadata'),
        createMetric('provider2', now - 2000, 'blockchain'),
        createMetric('provider1', now - 2500, 'blockchain'),
      ];

      // provider1 blockchain: 2 requests / 5s = 0.4 req/s
      const result = tracker.getProviderVelocityByService(metrics, 'provider1', 'blockchain');
      expect(result).toBe(0.4);
    });

    it('should return 0 when no matching service type', () => {
      const now = Date.now();
      const metrics: RequestMetric[] = [
        createMetric('provider1', now - 1000, 'blockchain'),
        createMetric('provider1', now - 2000, 'blockchain'),
      ];

      // provider1 metadata: 0 requests / 5s = 0 req/s
      const result = tracker.getProviderVelocityByService(metrics, 'provider1', 'metadata');
      expect(result).toBe(0);
    });

    it('should exclude old metrics and wrong service types', () => {
      const now = Date.now();
      const metrics: RequestMetric[] = [
        createMetric('provider1', now - 1000, 'metadata'), // included
        createMetric('provider1', now - 2000, 'blockchain'), // excluded (wrong service)
        createMetric('provider1', now - 6000, 'metadata'), // excluded (too old)
        createMetric('provider2', now - 1000, 'metadata'), // excluded (wrong provider)
      ];

      // provider1 metadata: 1 request / 5s = 0.2 req/s
      const result = tracker.getProviderVelocityByService(metrics, 'provider1', 'metadata');
      expect(result).toBe(0.2);
    });
  });
});

/**
 * Helper to create a mock RequestMetric
 */
function createMetric(
  provider: string,
  timestamp: number,
  service: 'blockchain' | 'exchange' | 'price' | 'metadata' = 'blockchain'
): RequestMetric {
  return {
    provider,
    service,
    endpoint: '/test',
    method: 'GET',
    status: 200,
    durationMs: 100,
    timestamp,
  };
}
