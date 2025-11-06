import { describe, expect, it } from 'vitest';

import type { ImportHandlerParams } from '../import-handler.js';
import { buildImportParamsFromFlags, validateImportParams, type ImportCommandOptions } from '../import-utils.js';

describe('validateImportParams', () => {
  describe('exchange sources', () => {
    it('should succeed when CSV directory is provided', () => {
      const params: ImportHandlerParams = {
        sourceName: 'kraken',
        sourceType: 'exchange',
        csvDir: '/path/to/csv',
      };

      const result = validateImportParams(params);

      expect(result.isOk()).toBe(true);
    });

    it('should succeed when API credentials are provided', () => {
      const params: ImportHandlerParams = {
        sourceName: 'kraken',
        sourceType: 'exchange',
        credentials: {
          apiKey: 'test-key',
          secret: 'test-secret',
        },
      };

      const result = validateImportParams(params);

      expect(result.isOk()).toBe(true);
    });

    it('should fail when neither CSV directory nor credentials are provided', () => {
      const params: ImportHandlerParams = {
        sourceName: 'kraken',
        sourceType: 'exchange',
      };

      const result = validateImportParams(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Either CSV directory or API credentials are required');
    });

    it('should fail when both CSV directory and credentials are provided', () => {
      const params: ImportHandlerParams = {
        sourceName: 'kraken',
        sourceType: 'exchange',
        csvDir: '/path/to/csv',
        credentials: {
          apiKey: 'test-key',
          secret: 'test-secret',
        },
      };

      const result = validateImportParams(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Cannot specify both CSV directory and API credentials');
    });
  });

  describe('blockchain sources', () => {
    it('should succeed when address is provided', () => {
      const params: ImportHandlerParams = {
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      const result = validateImportParams(params);

      expect(result.isOk()).toBe(true);
    });

    it('should succeed when address and provider are provided', () => {
      const params: ImportHandlerParams = {
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        providerName: 'blockstream',
      };

      const result = validateImportParams(params);

      expect(result.isOk()).toBe(true);
    });

    it('should fail when address is not provided', () => {
      const params: ImportHandlerParams = {
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
      };

      const result = validateImportParams(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Wallet address is required');
    });
  });
});

describe('buildImportParamsFromFlags', () => {
  describe('source selection', () => {
    it('should fail when neither exchange nor blockchain is specified', () => {
      const options: ImportCommandOptions = {};

      const result = buildImportParamsFromFlags(options);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Either --exchange or --blockchain is required');
    });

    it('should fail when both exchange and blockchain are specified', () => {
      const options: ImportCommandOptions = {
        exchange: 'kraken',
        blockchain: 'bitcoin',
      };

      const result = buildImportParamsFromFlags(options);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Cannot specify both --exchange and --blockchain');
    });
  });

  describe('exchange sources', () => {
    it('should build params with CSV directory', () => {
      const options: ImportCommandOptions = {
        exchange: 'kraken',
        csvDir: '/path/to/csv',
        process: true,
      };

      const result = buildImportParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.sourceName).toBe('kraken');
      expect(params.sourceType).toBe('exchange');
      expect(params.csvDir).toBe('/path/to/csv');
      expect(params.shouldProcess).toBe(true);
    });

    it('should build params with API credentials', () => {
      const options: ImportCommandOptions = {
        exchange: 'kraken',
        apiKey: 'test-key',
        apiSecret: 'test-secret',
      };

      const result = buildImportParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.sourceName).toBe('kraken');
      expect(params.sourceType).toBe('exchange');
      expect(params.credentials).toEqual({
        apiKey: 'test-key',
        secret: 'test-secret',
        apiPassphrase: undefined,
      });
    });

    it('should build params with API credentials including passphrase', () => {
      const options: ImportCommandOptions = {
        exchange: 'kucoin',
        apiKey: 'test-key',
        apiSecret: 'test-secret',
        apiPassphrase: 'test-passphrase',
      };

      const result = buildImportParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.credentials).toEqual({
        apiKey: 'test-key',
        secret: 'test-secret',
        apiPassphrase: 'test-passphrase',
      });
    });

    it('should fail when neither CSV directory nor API credentials are provided', () => {
      const options: ImportCommandOptions = {
        exchange: 'kraken',
      };

      const result = buildImportParamsFromFlags(options);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Either --csv-dir or API credentials');
    });

    it('should fail when both CSV directory and API credentials are provided', () => {
      const options: ImportCommandOptions = {
        exchange: 'kraken',
        csvDir: '/path/to/csv',
        apiKey: 'test-key',
      };

      const result = buildImportParamsFromFlags(options);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Cannot specify both --csv-dir and API credentials');
    });

    it('should fail when API key is provided without secret', () => {
      const options: ImportCommandOptions = {
        exchange: 'kraken',
        apiKey: 'test-key',
      };

      const result = buildImportParamsFromFlags(options);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('--api-secret is required when using --api-key');
    });
  });

  describe('blockchain sources', () => {
    it('should build params with address only', () => {
      const options: ImportCommandOptions = {
        blockchain: 'bitcoin',
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      const result = buildImportParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.sourceName).toBe('bitcoin');
      expect(params.sourceType).toBe('blockchain');
      expect(params.address).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    });

    it('should build params with address and provider', () => {
      const options: ImportCommandOptions = {
        blockchain: 'bitcoin',
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        provider: 'blockstream',
        process: true,
      };

      const result = buildImportParamsFromFlags(options);

      expect(result.isOk()).toBe(true);
      const params = result._unsafeUnwrap();
      expect(params.address).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
      expect(params.providerName).toBe('blockstream');
      expect(params.shouldProcess).toBe(true);
    });

    it('should fail when address is not provided', () => {
      const options: ImportCommandOptions = {
        blockchain: 'bitcoin',
      };

      const result = buildImportParamsFromFlags(options);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('--address is required for blockchain sources');
    });
  });
});
