import type { DataSource } from '@exitbook/core';
import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { BlockchainConfig } from '../../infrastructure/blockchains/shared/blockchain-config.ts';
import type { ImportParams } from '../../types/importers.ts';
import {
  normalizeBlockchainImportParams,
  prepareImportSession,
  shouldReuseExistingImport,
} from '../import-service-utils.ts';

describe('import-service-utils', () => {
  describe('shouldReuseExistingImport', () => {
    it('should return true when existing source is provided', () => {
      const existingSource: DataSource = {
        id: 1,
        sourceId: 'bitcoin',
        sourceType: 'blockchain',
        status: 'completed',
        startedAt: new Date(),
        createdAt: new Date(),
        importParams: { address: 'bc1q...' },
        importResultMetadata: {},
      };
      const params: ImportParams = { address: 'bc1q...' };

      const result = shouldReuseExistingImport(existingSource, params);

      expect(result).toBe(true);
    });

    it('should return false when existing source is null', () => {
      const params: ImportParams = { address: 'bc1q...' };

      const result = shouldReuseExistingImport(undefined, params);

      expect(result).toBe(false);
    });
  });

  describe('normalizeBlockchainImportParams', () => {
    it('should return error when address is missing', () => {
      const sourceId = 'bitcoin';
      const params: ImportParams = {};
      const config: BlockchainConfig = {
        blockchain: 'bitcoin',
        normalizeAddress: (address) => ok(address.toLowerCase()),
        createImporter: () => {
          throw new Error('Not implemented');
        },
        createProcessor: () => {
          throw new Error('Not implemented');
        },
      };

      const result = normalizeBlockchainImportParams(sourceId, params, config);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Address required');
      }
    });

    it('should normalize address successfully', () => {
      const sourceId = 'bitcoin';
      const params: ImportParams = { address: 'BC1Q...' };
      const config: BlockchainConfig = {
        blockchain: 'bitcoin',
        normalizeAddress: (address) => ok(address.toLowerCase()),
        createImporter: () => {
          throw new Error('Not implemented');
        },
        createProcessor: () => {
          throw new Error('Not implemented');
        },
      };

      const result = normalizeBlockchainImportParams(sourceId, params, config);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.address).toBe('bc1q...');
      }
    });

    it('should return error when normalization fails', () => {
      const sourceId = 'bitcoin';
      const params: ImportParams = { address: 'invalid-address' };
      const config: BlockchainConfig = {
        blockchain: 'bitcoin',
        normalizeAddress: () => err(new Error('Invalid address format')),
        createImporter: () => {
          throw new Error('Not implemented');
        },
        createProcessor: () => {
          throw new Error('Not implemented');
        },
      };

      const result = normalizeBlockchainImportParams(sourceId, params, config);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Invalid address format');
      }
    });

    it('should preserve other params when normalizing address', () => {
      const sourceId = 'bitcoin';
      const params: ImportParams = {
        address: 'BC1Q...',
        providerId: 'blockstream',
      };
      const config: BlockchainConfig = {
        blockchain: 'bitcoin',
        normalizeAddress: (address) => ok(address.toLowerCase()),
        createImporter: () => {
          throw new Error('Not implemented');
        },
        createProcessor: () => {
          throw new Error('Not implemented');
        },
      };

      const result = normalizeBlockchainImportParams(sourceId, params, config);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.address).toBe('bc1q...');
        expect(result.value.providerId).toBe('blockstream');
      }
    });
  });

  describe('prepareImportSession', () => {
    it('should return new session config when no existing source', () => {
      const sourceId = 'bitcoin';
      const params: ImportParams = { address: 'bc1q...' };
      const existingSource = undefined;
      const latestCursor = undefined;

      const result = prepareImportSession(sourceId, params, existingSource, latestCursor);

      expect(result.shouldResume).toBe(false);
      expect(result.existingDataSourceId).toBeUndefined();
      expect(result.params).toEqual(params);
    });

    it('should return resume config when existing source provided', () => {
      const sourceId = 'kraken';
      const params: ImportParams = { csvDirectories: ['./data/kraken'] };
      const existingSource: DataSource = {
        id: 42,
        sourceId: 'kraken',
        sourceType: 'exchange',
        status: 'started',
        startedAt: new Date(),
        createdAt: new Date(),
        importParams: { csvDirectories: ['./data/kraken'] },
        importResultMetadata: {},
      };
      const latestCursor = undefined;

      const result = prepareImportSession(sourceId, params, existingSource, latestCursor);

      expect(result.shouldResume).toBe(true);
      expect(result.existingDataSourceId).toBe(42);
      expect(result.params).toEqual(params);
    });

    it('should include cursor in params when resuming', () => {
      const sourceId = 'kraken';
      const params: ImportParams = { csvDirectories: ['./data/kraken'] };
      const existingSource: DataSource = {
        id: 42,
        sourceId: 'kraken',
        sourceType: 'exchange',
        status: 'started',
        startedAt: new Date(),
        createdAt: new Date(),
        importParams: { csvDirectories: ['./data/kraken'] },
        importResultMetadata: {},
      };
      const latestCursor = { ledger: 12345, trade: 67890 };

      const result = prepareImportSession(sourceId, params, existingSource, latestCursor);

      expect(result.shouldResume).toBe(true);
      expect(result.existingDataSourceId).toBe(42);
      expect(result.params.cursor).toEqual(latestCursor);
    });

    it('should not modify original params object', () => {
      const sourceId = 'kraken';
      const params: ImportParams = { csvDirectories: ['./data/kraken'] };
      const existingSource: DataSource = {
        id: 42,
        sourceId: 'kraken',
        sourceType: 'exchange',
        status: 'started',
        startedAt: new Date(),
        createdAt: new Date(),
        importParams: { csvDirectories: ['./data/kraken'] },
        importResultMetadata: {},
      };
      const latestCursor = { ledger: 12345, trade: 67890 };

      const result = prepareImportSession(sourceId, params, existingSource, latestCursor);

      expect(result.params.cursor).toEqual(latestCursor);
      expect(params.cursor).toBeUndefined();
    });
  });
});
