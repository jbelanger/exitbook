import type { ProviderEvent } from '@exitbook/blockchain-providers';
import type { RequestMetric } from '@exitbook/http';
import { describe, expect, it } from 'vitest';

import { ProviderStateAggregator } from '../provider-state-aggregator.js';

describe('ProviderStateAggregator', () => {
  describe('trackEvent', () => {
    it('should track rate limit events and increment throttle count', () => {
      const aggregator = new ProviderStateAggregator();
      const now = Date.now();

      const event: ProviderEvent = {
        type: 'provider.rate_limited',
        provider: 'etherscan',
        retryAfterMs: 1000,
        timestamp: now,
      };

      aggregator.trackEvent(event);

      const metrics = [createMetric('etherscan', now - 1000, 'blockchain')];
      const rows = aggregator.getProviderRows(metrics, 'blockchain');

      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('etherscan');
      expect(rows[0].throttleCount).toBe(1);
      expect(rows[0].status).toBe('rate_limited');
    });

    it('should track circuit open events', () => {
      const aggregator = new ProviderStateAggregator();
      const now = Date.now();

      const event: ProviderEvent = {
        type: 'provider.circuit_open',
        provider: 'alchemy',
        reason: 'Too many failures',
        timestamp: now,
      };

      aggregator.trackEvent(event);

      const metrics = [createMetric('alchemy', now - 1000, 'blockchain')];
      const rows = aggregator.getProviderRows(metrics, 'blockchain');

      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('circuit_open');
      expect(rows[0].statusDisplay).toBe('🔴 CIRCUIT');
    });

    it('should clear rate limit state on successful request', () => {
      const aggregator = new ProviderStateAggregator();
      const now = Date.now();

      // First, rate limit the provider
      aggregator.trackEvent({
        type: 'provider.rate_limited',
        provider: 'etherscan',
        retryAfterMs: 1000,
        timestamp: now,
      });

      // Then, successful request
      aggregator.trackEvent({
        type: 'provider.request.succeeded',
        provider: 'etherscan',
        endpoint: '/api/tx',
        method: 'GET',
        status: 200,
        durationMs: 100,
        timestamp: now + 1000,
      });

      const metrics = [createMetric('etherscan', now - 1000, 'blockchain')];
      const rows = aggregator.getProviderRows(metrics, 'blockchain');

      expect(rows[0].status).not.toBe('rate_limited');
    });

    it('should handle failover events', () => {
      const aggregator = new ProviderStateAggregator();
      const now = Date.now();

      const event: ProviderEvent = {
        type: 'provider.failover',
        from: 'etherscan',
        to: 'routescan',
        reason: 'rate_limit',
        timestamp: now,
      };

      aggregator.trackEvent(event);

      // Should track the "to" provider
      const metrics = [createMetric('routescan', now - 1000, 'blockchain')];
      const rows = aggregator.getProviderRows(metrics, 'blockchain');

      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('routescan');
    });
  });

  describe('getProviderRows', () => {
    it('should return empty array when no metrics', () => {
      const aggregator = new ProviderStateAggregator();
      const rows = aggregator.getProviderRows([], 'blockchain');

      expect(rows).toHaveLength(0);
    });

    it('should filter by service type', () => {
      const aggregator = new ProviderStateAggregator();
      const now = Date.now();

      const metrics: RequestMetric[] = [
        createMetric('etherscan', now - 1000, 'blockchain'),
        createMetric('moralis', now - 1000, 'metadata'),
        createMetric('kraken', now - 1000, 'exchange'),
      ];

      const blockchainRows = aggregator.getProviderRows(metrics, 'blockchain');
      const metadataRows = aggregator.getProviderRows(metrics, 'metadata');

      expect(blockchainRows).toHaveLength(1);
      expect(blockchainRows[0].name).toBe('etherscan');

      expect(metadataRows).toHaveLength(1);
      expect(metadataRows[0].name).toBe('moralis');
    });

    it('should sort providers by req/s (most active first)', () => {
      const aggregator = new ProviderStateAggregator();
      const now = Date.now();

      const metrics: RequestMetric[] = [
        // etherscan: 1 request (0.2 req/s)
        createMetric('etherscan', now - 1000, 'blockchain'),
        // routescan: 3 requests (0.6 req/s)
        createMetric('routescan', now - 1000, 'blockchain'),
        createMetric('routescan', now - 2000, 'blockchain'),
        createMetric('routescan', now - 3000, 'blockchain'),
      ];

      const rows = aggregator.getProviderRows(metrics, 'blockchain');

      expect(rows).toHaveLength(2);
      expect(rows[0].name).toBe('routescan'); // Higher velocity first
      expect(rows[1].name).toBe('etherscan');
    });

    it('should calculate latency from successful requests only', () => {
      const aggregator = new ProviderStateAggregator();
      const now = Date.now();

      const metrics: RequestMetric[] = [
        { ...createMetric('etherscan', now - 1000, 'blockchain'), durationMs: 100, status: 200 },
        { ...createMetric('etherscan', now - 2000, 'blockchain'), durationMs: 200, status: 200 },
        { ...createMetric('etherscan', now - 3000, 'blockchain'), durationMs: 50, status: 429 }, // Excluded
      ];

      const rows = aggregator.getProviderRows(metrics, 'blockchain');

      expect(rows[0].latencyMs).toBe(150); // Average of 100 and 200
    });

    it('should determine status as ACTIVE when req/s > 10', () => {
      const aggregator = new ProviderStateAggregator();
      const now = Date.now();

      // 60 requests in last 5 seconds = 12 req/s
      const metrics: RequestMetric[] = [];
      for (let i = 0; i < 60; i++) {
        metrics.push(createMetric('etherscan', now - 1000, 'blockchain'));
      }

      const rows = aggregator.getProviderRows(metrics, 'blockchain');

      expect(rows[0].status).toBe('active');
      expect(rows[0].statusDisplay).toBe('🟢 ACTIVE');
    });

    it('should determine status as IDLE when req/s <= 10', () => {
      const aggregator = new ProviderStateAggregator();
      const now = Date.now();

      // 2 requests in last 5 seconds = 0.4 req/s
      const metrics: RequestMetric[] = [
        createMetric('etherscan', now - 1000, 'blockchain'),
        createMetric('etherscan', now - 2000, 'blockchain'),
      ];

      const rows = aggregator.getProviderRows(metrics, 'blockchain');

      expect(rows[0].status).toBe('idle');
      expect(rows[0].statusDisplay).toBe('⚪ IDLE');
    });

    it('should show rate limit countdown timer', () => {
      const aggregator = new ProviderStateAggregator();
      const now = Date.now();

      // Rate limit the provider
      aggregator.trackEvent({
        type: 'provider.rate_limited',
        provider: 'etherscan',
        retryAfterMs: 5000,
        timestamp: now,
      });

      const metrics = [createMetric('etherscan', now - 1000, 'blockchain')];
      const rows = aggregator.getProviderRows(metrics, 'blockchain');

      expect(rows[0].status).toBe('rate_limited');
      expect(rows[0].statusDisplay).toContain('⚠ WAIT');
      expect(rows[0].statusDisplay).toContain('ms');
    });

    it('should prioritize rate limit over active status', () => {
      const aggregator = new ProviderStateAggregator();
      const now = Date.now();

      // Rate limit the provider
      aggregator.trackEvent({
        type: 'provider.rate_limited',
        provider: 'etherscan',
        retryAfterMs: 1000,
        timestamp: now,
      });

      // High velocity (should be ACTIVE, but rate limited takes priority)
      const metrics: RequestMetric[] = [];
      for (let i = 0; i < 60; i++) {
        metrics.push(createMetric('etherscan', now - 1000, 'blockchain'));
      }

      const rows = aggregator.getProviderRows(metrics, 'blockchain');

      expect(rows[0].status).toBe('rate_limited');
    });

    it('should prioritize rate limit over circuit open (per spec)', () => {
      const aggregator = new ProviderStateAggregator();
      const now = Date.now();

      // Track circuit open first
      aggregator.trackEvent({
        type: 'provider.circuit_open',
        provider: 'etherscan',
        reason: 'Too many failures',
        timestamp: now,
      });

      // Then rate limit
      aggregator.trackEvent({
        type: 'provider.rate_limited',
        provider: 'etherscan',
        retryAfterMs: 1000,
        timestamp: now + 500,
      });

      const metrics = [createMetric('etherscan', now - 1000, 'blockchain')];
      const rows = aggregator.getProviderRows(metrics, 'blockchain');

      // Rate limit has priority 1, circuit has priority 2 (per phase-1-spec.md)
      expect(rows[0].status).toBe('rate_limited');
    });

    it('should clear circuit state on successful request', () => {
      const aggregator = new ProviderStateAggregator();
      const now = Date.now();

      // Track circuit open
      aggregator.trackEvent({
        type: 'provider.circuit_open',
        provider: 'etherscan',
        reason: 'Too many failures',
        timestamp: now - 1000,
      });

      // Successful request clears circuit
      aggregator.trackEvent({
        type: 'provider.request.succeeded',
        provider: 'etherscan',
        endpoint: '/api/tx',
        method: 'GET',
        status: 200,
        durationMs: 100,
        timestamp: now,
      });

      const metrics = [createMetric('etherscan', now - 1000, 'blockchain')];
      const rows = aggregator.getProviderRows(metrics, 'blockchain');

      // Circuit should be cleared, should now be IDLE (low velocity)
      expect(rows[0].status).not.toBe('circuit_open');
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
