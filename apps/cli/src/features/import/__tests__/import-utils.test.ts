import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { ImportCommandOptionsSchema } from '../../shared/schemas.js';
import { buildImportParams, type ImportCommandOptions } from '../import-utils.js';

// Mock the getBlockchainAdapter function
vi.mock('@exitbook/ingestion', () => ({
  getBlockchainAdapter: vi.fn((_blockchain: string) => ({
    normalizeAddress: vi.fn((address: string) => ok(address)),
  })),
}));

describe('ImportCommandOptionsSchema', () => {
  describe('interactive mode (no flags)', () => {
    it('should accept empty options for interactive mode', () => {
      const result = ImportCommandOptionsSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('source selection', () => {
    it('should reject both --exchange and --blockchain', () => {
      const result = ImportCommandOptionsSchema.safeParse({
        exchange: 'kraken',
        blockchain: 'bitcoin',
        address: 'bc1q...', // Provide address to avoid additional validation errors
        csvDir: '/path/to/csv', // Provide csvDir to avoid additional validation errors
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages).toContainEqual('Cannot specify both --exchange and --blockchain');
      }
    });
  });

  describe('blockchain validation', () => {
    it('should reject blockchain without address', () => {
      const result = ImportCommandOptionsSchema.safeParse({
        blockchain: 'bitcoin',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('--address is required for blockchain sources');
      }
    });

    it('should accept blockchain with address', () => {
      const result = ImportCommandOptionsSchema.safeParse({
        blockchain: 'bitcoin',
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      });
      expect(result.success).toBe(true);
    });

    it('should accept blockchain with address and optional provider', () => {
      const result = ImportCommandOptionsSchema.safeParse({
        blockchain: 'bitcoin',
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        provider: 'blockstream',
      });
      expect(result.success).toBe(true);
    });

    it('should accept blockchain with xpubGap', () => {
      const result = ImportCommandOptionsSchema.safeParse({
        blockchain: 'bitcoin',
        address: 'xpub...',
        xpubGap: 50,
      });
      expect(result.success).toBe(true);
    });

    it('should reject xpubGap less than 1', () => {
      const result = ImportCommandOptionsSchema.safeParse({
        blockchain: 'bitcoin',
        address: 'xpub...',
        xpubGap: 0,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        // The error comes from the Zod number schema's .positive() constraint
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => m.includes('number to be >0'))).toBe(true);
      }
    });
  });

  describe('exchange validation', () => {
    it('should reject exchange without csvDir or API credentials', () => {
      const result = ImportCommandOptionsSchema.safeParse({
        exchange: 'kraken',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain(
          'Either --csv-dir or API credentials (--api-key, --api-secret) are required'
        );
      }
    });

    it('should accept exchange with csvDir', () => {
      const result = ImportCommandOptionsSchema.safeParse({
        exchange: 'kraken',
        csvDir: '/path/to/csv',
      });
      expect(result.success).toBe(true);
    });

    it('should accept exchange with API credentials', () => {
      const result = ImportCommandOptionsSchema.safeParse({
        exchange: 'kraken',
        apiKey: 'test-key',
        apiSecret: 'test-secret',
      });
      expect(result.success).toBe(true);
    });

    it('should reject exchange with both csvDir and API credentials', () => {
      const result = ImportCommandOptionsSchema.safeParse({
        exchange: 'kraken',
        csvDir: '/path/to/csv',
        apiKey: 'test-key',
        apiSecret: 'test-secret',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('Cannot specify both --csv-dir and API credentials');
      }
    });

    it('should reject apiKey without apiSecret', () => {
      const result = ImportCommandOptionsSchema.safeParse({
        exchange: 'kraken',
        apiKey: 'test-key',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        // Multiple validation errors can occur - check all messages
        const messages = result.error.issues.map((i) => i.message);
        expect(
          messages.some(
            (m) =>
              m.includes('--api-key and --api-secret must be provided together') ||
              m.includes('Either --csv-dir or API credentials')
          )
        ).toBe(true);
      }
    });

    it('should reject apiSecret without apiKey', () => {
      const result = ImportCommandOptionsSchema.safeParse({
        exchange: 'kraken',
        apiSecret: 'test-secret',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        // Multiple validation errors can occur - check all messages
        const messages = result.error.issues.map((i) => i.message);
        expect(
          messages.some(
            (m) =>
              m.includes('--api-key and --api-secret must be provided together') ||
              m.includes('Either --csv-dir or API credentials')
          )
        ).toBe(true);
      }
    });

    it('should accept exchange with API credentials and optional passphrase', () => {
      const result = ImportCommandOptionsSchema.safeParse({
        exchange: 'kucoin',
        apiKey: 'test-key',
        apiSecret: 'test-secret',
        apiPassphrase: 'test-passphrase',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('optional flags', () => {
    it('should accept --no-process flag (process: false)', () => {
      const result = ImportCommandOptionsSchema.safeParse({
        exchange: 'kraken',
        csvDir: '/path/to/csv',
        process: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.process).toBe(false);
      }
    });

    it('should allow process to be undefined when not specified', () => {
      const result = ImportCommandOptionsSchema.safeParse({
        exchange: 'kraken',
        csvDir: '/path/to/csv',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.process).toBeUndefined();
      }
    });

    it('should accept --json flag', () => {
      const result = ImportCommandOptionsSchema.safeParse({
        exchange: 'kraken',
        csvDir: '/path/to/csv',
        json: true,
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('buildImportParams', () => {
  describe('exchange sources', () => {
    it('should build params with CSV directory and default processing', () => {
      const options: ImportCommandOptions = {
        exchange: 'kraken',
        csvDir: '/path/to/csv',
      };

      const result = buildImportParams(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.sourceName).toBe('kraken');
      expect(params.sourceType).toBe('exchange-csv');
      expect(params.csvDirectory).toBe('/path/to/csv');
      expect(params.shouldProcess).toBe(true);
    });

    it('should build params with CSV directory and --no-process flag', () => {
      const options: ImportCommandOptions = {
        exchange: 'kraken',
        csvDir: '/path/to/csv',
        process: false,
      };

      const result = buildImportParams(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.sourceName).toBe('kraken');
      expect(params.sourceType).toBe('exchange-csv');
      expect(params.csvDirectory).toBe('/path/to/csv');
      expect(params.shouldProcess).toBe(false);
    });

    it('should build params with API credentials', () => {
      const options: ImportCommandOptions = {
        exchange: 'kraken',
        apiKey: 'test-key',
        apiSecret: 'test-secret',
      };

      const result = buildImportParams(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.sourceName).toBe('kraken');
      expect(params.sourceType).toBe('exchange-api');
      expect(params.credentials).toEqual({
        apiKey: 'test-key',
        apiSecret: 'test-secret',
      });
    });

    it('should build params with API credentials including passphrase', () => {
      const options: ImportCommandOptions = {
        exchange: 'kucoin',
        apiKey: 'test-key',
        apiSecret: 'test-secret',
        apiPassphrase: 'test-passphrase',
      };

      const result = buildImportParams(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.credentials).toEqual({
        apiKey: 'test-key',
        apiSecret: 'test-secret',
        apiPassphrase: 'test-passphrase',
      });
    });
  });

  describe('blockchain sources', () => {
    it('should build params with address only', () => {
      const options: ImportCommandOptions = {
        blockchain: 'bitcoin',
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      const result = buildImportParams(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.sourceName).toBe('bitcoin');
      expect(params.sourceType).toBe('blockchain');
      expect(params.address).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    });

    it('should build params with address and provider with default processing', () => {
      const options: ImportCommandOptions = {
        blockchain: 'bitcoin',
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        provider: 'blockstream',
      };

      const result = buildImportParams(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.address).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
      expect(params.providerName).toBe('blockstream');
      expect(params.shouldProcess).toBe(true);
    });
  });
});
