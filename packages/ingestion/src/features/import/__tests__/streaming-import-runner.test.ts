/**
 * Tests for StreamingImportRunner (internal import execution service)
 *
 * Tests orchestration, database interactions, and error handling
 * This service coordinates importing from exchanges and blockchains
 */

import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { Account, AccountType, CursorState, ExchangeCredentials, ImportSession } from '@exitbook/core';
import type { AccountQueries, ImportSessionQueries, RawDataQueries } from '@exitbook/data';
import { err, errAsync, ok, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdapterRegistry } from '../../../shared/types/adapter-registry.js';
import type { ITransactionProcessor } from '../../../shared/types/processors.js';
import { StreamingImportRunner } from '../streaming-import-runner.js';

// Helper to create mock accounts
function createMockAccount(
  accountType: AccountType,
  sourceName: string,
  identifier: string,
  options?: {
    credentials?: ExchangeCredentials;
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
    streamType: 'normal',
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

// Create a mock exchange import streaming function that can be controlled per-test
const mockExchangeImportStreamingFn = vi.fn().mockImplementation(async function* () {
  yield okAsync({
    rawTransactions: [
      { refid: 'kraken-1', type: 'trade' },
      { refid: 'kraken-2', type: 'deposit' },
    ],
    streamType: 'ledger',
    cursor: {
      primary: { type: 'timestamp', value: 1 },
      lastTransactionId: 'kraken-2',
      totalFetched: 2,
    },
    isComplete: true,
  });
});

function createTestRegistry() {
  return new AdapterRegistry(
    [
      {
        blockchain: 'bitcoin',
        chainModel: 'account-based',
        normalizeAddress: (addr: string) => ok(addr.toLowerCase()),
        createImporter: () => ({
          import: mockImportFn,
          importStreaming: mockImportStreamingFn,
        }),
        createProcessor: vi.fn().mockReturnValue({} as ITransactionProcessor),
      },
      {
        blockchain: 'ethereum',
        chainModel: 'account-based',
        normalizeAddress: (addr: string) => ok(addr.toLowerCase()),
        createImporter: () => ({
          import: mockImportFn,
          importStreaming: mockImportStreamingFn,
        }),
        createProcessor: vi.fn().mockReturnValue({} as ITransactionProcessor),
      },
    ],
    [
      {
        exchange: 'kraken',
        createImporter: () => ({
          importStreaming: mockExchangeImportStreamingFn,
        }),
        createProcessor: vi.fn().mockReturnValue({} as ITransactionProcessor),
      },
    ]
  );
}

describe('StreamingImportRunner', () => {
  let service: StreamingImportRunner;
  let mockRawDataQueries: RawDataQueries;
  let mockImportSessionQueries: ImportSessionQueries;
  let mockAccountQueries: AccountQueries;
  let mockProviderManager: BlockchainProviderManager;

  beforeEach(() => {
    // Reset the mock import streaming function to default behavior
    mockImportStreamingFn.mockReset().mockImplementation(async function* () {
      yield okAsync({
        rawTransactions: [
          { transactionHash: 'tx1', blockHeight: 100 },
          { transactionHash: 'tx2', blockHeight: 101 },
        ],
        streamType: 'normal',
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

    mockExchangeImportStreamingFn.mockReset().mockImplementation(async function* () {
      yield okAsync({
        rawTransactions: [
          { refid: 'kraken-1', type: 'trade' },
          { refid: 'kraken-2', type: 'deposit' },
        ],
        streamType: 'ledger',
        cursor: {
          primary: { type: 'timestamp', value: 1 },
          lastTransactionId: 'kraken-2',
          totalFetched: 2,
        },
        isComplete: true,
      });
    });

    mockRawDataQueries = {
      saveBatch: vi.fn(),
      load: vi.fn(),
      countByStreamType: vi.fn().mockResolvedValue(ok(new Map())),
    } as unknown as RawDataQueries;

    mockImportSessionQueries = {
      create: vi.fn(),
      finalize: vi.fn(),
      findByAccount: vi.fn(),
      findById: vi.fn(),
      findCompletedWithMatchingParams: vi.fn(),
      findLatestIncomplete: vi.fn(),
      update: vi.fn(),
    } as unknown as ImportSessionQueries;
    vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(ok(undefined));

    mockAccountQueries = {
      updateCursor: vi.fn().mockResolvedValue(ok()),
    } as unknown as AccountQueries;

    mockProviderManager = {} as BlockchainProviderManager;

    const registry = createTestRegistry();
    service = new StreamingImportRunner(
      mockRawDataQueries,
      mockImportSessionQueries,
      mockAccountQueries,
      mockProviderManager,
      registry
    );
  });

  describe('importFromSource - blockchain', () => {
    it('should successfully import from blockchain', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

      const mockSession: ImportSession = {
        id: 1,
        accountId: 1,
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
        transactionsImported: 2,
        transactionsSkipped: 0,
        createdAt: new Date(),
      };

      vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionQueries.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawDataQueries.saveBatch).mockResolvedValue(ok({ inserted: 2, skipped: 0 }));
      vi.mocked(mockImportSessionQueries.finalize).mockResolvedValue(ok());
      vi.mocked(mockImportSessionQueries.findById).mockResolvedValue(ok(mockSession));

      const result = await service.importFromSource(account);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.transactionsImported).toBe(2);
        expect(result.value.id).toBe(1);
      }

      expect(mockImportSessionQueries.create).toHaveBeenCalledWith(1);
      expect(mockRawDataQueries.saveBatch).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({ transactionHash: 'tx1' }),
          expect.objectContaining({ transactionHash: 'tx2' }),
        ])
      );
      expect(mockImportSessionQueries.finalize).toHaveBeenCalledWith(
        1,
        'completed',
        expect.any(Number),
        2, // transactionsImported
        0 // transactionsSkipped
      );
    });

    it('should normalize blockchain address before import', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'BC1QXY2KGDYGJRSQTZQ2N0YRF2493P83KKFJHX0WLH'); // Uppercase

      const mockSession: ImportSession = {
        id: 1,
        accountId: 1,
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
        transactionsImported: 2,
        transactionsSkipped: 0,
        createdAt: new Date(),
      };

      vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionQueries.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawDataQueries.saveBatch).mockResolvedValue(ok({ inserted: 2, skipped: 0 }));
      vi.mocked(mockImportSessionQueries.finalize).mockResolvedValue(ok());
      vi.mocked(mockImportSessionQueries.findById).mockResolvedValue(ok(mockSession));

      const result = await service.importFromSource(account);

      expect(result.isOk()).toBe(true);

      // Verify normalized address was used - create is called with accountId only
      expect(mockImportSessionQueries.create).toHaveBeenCalledWith(1);
    });

    it('should resume from incomplete import session with cursor', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', {
        lastCursor: {
          normal: {
            primary: { type: 'blockNumber', value: 50 },
            lastTransactionId: 'tx-50',
            totalFetched: 50,
          },
        },
      });

      const incompleteImportSession: ImportSession = {
        id: 42,
        accountId: 1,
        status: 'started' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        startedAt: new Date(),
        transactionsImported: 50,
        transactionsSkipped: 0,
      };

      const completedSession: ImportSession = {
        ...incompleteImportSession,
        status: 'completed',
        completedAt: new Date(),
        transactionsImported: 52,
      };

      vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(ok(incompleteImportSession));
      vi.mocked(mockImportSessionQueries.update).mockResolvedValue(ok());
      vi.mocked(mockRawDataQueries.saveBatch).mockResolvedValue(ok({ inserted: 2, skipped: 0 }));
      vi.mocked(mockImportSessionQueries.finalize).mockResolvedValue(ok());
      vi.mocked(mockImportSessionQueries.findById).mockResolvedValue(ok(completedSession));

      const result = await service.importFromSource(account);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.transactionsImported).toBe(52); // 50 previous + 2 new = cumulative total
        expect(result.value.id).toBe(42);
      }

      // Should NOT create new import session (resuming existing one)
      expect(mockImportSessionQueries.create).not.toHaveBeenCalled();
      // Should update status back to 'started'
      expect(mockImportSessionQueries.update).toHaveBeenCalledWith(42, { status: 'started' });
    });

    it('should return error for unknown blockchain', async () => {
      const account = createMockAccount('blockchain', 'unknown-chain', 'some-address');

      vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(ok(undefined));

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

    it('should handle database errors during import session creation', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

      vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionQueries.create).mockResolvedValue(err(new Error('Database connection failed')));

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database connection failed');
      }
    });

    it('should finalize as failed if saveBatch fails', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

      vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionQueries.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawDataQueries.saveBatch).mockResolvedValue(err(new Error('Disk full')));

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Disk full');
      }
    });

    it('should finalize as failed if importer throws error', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

      vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionQueries.create).mockResolvedValue(ok(1));
      vi.mocked(mockImportSessionQueries.finalize).mockResolvedValue(ok());

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
      expect(mockImportSessionQueries.finalize).toHaveBeenCalledWith(
        1,
        'failed',
        expect.any(Number),
        0, // transactionsImported
        0, // transactionsSkipped
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

      const mockSession: ImportSession = {
        id: 1,
        accountId: 1,
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
        transactionsImported: 2,
        transactionsSkipped: 0,
        createdAt: new Date(),
      };

      vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionQueries.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawDataQueries.saveBatch).mockResolvedValue(ok({ inserted: 2, skipped: 0 }));
      vi.mocked(mockImportSessionQueries.finalize).mockResolvedValue(ok());
      vi.mocked(mockImportSessionQueries.findById).mockResolvedValue(ok(mockSession));
      vi.mocked(mockAccountQueries.updateCursor).mockResolvedValue(ok());

      const result = await service.importFromSource(account);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.transactionsImported).toBe(2);
        expect(result.value.id).toBe(1);
      }

      expect(mockImportSessionQueries.create).toHaveBeenCalledWith(1);
      expect(mockRawDataQueries.saveBatch).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({ refid: 'kraken-1' }),
          expect.objectContaining({ refid: 'kraken-2' }),
        ])
      );
      expect(mockImportSessionQueries.finalize).toHaveBeenCalledWith(
        1,
        'completed',
        expect.any(Number),
        2, // transactionsImported
        0 // transactionsSkipped
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

      const existingImportSession: ImportSession = {
        id: 10,
        accountId: 1,
        status: 'started' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        startedAt: new Date(),
        transactionsImported: 0,
        transactionsSkipped: 0,
      };

      const completedSession: ImportSession = {
        ...existingImportSession,
        id: 10,
        status: 'completed',
        completedAt: new Date(),
        transactionsImported: 2,
      };

      vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(ok(existingImportSession));
      vi.mocked(mockImportSessionQueries.update).mockResolvedValue(ok());
      vi.mocked(mockRawDataQueries.saveBatch).mockResolvedValue(ok({ inserted: 2, skipped: 0 }));
      vi.mocked(mockImportSessionQueries.finalize).mockResolvedValue(ok());
      vi.mocked(mockImportSessionQueries.findById).mockResolvedValue(ok(completedSession));
      vi.mocked(mockAccountQueries.updateCursor).mockResolvedValue(ok());

      const result = await service.importFromSource(account);

      expect(result.isOk()).toBe(true);

      // Should NOT create new import session
      expect(mockImportSessionQueries.create).not.toHaveBeenCalled();
    });

    it('should return error for unknown exchange', async () => {
      const account = createMockAccount('exchange-api', 'unknown-exchange', 'test-api-key', {
        credentials: {
          apiKey: 'test-key',
          apiSecret: '',
        },
      });

      vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionQueries.create).mockResolvedValue(ok(1));

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
          apiSecret: '',
        },
      });

      vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(
        err(new Error('Database unavailable'))
      );

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database unavailable');
      }
    });

    it('should handle streaming failure after successful batch by saving successful items', async () => {
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

      vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionQueries.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawDataQueries.saveBatch).mockResolvedValue(ok({ inserted: 2, skipped: 0 }));
      vi.mocked(mockImportSessionQueries.update).mockResolvedValue(ok());
      vi.mocked(mockAccountQueries.updateCursor).mockResolvedValue(ok());

      // Configure the mock to yield a successful batch, then an error
      mockExchangeImportStreamingFn.mockImplementationOnce(async function* () {
        // First batch succeeds
        yield okAsync({
          rawTransactions: successfulItems,
          streamType: 'trade',
          cursor: { primary: { type: 'timestamp', value: 2 }, lastTransactionId: 'trade-2', totalFetched: 2 },
          isComplete: false,
        });
        // Second batch fails
        yield err(new Error('Validation failed on item 3'));
      });

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Validation failed on item 3');
      }

      // Should save successful batch before failing
      expect(mockRawDataQueries.saveBatch).toHaveBeenCalledWith(1, successfulItems);

      // Should update import session as failed
      expect(mockImportSessionQueries.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          status: 'failed',
          error_message: 'Validation failed on item 3',
        })
      );
    });

    it('should handle importer yielding err (not throwing)', async () => {
      const account = createMockAccount('exchange-api', 'kraken', 'test-api-key', {
        credentials: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
        },
      });

      vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionQueries.create).mockResolvedValue(ok(1));
      vi.mocked(mockImportSessionQueries.update).mockResolvedValue(ok());

      // Importer yields an Error wrapped in err() immediately
      mockExchangeImportStreamingFn.mockImplementationOnce(async function* () {
        yield errAsync(new Error('API rate limit exceeded'));
      });

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('API rate limit exceeded');
      }

      // Should NOT attempt to save anything
      expect(mockRawDataQueries.saveBatch).not.toHaveBeenCalled();

      // Should update import session as failed
      expect(mockImportSessionQueries.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          status: 'failed',
          error_message: 'API rate limit exceeded',
        })
      );
    });

    it('should fail import when warnings are emitted to prevent partial processing', async () => {
      const account = createMockAccount('exchange-api', 'kraken', 'test-api-key', {
        credentials: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
        },
      });

      vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionQueries.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawDataQueries.saveBatch).mockResolvedValue(ok({ inserted: 0, skipped: 0 }));
      vi.mocked(mockAccountQueries.updateCursor).mockResolvedValue(ok());
      vi.mocked(mockImportSessionQueries.finalize).mockResolvedValue(ok());

      mockExchangeImportStreamingFn.mockImplementationOnce(async function* () {
        yield okAsync({
          rawTransactions: [],
          streamType: 'ledger',
          cursor: {
            primary: { type: 'timestamp', value: 1 },
            lastTransactionId: 'kraken-1',
            totalFetched: 0,
          },
          isComplete: true,
          warnings: ['Test warning: partial data'],
        });
      });

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('warning(s)');
      }

      expect(mockImportSessionQueries.finalize).toHaveBeenCalledWith(
        1,
        'failed',
        expect.any(Number),
        0,
        0,
        expect.stringContaining('warning(s)'),
        { warnings: ['Test warning: partial data'] }
      );
    });

    it('should emit warning when stream count metadata lookup fails but continue import', async () => {
      const account = createMockAccount('exchange-api', 'kraken', 'test-api-key', {
        credentials: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
        },
        lastCursor: {
          ledger: {
            primary: { type: 'timestamp', value: 1 },
            lastTransactionId: 'kraken-1',
            totalFetched: 20,
          },
        },
      });

      const mockEventBus = { emit: vi.fn() };
      const registry = createTestRegistry();
      const serviceWithEvents = new StreamingImportRunner(
        mockRawDataQueries,
        mockImportSessionQueries,
        mockAccountQueries,
        mockProviderManager,
        registry,
        mockEventBus as never
      );

      const mockSession: ImportSession = {
        id: 1,
        accountId: 1,
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
        transactionsImported: 2,
        transactionsSkipped: 0,
        createdAt: new Date(),
      };

      vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionQueries.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawDataQueries.countByStreamType).mockResolvedValue(err(new Error('metrics unavailable')));
      vi.mocked(mockRawDataQueries.saveBatch).mockResolvedValue(ok({ inserted: 2, skipped: 0 }));
      vi.mocked(mockImportSessionQueries.finalize).mockResolvedValue(ok());
      vi.mocked(mockImportSessionQueries.findById).mockResolvedValue(ok(mockSession));
      vi.mocked(mockAccountQueries.updateCursor).mockResolvedValue(ok());

      const result = await serviceWithEvents.importFromSource(account);

      expect(result.isOk()).toBe(true);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'import.warning',
          sourceName: 'kraken',
          accountId: 1,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- acceptable for tests
          warning: expect.stringContaining('Failed to fetch import stream counts'),
        })
      );
    });
  });

  describe('importFromSource - blockchain - additional error cases', () => {
    it('should handle importer returning err() instead of throwing', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

      vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionQueries.create).mockResolvedValue(ok(1));

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
      expect(mockRawDataQueries.saveBatch).not.toHaveBeenCalled();
    });

    it('should handle errors when checking for incomplete import session', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

      vi.mocked(mockImportSessionQueries.findLatestIncomplete).mockResolvedValue(
        err(new Error('Database corruption detected'))
      );

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database corruption detected');
      }

      // Should NOT attempt to create new import session
      expect(mockImportSessionQueries.create).not.toHaveBeenCalled();
    });
  });
});
