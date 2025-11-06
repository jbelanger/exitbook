/* eslint-disable unicorn/no-useless-undefined -- acceptable for tests */
/**
 * Tests for TransactionImportService (imperative shell)
 *
 * Tests orchestration, database interactions, and error handling
 * This service coordinates importing from exchanges and blockchains
 */

/* eslint-disable @typescript-eslint/unbound-method -- Acceptable for tests */
/* eslint-disable @typescript-eslint/no-explicit-any -- Acceptable for test mocks */

import type { DataSource, ExternalTransaction } from '@exitbook/core';
import { PartialImportError } from '@exitbook/exchanges';
import type { BlockchainProviderManager } from '@exitbook/providers';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImportParams } from '../../types/importers.js';
import type { IDataSourceRepository, IRawDataRepository } from '../../types/repositories.js';
import { TransactionImportService } from '../import-service.js';

// Mock logger
vi.mock('@exitbook/shared-logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Create a mock import function that can be controlled per-test
const mockImportFn = vi.fn().mockResolvedValue(
  ok({
    rawTransactions: [
      { transactionHash: 'tx1', blockHeight: 100 },
      { transactionHash: 'tx2', blockHeight: 101 },
    ],
    metadata: { blockRange: '100-101' },
  })
);

// Mock blockchain config
vi.mock('../../infrastructure/blockchains/index.js', () => ({
  getBlockchainConfig: (id: string) => {
    if (id === 'bitcoin' || id === 'ethereum') {
      return {
        normalizeAddress: (addr: string) => ok(addr.toLowerCase()),
        createImporter: () => ({
          import: mockImportFn,
        }),
      };
    }
    return undefined;
  },
}));

// Create a mock exchange import function that can be controlled per-test
const mockExchangeImportFn = vi.fn().mockResolvedValue(
  ok({
    rawTransactions: [
      { refid: 'kraken-1', type: 'trade' },
      { refid: 'kraken-2', type: 'deposit' },
    ],
    metadata: { apiVersion: 'v1' },
  })
);

// Mock exchange importer factory
vi.mock('../../infrastructure/exchanges/shared/exchange-importer-factory.js', () => ({
  createExchangeImporter: (sourceId: string, _params: ImportParams) => {
    if (sourceId === 'kraken') {
      return ok({
        import: mockExchangeImportFn,
      });
    }
    return err(new Error(`Unknown exchange: ${sourceId}`));
  },
}));

describe('TransactionImportService', () => {
  let service: TransactionImportService;
  let mockRawDataRepo: IRawDataRepository;
  let mockDataSourceRepo: IDataSourceRepository;
  let mockProviderManager: BlockchainProviderManager;

  beforeEach(() => {
    // Reset the mock import functions to default behavior
    mockImportFn.mockReset().mockResolvedValue(
      ok({
        rawTransactions: [
          { transactionHash: 'tx1', blockHeight: 100 },
          { transactionHash: 'tx2', blockHeight: 101 },
        ],
        metadata: { blockRange: '100-101' },
      })
    );

    mockExchangeImportFn.mockReset().mockResolvedValue(
      ok({
        rawTransactions: [
          { refid: 'kraken-1', type: 'trade' },
          { refid: 'kraken-2', type: 'deposit' },
        ],
        metadata: { apiVersion: 'v1' },
      })
    );

    mockRawDataRepo = {
      saveBatch: vi.fn(),
      load: vi.fn(),
      getLatestCursor: vi.fn(),
    } as unknown as IRawDataRepository;

    mockDataSourceRepo = {
      create: vi.fn(),
      finalize: vi.fn(),
      findBySource: vi.fn(),
      findCompletedWithMatchingParams: vi.fn(),
    } as unknown as IDataSourceRepository;

    mockProviderManager = {} as BlockchainProviderManager;

    service = new TransactionImportService(mockRawDataRepo, mockDataSourceRepo, mockProviderManager);
  });

  describe('importFromSource - blockchain', () => {
    it('should successfully import from blockchain', async () => {
      const params: ImportParams = {
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      vi.mocked(mockDataSourceRepo.findCompletedWithMatchingParams).mockResolvedValue(ok(undefined));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawDataRepo.saveBatch).mockResolvedValue(ok(2));
      vi.mocked(mockDataSourceRepo.finalize).mockResolvedValue(ok());

      const result = await service.importFromSource('bitcoin', 'blockchain', params);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.imported).toBe(2);
        expect(result.value.dataSourceId).toBe(1);
      }

      expect(mockDataSourceRepo.create).toHaveBeenCalledWith(
        'bitcoin',
        'blockchain',
        expect.objectContaining({
          address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        })
      );
      expect(mockRawDataRepo.saveBatch).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({ transactionHash: 'tx1' }),
          expect.objectContaining({ transactionHash: 'tx2' }),
        ])
      );
      expect(mockDataSourceRepo.finalize).toHaveBeenCalledWith(
        1,
        'completed',
        expect.any(Number),
        undefined,
        undefined,
        expect.objectContaining({ blockRange: '100-101' })
      );
    });

    it('should normalize blockchain address before import', async () => {
      const params: ImportParams = {
        address: 'BC1QXY2KGDYGJRSQTZQ2N0YRF2493P83KKFJHX0WLH', // Uppercase
      };

      vi.mocked(mockDataSourceRepo.findCompletedWithMatchingParams).mockResolvedValue(ok(undefined));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawDataRepo.saveBatch).mockResolvedValue(ok(2));
      vi.mocked(mockDataSourceRepo.finalize).mockResolvedValue(ok());

      const result = await service.importFromSource('bitcoin', 'blockchain', params);

      expect(result.isOk()).toBe(true);

      // Verify normalized address was used
      expect(mockDataSourceRepo.create).toHaveBeenCalledWith(
        'bitcoin',
        'blockchain',
        expect.objectContaining({
          address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', // Lowercase
        })
      );
    });

    it('should reuse existing completed data source with matching params', async () => {
      const params: ImportParams = {
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      const existingDataSource: DataSource = {
        id: 42,
        sourceId: 'bitcoin',
        sourceType: 'blockchain' as const,
        status: 'completed' as const,
        importParams: params,
        createdAt: new Date(),
        updatedAt: new Date(),
        startedAt: new Date(),
        importResultMetadata: {},
      };

      vi.mocked(mockDataSourceRepo.findCompletedWithMatchingParams).mockResolvedValue(ok(existingDataSource));
      vi.mocked(mockRawDataRepo.load).mockResolvedValue(
        ok([
          { id: 1, dataSourceId: 42, rawData: { hash: 'tx1' } },
          { id: 2, dataSourceId: 42, rawData: { hash: 'tx2' } },
        ] as any)
      );

      const result = await service.importFromSource('bitcoin', 'blockchain', params);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.imported).toBe(2);
        expect(result.value.dataSourceId).toBe(42);
      }

      // Should NOT create new data source
      expect(mockDataSourceRepo.create).not.toHaveBeenCalled();
      // Should load existing raw data
      expect(mockRawDataRepo.load).toHaveBeenCalledWith({ dataSourceId: 42 });
    });

    it('should return error for unknown blockchain', async () => {
      const params: ImportParams = {
        address: 'some-address',
      };

      const result = await service.importFromSource('unknown-chain', 'blockchain', params);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Unknown blockchain: unknown-chain');
      }
    });

    it('should return error if address is missing', async () => {
      const params: ImportParams = {}; // No address

      const result = await service.importFromSource('bitcoin', 'blockchain', params);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Address required');
      }
    });

    it('should handle database errors during data source creation', async () => {
      const params: ImportParams = {
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      vi.mocked(mockDataSourceRepo.findCompletedWithMatchingParams).mockResolvedValue(ok(undefined));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(err(new Error('Database connection failed')));

      const result = await service.importFromSource('bitcoin', 'blockchain', params);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database connection failed');
      }
    });

    it('should finalize as failed if saveBatch fails', async () => {
      const params: ImportParams = {
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      vi.mocked(mockDataSourceRepo.findCompletedWithMatchingParams).mockResolvedValue(ok(undefined));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawDataRepo.saveBatch).mockResolvedValue(err(new Error('Disk full')));

      const result = await service.importFromSource('bitcoin', 'blockchain', params);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Disk full');
      }
    });

    it('should finalize as failed if importer throws error', async () => {
      const params: ImportParams = {
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      vi.mocked(mockDataSourceRepo.findCompletedWithMatchingParams).mockResolvedValue(ok(undefined));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockDataSourceRepo.finalize).mockResolvedValue(ok());

      // Configure the mock import function to reject with an error (simulating a thrown exception)
      mockImportFn.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await service.importFromSource('bitcoin', 'blockchain', params);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Network timeout');
      }

      // Should have attempted to finalize as failed
      expect(mockDataSourceRepo.finalize).toHaveBeenCalledWith(
        1,
        'failed',
        expect.any(Number),
        expect.stringContaining('Network timeout'),
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- acceptable for tests
          stack: expect.any(String),
        })
      );
    });
  });

  describe('importFromSource - exchange', () => {
    it('should successfully import from exchange', async () => {
      const params: ImportParams = {
        credentials: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
        },
      };

      vi.mocked(mockDataSourceRepo.findBySource).mockResolvedValue(ok([]));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawDataRepo.saveBatch).mockResolvedValue(ok(2));
      vi.mocked(mockDataSourceRepo.finalize).mockResolvedValue(ok());

      const result = await service.importFromSource('kraken', 'exchange', params);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.imported).toBe(2);
        expect(result.value.dataSourceId).toBe(1);
      }

      expect(mockDataSourceRepo.create).toHaveBeenCalledWith('kraken', 'exchange', params);
      expect(mockRawDataRepo.saveBatch).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({ refid: 'kraken-1' }),
          expect.objectContaining({ refid: 'kraken-2' }),
        ])
      );
      expect(mockDataSourceRepo.finalize).toHaveBeenCalledWith(
        1,
        'completed',
        expect.any(Number),
        undefined,
        undefined,
        expect.objectContaining({ apiVersion: 'v1' })
      );
    });

    it('should resume existing exchange import with cursor', async () => {
      const params: ImportParams = {
        credentials: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
        },
      };

      const existingDataSource: DataSource = {
        id: 10,
        sourceId: 'kraken',
        sourceType: 'exchange' as const,
        status: 'started' as const,
        importParams: params,
        createdAt: new Date(),
        updatedAt: new Date(),
        startedAt: new Date(),
        importResultMetadata: {},
      };

      const cursor: Record<string, number> = { trade: 1, deposit: 2 };

      vi.mocked(mockDataSourceRepo.findBySource).mockResolvedValue(ok([existingDataSource]));
      vi.mocked(mockRawDataRepo.getLatestCursor).mockResolvedValue(ok(cursor));
      vi.mocked(mockRawDataRepo.saveBatch).mockResolvedValue(ok(2));
      vi.mocked(mockDataSourceRepo.finalize).mockResolvedValue(ok());

      const result = await service.importFromSource('kraken', 'exchange', params);

      expect(result.isOk()).toBe(true);

      // Should NOT create new data source
      expect(mockDataSourceRepo.create).not.toHaveBeenCalled();
      // Cursor should have been loaded
      expect(mockRawDataRepo.getLatestCursor).toHaveBeenCalledWith(10);
    });

    it('should return error for unknown exchange', async () => {
      const params: ImportParams = {
        credentials: {
          apiKey: 'test-key',
        },
      };

      vi.mocked(mockDataSourceRepo.findBySource).mockResolvedValue(ok([]));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));

      const result = await service.importFromSource('unknown-exchange', 'exchange', params);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Unknown exchange: unknown-exchange');
      }
    });

    it('should handle database errors gracefully', async () => {
      const params: ImportParams = {
        credentials: {
          apiKey: 'test-key',
        },
      };

      vi.mocked(mockDataSourceRepo.findBySource).mockResolvedValue(err(new Error('Database unavailable')));

      const result = await service.importFromSource('kraken', 'exchange', params);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database unavailable');
      }
    });

    it('should handle PartialImportError by saving successful items and finalizing as failed', async () => {
      const params: ImportParams = {
        credentials: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
        },
      };

      const successfulItems = [
        { refid: 'kraken-1', type: 'trade' },
        { refid: 'kraken-2', type: 'deposit' },
      ];

      const partialError = new PartialImportError(
        'Validation failed on item 3',
        successfulItems as unknown as ExternalTransaction[],
        { refid: 'kraken-3', type: 'invalid' },
        { trade: 2 }
      );

      vi.mocked(mockDataSourceRepo.findBySource).mockResolvedValue(ok([]));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawDataRepo.saveBatch).mockResolvedValue(ok(2));
      vi.mocked(mockDataSourceRepo.finalize).mockResolvedValue(ok());

      // Configure the mock to return a PartialImportError
      mockExchangeImportFn.mockResolvedValueOnce(err(partialError));

      const result = await service.importFromSource('kraken', 'exchange', params);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Validation failed after 2 successful items');
        expect(result.error.message).toContain('Validation failed on item 3');
      }

      // Should save successful items before failing
      expect(mockRawDataRepo.saveBatch).toHaveBeenCalledWith(1, successfulItems);

      // Should finalize as failed with error metadata
      expect(mockDataSourceRepo.finalize).toHaveBeenCalledWith(
        1,
        'failed',
        expect.any(Number),
        'Validation failed on item 3',
        expect.objectContaining({
          failedItem: { refid: 'kraken-3', type: 'invalid' },
          lastSuccessfulCursor: { trade: 2 },
        })
      );
    });

    it('should handle importer returning err (not throwing)', async () => {
      const params: ImportParams = {
        credentials: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
        },
      };

      vi.mocked(mockDataSourceRepo.findBySource).mockResolvedValue(ok([]));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));

      // Importer returns an Error wrapped in err() (not PartialImportError)
      mockExchangeImportFn.mockResolvedValueOnce(err(new Error('API rate limit exceeded')));

      const result = await service.importFromSource('kraken', 'exchange', params);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('API rate limit exceeded');
      }

      // Should NOT attempt to save anything
      expect(mockRawDataRepo.saveBatch).not.toHaveBeenCalled();
    });
  });

  describe('importFromSource - blockchain - additional error cases', () => {
    it('should handle importer returning err() instead of throwing', async () => {
      const params: ImportParams = {
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      vi.mocked(mockDataSourceRepo.findCompletedWithMatchingParams).mockResolvedValue(ok(undefined));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));

      // Importer returns err() (not throwing)
      mockImportFn.mockResolvedValueOnce(err(new Error('Provider unavailable')));

      const result = await service.importFromSource('bitcoin', 'blockchain', params);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Provider unavailable');
      }

      // Should NOT save anything
      expect(mockRawDataRepo.saveBatch).not.toHaveBeenCalled();
    });

    it('should handle errors when loading existing data source raw data', async () => {
      const params: ImportParams = {
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      };

      const existingDataSource: DataSource = {
        id: 42,
        sourceId: 'bitcoin',
        sourceType: 'blockchain' as const,
        status: 'completed' as const,
        importParams: params,
        createdAt: new Date(),
        updatedAt: new Date(),
        startedAt: new Date(),
        importResultMetadata: {},
      };

      vi.mocked(mockDataSourceRepo.findCompletedWithMatchingParams).mockResolvedValue(ok(existingDataSource));
      vi.mocked(mockRawDataRepo.load).mockResolvedValue(err(new Error('Database corruption detected')));

      const result = await service.importFromSource('bitcoin', 'blockchain', params);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database corruption detected');
      }

      // Should NOT attempt to create new data source
      expect(mockDataSourceRepo.create).not.toHaveBeenCalled();
    });
  });
});
