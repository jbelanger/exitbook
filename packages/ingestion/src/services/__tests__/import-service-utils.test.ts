import type { CursorState, DataSource } from '@exitbook/core';
import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { BlockchainAdapter } from '../../infrastructure/blockchains/shared/blockchain-adapter.ts';
import type { ImportParams } from '../../types/importers.js';
import {
  normalizeBlockchainImportParams,
  prepareImportSession,
  shouldReuseExistingImport,
} from '../import-service-utils.js';

describe('import-service-utils', () => {
  describe('shouldReuseExistingImport', () => {
    it('should return true when existing source is provided', () => {
      const existingSource: DataSource = {
        id: 1,
        accountId: 1,
        status: 'completed',
        startedAt: new Date(),
        transactionsImported: 0,
        transactionsFailed: 0,
        createdAt: new Date(),
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
      const adapter: BlockchainAdapter = {
        blockchain: 'bitcoin',
        normalizeAddress: (address) => ok(address.toLowerCase()),
        createImporter: () => {
          throw new Error('Not implemented');
        },
        createProcessor: () => {
          throw new Error('Not implemented');
        },
      };

      const result = normalizeBlockchainImportParams(sourceId, params, adapter);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Address required');
      }
    });

    it('should normalize address successfully', () => {
      const sourceId = 'bitcoin';
      const params: ImportParams = { address: 'BC1Q...' };
      const adapter: BlockchainAdapter = {
        blockchain: 'bitcoin',
        normalizeAddress: (address) => ok(address.toLowerCase()),
        createImporter: () => {
          throw new Error('Not implemented');
        },
        createProcessor: () => {
          throw new Error('Not implemented');
        },
      };

      const result = normalizeBlockchainImportParams(sourceId, params, adapter);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.address).toBe('bc1q...');
      }
    });

    it('should return error when normalization fails', () => {
      const sourceId = 'bitcoin';
      const params: ImportParams = { address: 'invalid-address' };
      const adapter: BlockchainAdapter = {
        blockchain: 'bitcoin',
        normalizeAddress: () => err(new Error('Invalid address format')),
        createImporter: () => {
          throw new Error('Not implemented');
        },
        createProcessor: () => {
          throw new Error('Not implemented');
        },
      };

      const result = normalizeBlockchainImportParams(sourceId, params, adapter);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Invalid address format');
      }
    });

    it('should preserve other params when normalizing address', () => {
      const sourceId = 'bitcoin';
      const params: ImportParams = {
        address: 'BC1Q...',
        providerName: 'blockstream',
      };
      const adapter: BlockchainAdapter = {
        blockchain: 'bitcoin',
        normalizeAddress: (address) => ok(address.toLowerCase()),
        createImporter: () => {
          throw new Error('Not implemented');
        },
        createProcessor: () => {
          throw new Error('Not implemented');
        },
      };

      const result = normalizeBlockchainImportParams(sourceId, params, adapter);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.address).toBe('bc1q...');
        expect(result.value.providerName).toBe('blockstream');
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

    it('should return resume config when existing source has started status', () => {
      const sourceId = 'kraken';
      const params: ImportParams = { csvDirectories: ['./data/kraken'] };
      const existingSource: DataSource = {
        id: 42,
        accountId: 1,
        status: 'started',
        startedAt: new Date(),
        transactionsImported: 0,
        transactionsFailed: 0,
        createdAt: new Date(),
        importResultMetadata: {},
      };
      const latestCursor = undefined;

      const result = prepareImportSession(sourceId, params, existingSource, latestCursor);

      expect(result.shouldResume).toBe(true);
      expect(result.existingDataSourceId).toBe(42);
      expect(result.params).toEqual(params);
    });

    it('should return resume config when existing source has failed status', () => {
      const sourceId = 'kraken';
      const params: ImportParams = { csvDirectories: ['./data/kraken'] };
      const existingSource: DataSource = {
        id: 42,
        accountId: 1,
        status: 'failed',
        startedAt: new Date(),
        createdAt: new Date(),
        transactionsImported: 0,
        transactionsFailed: 0,
        importResultMetadata: {},
      };
      const latestCursor = undefined;

      const result = prepareImportSession(sourceId, params, existingSource, latestCursor);

      expect(result.shouldResume).toBe(true);
      expect(result.existingDataSourceId).toBe(42);
      expect(result.params).toEqual(params);
    });

    it('should NOT resume when existing source has completed status', () => {
      const sourceId = 'kraken';
      const params: ImportParams = { csvDirectories: ['./data/kraken'] };
      const existingSource: DataSource = {
        id: 42,
        accountId: 1,
        status: 'completed',
        startedAt: new Date(),
        createdAt: new Date(),
        transactionsImported: 10,
        transactionsFailed: 0,
        importResultMetadata: {},
      };
      const latestCursor = undefined;

      const result = prepareImportSession(sourceId, params, existingSource, latestCursor);

      expect(result.shouldResume).toBe(false);
      expect(result.existingDataSourceId).toBeUndefined();
      expect(result.params).toEqual(params);
    });

    it('should NOT resume when existing source has cancelled status', () => {
      const sourceId = 'kraken';
      const params: ImportParams = { csvDirectories: ['./data/kraken'] };
      const existingSource: DataSource = {
        id: 42,
        accountId: 1,
        status: 'cancelled',
        startedAt: new Date(),
        createdAt: new Date(),
        transactionsImported: 0,
        transactionsFailed: 0,
        importResultMetadata: {},
      };
      const latestCursor = undefined;

      const result = prepareImportSession(sourceId, params, existingSource, latestCursor);

      expect(result.shouldResume).toBe(false);
      expect(result.existingDataSourceId).toBeUndefined();
      expect(result.params).toEqual(params);
    });

    it('should include cursor in params when resuming', () => {
      const sourceId = 'kraken';
      const params: ImportParams = { csvDirectories: ['./data/kraken'] };
      const existingSource: DataSource = {
        id: 42,
        accountId: 1,
        status: 'started',
        startedAt: new Date(),
        transactionsImported: 0,
        transactionsFailed: 0,
        createdAt: new Date(),
        importResultMetadata: {},
      };
      const latestCursor: Record<string, CursorState> = {
        ledger: {
          primary: { type: 'timestamp', value: 12345 },
          lastTransactionId: 'ledger-123',
          totalFetched: 100,
        },
        trade: {
          primary: { type: 'timestamp', value: 67890 },
          lastTransactionId: 'trade-456',
          totalFetched: 200,
        },
      };

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
        accountId: 1,
        status: 'started',
        startedAt: new Date(),
        transactionsImported: 0,
        transactionsFailed: 0,
        createdAt: new Date(),
        importResultMetadata: {},
      };
      const latestCursor: Record<string, CursorState> = {
        ledger: {
          primary: { type: 'timestamp', value: 12345 },
          lastTransactionId: 'ledger-123',
          totalFetched: 100,
        },
        trade: {
          primary: { type: 'timestamp', value: 67890 },
          lastTransactionId: 'trade-456',
          totalFetched: 200,
        },
      };

      const result = prepareImportSession(sourceId, params, existingSource, latestCursor);

      expect(result.params.cursor).toEqual(latestCursor);
      expect(params.cursor).toBeUndefined();
    });
  });
});
