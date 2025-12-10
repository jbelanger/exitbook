import { describe, expect, it } from 'vitest';

import { InstrumentationCollector, sanitizeEndpoint } from '../instrumentation.js';

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
  });
});
