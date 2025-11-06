import { describe, expect, it } from 'vitest';

import {
  buildBenchmarkParams,
  buildConfigOverride,
  formatRateLimit,
  parseCustomRates,
  parseMaxRate,
  parseNumRequests,
} from '../benchmark-rate-limit-utils.js';

describe('benchmark-rate-limit-utils', () => {
  describe('parseMaxRate', () => {
    it('should parse valid positive numbers', () => {
      const result = parseMaxRate('5');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(5);
      }
    });

    it('should parse decimal numbers', () => {
      const result = parseMaxRate('2.5');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(2.5);
      }
    });

    it('should use default value of 5 when undefined', () => {
      const result = parseMaxRate();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(5);
      }
    });

    it('should reject non-numeric values', () => {
      const result = parseMaxRate('abc');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid max-rate value');
      }
    });

    it('should reject zero', () => {
      const result = parseMaxRate('0');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid max-rate value');
      }
    });

    it('should reject negative numbers', () => {
      const result = parseMaxRate('-5');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid max-rate value');
      }
    });
  });

  describe('parseNumRequests', () => {
    it('should parse valid positive integers', () => {
      const result = parseNumRequests('10');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(10);
      }
    });

    it('should use default value of 10 when undefined', () => {
      const result = parseNumRequests();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(10);
      }
    });

    it('should reject non-numeric values', () => {
      const result = parseNumRequests('abc');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid num-requests value');
      }
    });

    it('should reject zero', () => {
      const result = parseNumRequests('0');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid num-requests value');
      }
    });

    it('should reject negative numbers', () => {
      const result = parseNumRequests('-10');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid num-requests value');
      }
    });
  });

  describe('parseCustomRates', () => {
    it('should return undefined when no rates provided', () => {
      const result = parseCustomRates();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeUndefined();
      }
    });

    it('should parse single rate', () => {
      const result = parseCustomRates('2.5');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([2.5]);
      }
    });

    it('should parse multiple comma-separated rates', () => {
      const result = parseCustomRates('0.5,1,2,5');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([0.5, 1, 2, 5]);
      }
    });

    it('should handle whitespace around rates', () => {
      const result = parseCustomRates('0.5, 1 , 2,  5');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([0.5, 1, 2, 5]);
      }
    });

    it('should reject invalid rates', () => {
      const result = parseCustomRates('0.5,abc,2');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid rates');
      }
    });

    it('should reject zero in rates', () => {
      const result = parseCustomRates('0.5,0,2');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid rates');
      }
    });

    it('should reject negative rates', () => {
      const result = parseCustomRates('0.5,-1,2');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid rates');
      }
    });
  });

  describe('buildBenchmarkParams', () => {
    it('should build params with all required fields', () => {
      const result = buildBenchmarkParams({
        blockchain: 'bitcoin',
        provider: 'blockstream.info',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({
          blockchain: 'bitcoin',
          provider: 'blockstream.info',
          maxRate: 5,
          numRequests: 10,
          skipBurst: false,
          customRates: undefined,
        });
      }
    });

    it('should build params with optional fields', () => {
      const result = buildBenchmarkParams({
        blockchain: 'ethereum',
        provider: 'etherscan',
        maxRate: '10',
        numRequests: '20',
        skipBurst: true,
        rates: '1,2,5',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({
          blockchain: 'ethereum',
          provider: 'etherscan',
          maxRate: 10,
          numRequests: 20,
          skipBurst: true,
          customRates: [1, 2, 5],
        });
      }
    });

    it('should trim whitespace from blockchain and provider', () => {
      const result = buildBenchmarkParams({
        blockchain: '  bitcoin  ',
        provider: '  blockstream.info  ',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.blockchain).toBe('bitcoin');
        expect(result.value.provider).toBe('blockstream.info');
      }
    });

    it('should reject empty blockchain', () => {
      const result = buildBenchmarkParams({
        blockchain: '',
        provider: 'blockstream.info',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Blockchain is required');
      }
    });

    it('should reject whitespace-only blockchain', () => {
      const result = buildBenchmarkParams({
        blockchain: '   ',
        provider: 'blockstream.info',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Blockchain is required');
      }
    });

    it('should reject empty provider', () => {
      const result = buildBenchmarkParams({
        blockchain: 'bitcoin',
        provider: '',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Provider is required');
      }
    });

    it('should reject whitespace-only provider', () => {
      const result = buildBenchmarkParams({
        blockchain: 'bitcoin',
        provider: '   ',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Provider is required');
      }
    });

    it('should reject invalid max-rate', () => {
      const result = buildBenchmarkParams({
        blockchain: 'bitcoin',
        provider: 'blockstream.info',
        maxRate: 'invalid',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid max-rate value');
      }
    });

    it('should reject invalid num-requests', () => {
      const result = buildBenchmarkParams({
        blockchain: 'bitcoin',
        provider: 'blockstream.info',
        numRequests: 'invalid',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid num-requests value');
      }
    });

    it('should reject invalid custom rates', () => {
      const result = buildBenchmarkParams({
        blockchain: 'bitcoin',
        provider: 'blockstream.info',
        rates: '1,invalid,5',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid rates');
      }
    });
  });

  describe('formatRateLimit', () => {
    it('should format rate limit without burst', () => {
      const formatted = formatRateLimit({ requestsPerSecond: 5 });
      expect(formatted).toBe('5 req/sec');
    });

    it('should format rate limit with burst', () => {
      const formatted = formatRateLimit({ requestsPerSecond: 5, burstLimit: 10 });
      expect(formatted).toBe('5 req/sec, burst: 10');
    });

    it('should format decimal rates', () => {
      const formatted = formatRateLimit({ requestsPerSecond: 2.5 });
      expect(formatted).toBe('2.5 req/sec');
    });
  });

  describe('buildConfigOverride', () => {
    it('should build config override without burst limit', () => {
      const override = buildConfigOverride('bitcoin', 'blockstream.info', {
        requestsPerSecond: 4,
      });

      expect(override).toEqual({
        bitcoin: {
          overrides: {
            'blockstream.info': {
              rateLimit: {
                requestsPerSecond: 4,
              },
            },
          },
        },
      });
    });

    it('should build config override with burst limit', () => {
      const override = buildConfigOverride('ethereum', 'etherscan', {
        requestsPerSecond: 4,
        burstLimit: 8,
      });

      expect(override).toEqual({
        ethereum: {
          overrides: {
            etherscan: {
              rateLimit: {
                requestsPerSecond: 4,
                burstLimit: 8,
              },
            },
          },
        },
      });
    });
  });
});
