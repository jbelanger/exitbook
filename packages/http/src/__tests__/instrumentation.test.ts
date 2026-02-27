import { InstrumentationCollector } from '@exitbook/observability';
import { describe, expect, it } from 'vitest';

import { sanitizeEndpoint } from '../instrumentation.js';

describe('Instrumentation Utilities', () => {
  describe('sanitizeEndpoint', () => {
    it('should strip hex API keys', () => {
      const url = '/api/v1/0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d/data';
      expect(sanitizeEndpoint(url)).toBe('/api/v1/{apiKey}/data');
    });

    it('should strip base64-like API keys', () => {
      const url = '/api/v1/AbCdEfGhIjKlMnOpQrStUvWxYz123456/data';
      expect(sanitizeEndpoint(url)).toBe('/api/v1/{apiKey}/data');
    });

    it('should strip Ethereum addresses', () => {
      const url = '/api/v1/0x1234567890abcdef1234567890abcdef12345678/balance';
      expect(sanitizeEndpoint(url)).toBe('/api/v1/{address}/balance');
    });

    it('should handle full URLs by keeping only pathname', () => {
      const url = 'https://api.example.com/api/v1/users';
      expect(sanitizeEndpoint(url)).toBe('/api/v1/users');
    });

    it('should return original string if invalid URL', () => {
      const invalid = 'not-a-url';
      expect(sanitizeEndpoint(invalid)).toBe('/not-a-url');
    });

    it('should handle query parameters by ignoring them (only pathname)', () => {
      const url = '/api/v1/data?key=secret';
      expect(sanitizeEndpoint(url)).toBe('/api/v1/data');
    });
  });

  describe('InstrumentationCollector', () => {
    it('should collect and summarize metrics', () => {
      const collector = new InstrumentationCollector();

      // Add some sample metrics
      collector.record({
        provider: 'provider-a',
        service: 'blockchain',
        endpoint: '/block/1',
        method: 'GET',
        status: 200,
        durationMs: 100,
        timestamp: 1000,
      });

      collector.record({
        provider: 'provider-a',
        service: 'blockchain',
        endpoint: '/block/2',
        method: 'GET',
        status: 200,
        durationMs: 200,
        timestamp: 1001,
      });

      collector.record({
        provider: 'provider-b',
        service: 'price',
        endpoint: '/price/btc',
        method: 'GET',
        status: 200,
        durationMs: 50,
        timestamp: 1002,
      });

      const summary = collector.getSummary();

      expect(summary.total).toBe(3);
      expect(summary.avgDuration).toBeCloseTo(116.67, 2); // (100+200+50)/3

      expect(summary.byProvider).toEqual({
        'provider-a': 2,
        'provider-b': 1,
      });

      expect(summary.byService).toEqual({
        blockchain: 2,
        price: 1,
      });

      // Check endpoint aggregation
      expect(summary.byEndpoint['provider-a:/block/1']).toBeDefined();
      expect(summary.byEndpoint['provider-a:/block/2']).toBeDefined();
    });

    it('should handle empty metrics', () => {
      const collector = new InstrumentationCollector();
      const summary = collector.getSummary();

      expect(summary.total).toBe(0);
      expect(summary.avgDuration).toBe(0);
      expect(summary.byProvider).toEqual({});
    });

    it('should evict oldest metrics when ring buffer capacity is exceeded', () => {
      const capacity = 3;
      const collector = new InstrumentationCollector(capacity);

      // Fill buffer to capacity
      for (let i = 1; i <= 3; i++) {
        collector.record({
          provider: 'p',
          service: 'blockchain',
          endpoint: `/e${i}`,
          method: 'GET',
          status: 200,
          durationMs: i * 10,
          timestamp: i * 1000,
        });
      }

      expect(collector.getMetrics()).toHaveLength(3);
      expect(collector.getMetrics()[0]!.endpoint).toBe('/e1');

      // Push one more — oldest (/e1) should be evicted
      collector.record({
        provider: 'p',
        service: 'blockchain',
        endpoint: '/e4',
        method: 'GET',
        status: 200,
        durationMs: 40,
        timestamp: 4000,
      });

      const metrics = collector.getMetrics();
      expect(metrics).toHaveLength(3);
      expect(metrics[0]!.endpoint).toBe('/e2');
      expect(metrics[1]!.endpoint).toBe('/e3');
      expect(metrics[2]!.endpoint).toBe('/e4');
    });

    it('should return correct last metric after eviction', () => {
      const collector = new InstrumentationCollector(2);

      collector.record({
        provider: 'a',
        service: 'blockchain',
        endpoint: '/x',
        method: 'GET',
        status: 200,
        durationMs: 10,
        timestamp: 1000,
      });
      collector.record({
        provider: 'b',
        service: 'blockchain',
        endpoint: '/y',
        method: 'GET',
        status: 200,
        durationMs: 20,
        timestamp: 2000,
      });
      // Evicts provider 'a' metric
      collector.record({
        provider: 'b',
        service: 'blockchain',
        endpoint: '/z',
        method: 'GET',
        status: 404,
        durationMs: 30,
        timestamp: 3000,
      });

      expect(collector.getLastMetricFor('a')).toBeUndefined();
      expect(collector.getLastMetricFor('b')!.endpoint).toBe('/z');
      expect(collector.getLastMetricFor('b', 200)!.endpoint).toBe('/y');
    });

    it('should preserve summary aggregates across eviction', () => {
      const collector = new InstrumentationCollector(2);

      for (let i = 1; i <= 5; i++) {
        collector.record({
          provider: 'p',
          service: 'blockchain',
          endpoint: '/e',
          method: 'GET',
          status: 200,
          durationMs: 10,
          timestamp: i * 1000,
        });
      }

      const summary = collector.getSummary();
      // Summary counts all records ever, not just retained
      expect(summary.total).toBe(5);
      // Ring buffer only retains the last 2
      expect(collector.getMetrics()).toHaveLength(2);
    });

    it('should return immutable snapshots from getSummary', () => {
      const collector = new InstrumentationCollector();

      collector.record({
        provider: 'provider-a',
        service: 'blockchain',
        endpoint: '/block/1',
        method: 'GET',
        status: 200,
        durationMs: 100,
        timestamp: 1000,
      });

      const summary1 = collector.getSummary();
      const epKey = 'provider-a:/block/1';
      const calls1 = summary1.byEndpoint[epKey]!.calls;
      const avgDuration1 = summary1.byEndpoint[epKey]!.avgDuration;

      // Record another metric for the same endpoint
      collector.record({
        provider: 'provider-a',
        service: 'blockchain',
        endpoint: '/block/1',
        method: 'GET',
        status: 200,
        durationMs: 200,
        timestamp: 2000,
      });

      const summary2 = collector.getSummary();

      // First summary should not have changed (snapshot behavior)
      expect(summary1.byEndpoint[epKey]!.calls).toBe(calls1);
      expect(summary1.byEndpoint[epKey]!.calls).toBe(1);
      expect(summary1.byEndpoint[epKey]!.avgDuration).toBe(avgDuration1);

      // Second summary should reflect the new record
      expect(summary2.byEndpoint[epKey]!.calls).toBe(2);
      expect(summary2.byEndpoint[epKey]!.avgDuration).toBeCloseTo(150, 2);

      // Mutating returned summary should not affect collector state
      summary2.byEndpoint[epKey]!.calls = 999;
      summary2.byEndpoint[epKey]!.avgDuration = 999;

      const summary3 = collector.getSummary();
      expect(summary3.byEndpoint[epKey]!.calls).toBe(2); // Not 999
      expect(summary3.byEndpoint[epKey]!.avgDuration).toBeCloseTo(150, 2); // Not 999
    });
  });
});
