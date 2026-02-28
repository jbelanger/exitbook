/* eslint-disable @typescript-eslint/unbound-method -- Acceptable for tests */
/**
 * Tests for StreamingImportRunner (internal import execution service)
 *
 * Tests orchestration, database interactions, and error handling
 * This service coordinates importing from exchanges and blockchains
 */

import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { Account, AccountType, CursorState, ExchangeCredentials, ImportSession } from '@exitbook/core';
import type { AccountRepository, DataContext, ImportSessionRepository, RawTransactionRepository } from '@exitbook/data';
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

// Mock logger — hoisted so vi.mock factory can safely reference it
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@exitbook/logger', () => ({
  getLogger: () => mockLogger,
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
        capabilities: {
          supportsApi: true,
          supportsCsv: false,
        },
        exchange: 'kraken',
        createImporter: () => ({
          importStreaming: mockExchangeImportStreamingFn,
        }),
        createProcessor: vi.fn().mockReturnValue({} as ITransactionProcessor),
      },
    ]
  );
}

// Module-scope mock repo objects — passed directly via DataContext mock
let mockRawTransactionsRepo: RawTransactionRepository;
let mockImportSessionRepo: ImportSessionRepository;
let mockAccountRepo: AccountRepository;
let mockDb: DataContext;

describe('StreamingImportRunner', () => {
  let service: StreamingImportRunner;
  let mockProviderManager: BlockchainProviderManager;

  beforeEach(() => {
    vi.clearAllMocks();

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

    mockRawTransactionsRepo = {
      saveBatch: vi.fn(),
      load: vi.fn(),
      countByStreamType: vi.fn().mockResolvedValue(ok(new Map())),
    } as unknown as RawTransactionRepository;

    mockImportSessionRepo = {
      create: vi.fn(),
      finalize: vi.fn(),
      findByAccount: vi.fn(),
      findById: vi.fn(),
      findCompletedWithMatchingParams: vi.fn(),
      findLatestIncomplete: vi.fn(),
      update: vi.fn(),
    } as unknown as ImportSessionRepository;
    vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));

    mockAccountRepo = {
      updateCursor: vi.fn().mockResolvedValue(ok()),
    } as unknown as AccountRepository;

    mockDb = {
      importSessions: mockImportSessionRepo,
      rawTransactions: mockRawTransactionsRepo,
      accounts: mockAccountRepo,
      executeInTransaction: vi.fn().mockImplementation((fn: (tx: DataContext) => Promise<unknown>) => fn(mockDb)),
    } as unknown as DataContext;

    mockProviderManager = {} as BlockchainProviderManager;

    const registry = createTestRegistry();
    service = new StreamingImportRunner(mockDb, mockProviderManager, registry);
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

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawTransactionsRepo.saveBatch).mockResolvedValue(ok({ inserted: 2, skipped: 0 }));
      vi.mocked(mockImportSessionRepo.finalize).mockResolvedValue(ok());
      vi.mocked(mockImportSessionRepo.findById).mockResolvedValue(ok(mockSession));

      const result = await service.importFromSource(account);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.transactionsImported).toBe(2);
        expect(result.value.id).toBe(1);
      }

      expect(mockImportSessionRepo.create).toHaveBeenCalledWith(1);
      expect(mockRawTransactionsRepo.saveBatch).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({ transactionHash: 'tx1' }),
          expect.objectContaining({ transactionHash: 'tx2' }),
        ])
      );
      expect(mockImportSessionRepo.finalize).toHaveBeenCalledWith(
        1,
        'completed',
        expect.any(Number),
        2, // transactionsImported
        0 // transactionsSkipped
      );
    });

    it('should emit provider fetched and deduplicated stats in import.batch events', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
      const mockEventBus = { emit: vi.fn() };
      const registry = createTestRegistry();
      const serviceWithEvents = new StreamingImportRunner(mockDb, mockProviderManager, registry, mockEventBus as never);

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

      mockImportStreamingFn.mockImplementationOnce(async function* () {
        yield okAsync({
          rawTransactions: [
            { transactionHash: 'tx1', blockHeight: 100 },
            { transactionHash: 'tx2', blockHeight: 101 },
          ],
          streamType: 'normal',
          cursor: { primary: { type: 'blockNumber', value: 2 }, lastTransactionId: 'tx2', totalFetched: 2 },
          isComplete: true,
          providerStats: { fetched: 5, deduplicated: 3 },
        });
      });

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawTransactionsRepo.saveBatch).mockResolvedValue(ok({ inserted: 2, skipped: 0 }));
      vi.mocked(mockImportSessionRepo.finalize).mockResolvedValue(ok());
      vi.mocked(mockImportSessionRepo.findById).mockResolvedValue(ok(mockSession));
      vi.mocked(mockAccountRepo.updateCursor).mockResolvedValue(ok());

      const result = await serviceWithEvents.importFromSource(account);

      expect(result.isOk()).toBe(true);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'import.batch',
          sourceName: 'bitcoin',
          accountId: 1,
          fetched: 5,
          deduplicated: 3,
          totalFetchedRun: 5,
        })
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

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawTransactionsRepo.saveBatch).mockResolvedValue(ok({ inserted: 2, skipped: 0 }));
      vi.mocked(mockImportSessionRepo.finalize).mockResolvedValue(ok());
      vi.mocked(mockImportSessionRepo.findById).mockResolvedValue(ok(mockSession));

      const result = await service.importFromSource(account);

      expect(result.isOk()).toBe(true);

      // Verify normalized address was used - create is called with accountId only
      expect(mockImportSessionRepo.create).toHaveBeenCalledWith(1);
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

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(incompleteImportSession));
      vi.mocked(mockImportSessionRepo.update).mockResolvedValue(ok());
      vi.mocked(mockRawTransactionsRepo.saveBatch).mockResolvedValue(ok({ inserted: 2, skipped: 0 }));
      vi.mocked(mockImportSessionRepo.finalize).mockResolvedValue(ok());
      vi.mocked(mockImportSessionRepo.findById).mockResolvedValue(ok(completedSession));

      const result = await service.importFromSource(account);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.transactionsImported).toBe(52); // 50 previous + 2 new = cumulative total
        expect(result.value.id).toBe(42);
      }

      // Should NOT create new import session (resuming existing one)
      expect(mockImportSessionRepo.create).not.toHaveBeenCalled();
      // Should update status back to 'started'
      expect(mockImportSessionRepo.update).toHaveBeenCalledWith(42, { status: 'started' });
      expect(mockImportStreamingFn).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: account.lastCursor,
        })
      );
      expect(mockImportSessionRepo.finalize).toHaveBeenCalledWith(42, 'completed', expect.any(Number), 52, 0);
    });

    it('should complete resumed import when replayed data is skipped as duplicates', async () => {
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
        transactionsSkipped: 3,
      };

      const completedSession: ImportSession = {
        ...incompleteImportSession,
        status: 'completed',
        completedAt: new Date(),
        transactionsImported: 50,
        transactionsSkipped: 5,
      };

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(incompleteImportSession));
      vi.mocked(mockImportSessionRepo.update).mockResolvedValue(ok());
      vi.mocked(mockRawTransactionsRepo.saveBatch).mockResolvedValue(ok({ inserted: 0, skipped: 2 }));
      vi.mocked(mockImportSessionRepo.finalize).mockResolvedValue(ok());
      vi.mocked(mockImportSessionRepo.findById).mockResolvedValue(ok(completedSession));

      const result = await service.importFromSource(account);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.transactionsImported).toBe(50);
        expect(result.value.transactionsSkipped).toBe(5);
      }

      expect(mockImportSessionRepo.create).not.toHaveBeenCalled();
      expect(mockRawTransactionsRepo.saveBatch).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({ transactionHash: 'tx1' }),
          expect.objectContaining({ transactionHash: 'tx2' }),
        ])
      );
      expect(mockImportSessionRepo.finalize).toHaveBeenCalledWith(42, 'completed', expect.any(Number), 50, 5);
    });

    it('should return error for unknown blockchain', async () => {
      const account = createMockAccount('blockchain', 'unknown-chain', 'some-address');

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));

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

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionRepo.create).mockResolvedValue(err(new Error('Database connection failed')));

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database connection failed');
      }
    });

    it('should finalize as failed if saveBatch fails', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawTransactionsRepo.saveBatch).mockResolvedValue(err(new Error('Disk full')));

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Disk full');
      }
    });

    it('should finalize as failed if importer throws error', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockImportSessionRepo.finalize).mockResolvedValue(ok());

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
      expect(mockImportSessionRepo.finalize).toHaveBeenCalledWith(
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

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawTransactionsRepo.saveBatch).mockResolvedValue(ok({ inserted: 2, skipped: 0 }));
      vi.mocked(mockImportSessionRepo.finalize).mockResolvedValue(ok());
      vi.mocked(mockImportSessionRepo.findById).mockResolvedValue(ok(mockSession));
      vi.mocked(mockAccountRepo.updateCursor).mockResolvedValue(ok());

      const result = await service.importFromSource(account);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.transactionsImported).toBe(2);
        expect(result.value.id).toBe(1);
      }

      expect(mockImportSessionRepo.create).toHaveBeenCalledWith(1);
      expect(mockRawTransactionsRepo.saveBatch).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({ refid: 'kraken-1' }),
          expect.objectContaining({ refid: 'kraken-2' }),
        ])
      );
      expect(mockImportSessionRepo.finalize).toHaveBeenCalledWith(
        1,
        'completed',
        expect.any(Number),
        2, // transactionsImported
        0 // transactionsSkipped
      );
    });

    it('should default import.batch deduplicated to zero when provider stats are unavailable', async () => {
      const account = createMockAccount('exchange-api', 'kraken', 'test-api-key', {
        credentials: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
        },
      });

      const mockEventBus = { emit: vi.fn() };
      const registry = createTestRegistry();
      const serviceWithEvents = new StreamingImportRunner(mockDb, mockProviderManager, registry, mockEventBus as never);

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

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawTransactionsRepo.saveBatch).mockResolvedValue(ok({ inserted: 2, skipped: 0 }));
      vi.mocked(mockImportSessionRepo.finalize).mockResolvedValue(ok());
      vi.mocked(mockImportSessionRepo.findById).mockResolvedValue(ok(mockSession));
      vi.mocked(mockAccountRepo.updateCursor).mockResolvedValue(ok());

      const result = await serviceWithEvents.importFromSource(account);

      expect(result.isOk()).toBe(true);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'import.batch',
          sourceName: 'kraken',
          accountId: 1,
          fetched: 2,
          deduplicated: 0,
          totalFetchedRun: 2,
        })
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

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(existingImportSession));
      vi.mocked(mockImportSessionRepo.update).mockResolvedValue(ok());
      vi.mocked(mockRawTransactionsRepo.saveBatch).mockResolvedValue(ok({ inserted: 2, skipped: 0 }));
      vi.mocked(mockImportSessionRepo.finalize).mockResolvedValue(ok());
      vi.mocked(mockImportSessionRepo.findById).mockResolvedValue(ok(completedSession));
      vi.mocked(mockAccountRepo.updateCursor).mockResolvedValue(ok());

      const result = await service.importFromSource(account);

      expect(result.isOk()).toBe(true);

      // Should NOT create new import session
      expect(mockImportSessionRepo.create).not.toHaveBeenCalled();
    });

    it('should return error for unknown exchange', async () => {
      const account = createMockAccount('exchange-api', 'unknown-exchange', 'test-api-key', {
        credentials: {
          apiKey: 'test-key',
          apiSecret: '',
        },
      });

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionRepo.create).mockResolvedValue(ok(1));

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

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(err(new Error('Database unavailable')));

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

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawTransactionsRepo.saveBatch).mockResolvedValue(ok({ inserted: 2, skipped: 0 }));
      vi.mocked(mockImportSessionRepo.update).mockResolvedValue(ok());
      vi.mocked(mockAccountRepo.updateCursor).mockResolvedValue(ok());

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
      expect(mockRawTransactionsRepo.saveBatch).toHaveBeenCalledWith(1, successfulItems);

      // Should update import session as failed
      expect(mockImportSessionRepo.update).toHaveBeenCalledWith(
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

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockImportSessionRepo.update).mockResolvedValue(ok());

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
      expect(mockRawTransactionsRepo.saveBatch).not.toHaveBeenCalled();

      // Should update import session as failed
      expect(mockImportSessionRepo.update).toHaveBeenCalledWith(
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

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawTransactionsRepo.saveBatch).mockResolvedValue(ok({ inserted: 0, skipped: 0 }));
      vi.mocked(mockAccountRepo.updateCursor).mockResolvedValue(ok());
      vi.mocked(mockImportSessionRepo.finalize).mockResolvedValue(ok());

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

      expect(mockImportSessionRepo.finalize).toHaveBeenCalledWith(
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
      const serviceWithEvents = new StreamingImportRunner(mockDb, mockProviderManager, registry, mockEventBus as never);

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

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawTransactionsRepo.countByStreamType).mockResolvedValue(err(new Error('metrics unavailable')));
      vi.mocked(mockRawTransactionsRepo.saveBatch).mockResolvedValue(ok({ inserted: 2, skipped: 0 }));
      vi.mocked(mockImportSessionRepo.finalize).mockResolvedValue(ok());
      vi.mocked(mockImportSessionRepo.findById).mockResolvedValue(ok(mockSession));
      vi.mocked(mockAccountRepo.updateCursor).mockResolvedValue(ok());

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

    it('should complete import and emit a warning when cursor persistence fails mid-import', async () => {
      const account = createMockAccount('exchange-api', 'kraken', 'test-api-key', {
        credentials: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
        },
      });

      const mockEventBus = { emit: vi.fn() };
      const registry = createTestRegistry();
      const serviceWithEvents = new StreamingImportRunner(mockDb, mockProviderManager, registry, mockEventBus as never);

      const completedSession: ImportSession = {
        id: 1,
        accountId: 1,
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
        transactionsImported: 3,
        transactionsSkipped: 0,
        createdAt: new Date(),
      };

      mockExchangeImportStreamingFn.mockImplementationOnce(async function* () {
        yield okAsync({
          rawTransactions: [{ refid: 'kraken-1', type: 'trade' }],
          streamType: 'ledger',
          cursor: {
            primary: { type: 'timestamp', value: 1 },
            lastTransactionId: 'kraken-1',
            totalFetched: 1,
          },
          isComplete: false,
        });

        yield okAsync({
          rawTransactions: [
            { refid: 'kraken-2', type: 'deposit' },
            { refid: 'kraken-3', type: 'withdrawal' },
          ],
          streamType: 'ledger',
          cursor: {
            primary: { type: 'timestamp', value: 3 },
            lastTransactionId: 'kraken-3',
            totalFetched: 3,
          },
          isComplete: true,
        });
      });

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionRepo.create).mockResolvedValue(ok(1));
      vi.mocked(mockRawTransactionsRepo.saveBatch)
        .mockResolvedValueOnce(ok({ inserted: 1, skipped: 0 }))
        .mockResolvedValueOnce(ok({ inserted: 2, skipped: 0 }));
      vi.mocked(mockAccountRepo.updateCursor)
        .mockResolvedValueOnce(err(new Error('cursor table locked')))
        .mockResolvedValueOnce(ok());
      vi.mocked(mockImportSessionRepo.finalize).mockResolvedValue(ok());
      vi.mocked(mockImportSessionRepo.findById).mockResolvedValue(ok(completedSession));

      const result = await serviceWithEvents.importFromSource(account);

      expect(result.isOk()).toBe(true);
      expect(mockImportSessionRepo.finalize).toHaveBeenCalledWith(1, 'completed', expect.any(Number), 3, 0);
      expect(mockImportSessionRepo.update).not.toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          status: 'failed',
        })
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'import.warning',
          sourceName: 'kraken',
          accountId: 1,
          streamType: 'ledger',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- acceptable for tests
          warning: expect.stringContaining('Failed to update cursor'),
        })
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 1,
          streamType: 'ledger',
          error: expect.any(Error) as unknown,
        }),
        'Failed to update cursor after saving batch; continuing import with dedup protection on resume'
      );
    });
  });

  describe('importFromSource - blockchain - additional error cases', () => {
    it('should handle importer returning err() instead of throwing', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(ok(undefined));
      vi.mocked(mockImportSessionRepo.create).mockResolvedValue(ok(1));

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
      expect(mockRawTransactionsRepo.saveBatch).not.toHaveBeenCalled();
    });

    it('should handle errors when checking for incomplete import session', async () => {
      const account = createMockAccount('blockchain', 'bitcoin', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

      vi.mocked(mockImportSessionRepo.findLatestIncomplete).mockResolvedValue(
        err(new Error('Database corruption detected'))
      );

      const result = await service.importFromSource(account);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database corruption detected');
      }

      // Should NOT attempt to create new import session
      expect(mockImportSessionRepo.create).not.toHaveBeenCalled();
    });
  });
});
