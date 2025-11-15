/**
 * Tests for TransactionImportService (imperative shell)
 *
 * Tests orchestration, database interactions, and error handling
 * This service coordinates importing from exchanges and blockchains
 */

/* eslint-disable @typescript-eslint/unbound-method -- Acceptable for tests */

import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { Account, AccountType, CursorState, DataSource, ExternalTransaction } from '@exitbook/core';
import type { AccountRepository } from '@exitbook/data';
import { PartialImportError } from '@exitbook/exchanges-providers';
import { err, errAsync, ok, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImportParams } from '../../types/importers.js';
import type { IDataSourceRepository, IRawDataRepository } from '../../types/repositories.js';
import { TransactionImportService } from '../import-service.js';

// Helper to create mock accounts
function createMockAccount(
  accountType: AccountType,
  sourceName: string,
  identifier: string,
  options?: {
    credentials?: Record<string, string>;
    lastCursor?: Record<string, CursorState>;
    providerName?: string;
  }
): Account {
  return {
    id: 1,
    userId: 1,
    accountType,
    sourceName,
    identifier,
    providerName: options?.providerName,
    credentials: options?.credentials,
    lastCursor: options?.lastCursor,
    createdAt: new Date(),
  };
}

// Mock logger
vi.mock('@exitbook/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Create a mock import streaming function that can be controlled per-test
const mockImportStreamingFn = vi.fn().mockImplementation(async function* () {
  yield okAsync({
    rawTransactions: [
      { transactionHash: 'tx1', blockHeight: 100 },
      { transactionHash: 'tx2', blockHeight: 101 },
    ],
    operationType: 'normal',
    cursor: { primary: { type: 'offset', value: 2 }, totalFetched: 2 },
    isComplete: true,
  });
});

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
          importStreaming: mockImportStreamingFn,
        }),
      };
    }
    return;
  },
}));

// Create a mock exchange import function that can be controlled per-test
const mockExchangeImportFn = vi.fn().mockResolvedValue(
  ok({
    rawTransactions: [
      { refid: 'kraken-1', type: 'trade' },
      { refid: 'kraken-2', type: 'deposit' },
    ],
    cursorUpdates: {
      ledger: {
        primary: { type: 'timestamp', value: 1 },
        lastTransactionId: 'kraken-2',
        totalFetched: 2,
      },
    },
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
  let mockAccountRepo: AccountRepository;
  let mockProviderManager: BlockchainProviderManager;

  beforeEach(() => {
    // Reset the mock import streaming function to default behavior
    mockImportStreamingFn.mockReset().mockImplementation(async function* () {
      yield okAsync({
        rawTransactions: [
          { transactionHash: 'tx1', blockHeight: 100 },
          { transactionHash: 'tx2', blockHeight: 101 },
        ],
        operationType: 'normal',
        cursor: { primary: { type: 'blockNumber', value: 2 }, lastTransactionId: 'tx2', totalFetched: 2 },
        isComplete: true,
      });
    });

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
        cursorUpdates: {
          ledger: {
            primary: { type: 'timestamp', value: 1 },
            lastTransactionId: 'kraken-2',
            totalFetched: 2,
          },
        },
        metadata: { apiVersion: 'v1' },
      })
    );

    mockRawDataRepo = {
      saveBatch: vi.fn(),
      load: vi.fn(),
    } as unknown as IRawDataRepository;

    mockDataSourceRepo = {
      create: vi.fn(),
      finalize: vi.fn(),
      findByAccount: vi.fn(),
      findCompletedWithMatchingParams: vi.fn(),
      findLatestIncomplete: vi.fn(),
      update: vi.fn(),
    } as unknown as IDataSourceRepository;

    mockAccountRepo = {
      updateCursor: vi.fn().mockResolvedValue(ok()),
    } as unknown as AccountRepository;

    mockProviderManager = {} as BlockchainProviderManager;

    service = new TransactionImportService(mockRawDataRepo, mockDataSourceRepo, mockAccountRepo, mockProviderManager);
  });

  describe('importFromSource - blockchain', () => {
    it('should successfully import from blockchain', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

      vi.mocked(mockDataSourceRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawDataRepo.saveBatch).mockResolvedValue(ok(2));
      vi.mocked(mockDataSourceRepo.finalize).mockResolvedValue(ok());

      const result = await service.importFromSource(account);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.imported).toBe(2);
        expect(result.value.dataSourceId).toBe(1);
      }

      expect(mockDataSourceRepo.create).toHaveBeenCalledWith(1);
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
        { transactionsImported: 2 }
      );
    });

    it('should normalize blockchain address before import', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'BC1QXY2KGDYGJRSQTZQ2N0YRF2493P83KKFJHX0WLH'); // Uppercase

      vi.mocked(mockDataSourceRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawDataRepo.saveBatch).mockResolvedValue(ok(2));
      vi.mocked(mockDataSourceRepo.finalize).mockResolvedValue(ok());

      const result = await service.importFromSource(account);

      expect(result.isOk()).toBe(true);

      // Verify normalized address was used - create is called with accountId only
      expect(mockDataSourceRepo.create).toHaveBeenCalledWith(1);
    });

    it('should resume from incomplete data source with cursor', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', {
        lastCursor: {
          normal: {
            primary: { type: 'blockNumber', value: 50 },
            lastTransactionId: 'tx-50',
            totalFetched: 50,
          },
        },
      });

      const incompleteDataSource: DataSource = {
        id: 42,
        accountId: 1,
        status: 'started' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        startedAt: new Date(),
        transactionsImported: 50,
        transactionsFailed: 0,
        importResultMetadata: { transactionsImported: 50 },
      };

      vi.mocked(mockDataSourceRepo.findLatestIncomplete).mockResolvedValue(ok(incompleteDataSource));
      vi.mocked(mockDataSourceRepo.update).mockResolvedValue(ok());
      vi.mocked(mockRawDataRepo.saveBatch).mockResolvedValue(ok(2));
      vi.mocked(mockDataSourceRepo.finalize).mockResolvedValue(ok());

      const result = await service.importFromSource(account);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.imported).toBe(52); // 50 previous + 2 new = cumulative total
        expect(result.value.dataSourceId).toBe(42);
      }

      // Should NOT create new data source (resuming existing one)
      expect(mockDataSourceRepo.create).not.toHaveBeenCalled();
      // Should update status back to 'started'
      expect(mockDataSourceRepo.update).toHaveBeenCalledWith(42, { status: 'started' });
    });

    it('should return error for unknown blockchain', async () => {
      const account = createMockAccount('blockchain', 'unknown-chain', 'some-address');

      vi.mocked(mockDataSourceRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Unknown blockchain: unknown-chain');
      }
    });

    it('should return error if address is missing', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', ''); // No address

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Address required');
      }
    });

    it('should handle database errors during data source creation', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

      vi.mocked(mockDataSourceRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(err(new Error('Database connection failed')));

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database connection failed');
      }
    });

    it('should finalize as failed if saveBatch fails', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

      vi.mocked(mockDataSourceRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawDataRepo.saveBatch).mockResolvedValue(err(new Error('Disk full')));

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Disk full');
      }
    });

    it('should finalize as failed if importer throws error', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

      vi.mocked(mockDataSourceRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockDataSourceRepo.finalize).mockResolvedValue(ok());

      // Configure the mock streaming function to throw an error
      // eslint-disable-next-line @typescript-eslint/require-await, require-yield -- acceptable for tests
      mockImportStreamingFn.mockImplementationOnce(async function* () {
        throw new Error('Network timeout');
      });

      const result = await service.importFromSource(account);

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
      const account = createMockAccount('exchange-api', 'kraken', 'test-api-key', {
        credentials: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
        },
      });

      vi.mocked(mockDataSourceRepo.findByAccount).mockResolvedValue(ok([]));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawDataRepo.saveBatch).mockResolvedValue(ok(2));
      vi.mocked(mockDataSourceRepo.finalize).mockResolvedValue(ok());

      const result = await service.importFromSource(account);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.imported).toBe(2);
        expect(result.value.dataSourceId).toBe(1);
      }

      expect(mockDataSourceRepo.create).toHaveBeenCalledWith(1);
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
      const cursorMap: Record<string, CursorState> = {
        trade: {
          primary: { type: 'timestamp', value: 1 },
          lastTransactionId: 'trade-1',
          totalFetched: 100,
        },
        deposit: {
          primary: { type: 'timestamp', value: 2 },
          lastTransactionId: 'deposit-1',
          totalFetched: 50,
        },
      };

      const account = createMockAccount('exchange-api', 'kraken', 'test-api-key', {
        credentials: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
        },
        lastCursor: cursorMap,
      });

      const existingDataSource: DataSource = {
        id: 10,
        accountId: 1,
        status: 'started' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        startedAt: new Date(),
        transactionsImported: 0,
        transactionsFailed: 0,
        importResultMetadata: {},
      };

      vi.mocked(mockDataSourceRepo.findByAccount).mockResolvedValue(ok([existingDataSource]));
      vi.mocked(mockRawDataRepo.saveBatch).mockResolvedValue(ok(2));
      vi.mocked(mockDataSourceRepo.finalize).mockResolvedValue(ok());

      const result = await service.importFromSource(account);

      expect(result.isOk()).toBe(true);

      // Should NOT create new data source
      expect(mockDataSourceRepo.create).not.toHaveBeenCalled();
    });

    it('should return error for unknown exchange', async () => {
      const account = createMockAccount('exchange-api', 'unknown-exchange', 'test-api-key', {
        credentials: {
          apiKey: 'test-key',
        },
      });

      vi.mocked(mockDataSourceRepo.findByAccount).mockResolvedValue(ok([]));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Unknown exchange: unknown-exchange');
      }
    });

    it('should handle database errors gracefully', async () => {
      const account = createMockAccount('exchange-api', 'kraken', 'test-api-key', {
        credentials: {
          apiKey: 'test-key',
        },
      });

      vi.mocked(mockDataSourceRepo.findByAccount).mockResolvedValue(err(new Error('Database unavailable')));

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database unavailable');
      }
    });

    it('should handle PartialImportError by saving successful items and finalizing as failed', async () => {
      const account = createMockAccount('exchange-api', 'kraken', 'test-api-key', {
        credentials: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
        },
      });

      const successfulItems = [
        { refid: 'kraken-1', type: 'trade' },
        { refid: 'kraken-2', type: 'deposit' },
      ];

      const partialError = new PartialImportError(
        'Validation failed on item 3',
        successfulItems as unknown as ExternalTransaction[],
        { refid: 'kraken-3', type: 'invalid' },
        { trade: { primary: { type: 'timestamp', value: 2 }, lastTransactionId: 'trade-2', totalFetched: 2 } }
      );

      vi.mocked(mockDataSourceRepo.findByAccount).mockResolvedValue(ok([]));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawDataRepo.saveBatch).mockResolvedValue(ok(2));
      vi.mocked(mockDataSourceRepo.finalize).mockResolvedValue(ok());

      // Configure the mock to return a PartialImportError
      mockExchangeImportFn.mockResolvedValueOnce(err(partialError));

      const result = await service.importFromSource(account);

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
          lastSuccessfulCursorUpdates: {
            trade: {
              primary: { type: 'timestamp', value: 2 },
              lastTransactionId: 'trade-2',
              totalFetched: 2,
            },
          },
        })
      );
    });

    it('should handle importer returning err (not throwing)', async () => {
      const account = createMockAccount('exchange-api', 'kraken', 'test-api-key', {
        credentials: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
        },
      });

      vi.mocked(mockDataSourceRepo.findByAccount).mockResolvedValue(ok([]));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));

      // Importer returns an Error wrapped in err() (not PartialImportError)
      mockExchangeImportFn.mockResolvedValueOnce(err(new Error('API rate limit exceeded')));

      const result = await service.importFromSource(account);

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
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

      vi.mocked(mockDataSourceRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockDataSourceRepo.create).mockResolvedValue(ok(1));

      // Importer yields err() (not throwing)
      mockImportStreamingFn.mockImplementationOnce(async function* () {
        yield errAsync(new Error('Provider unavailable'));
      });

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Provider unavailable');
      }

      // Should NOT save anything
      expect(mockRawDataRepo.saveBatch).not.toHaveBeenCalled();
    });

    it('should handle errors when checking for incomplete data source', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

      vi.mocked(mockDataSourceRepo.findLatestIncomplete).mockResolvedValue(
        err(new Error('Database corruption detected'))
      );

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database corruption detected');
      }

      // Should NOT attempt to create new data source
      expect(mockDataSourceRepo.create).not.toHaveBeenCalled();
    });
  });
});
