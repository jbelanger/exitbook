import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { Account, AccountType, CursorState, ExchangeCredentials, ImportSession } from '@exitbook/core';
import { ok } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import { AdapterRegistry } from '@exitbook/ingestion';
import { vi } from 'vitest';

import type { EventSink } from '../../pipeline/pipeline-context.js';

// ---------------------------------------------------------------------------
// Account factory
// ---------------------------------------------------------------------------

export function createMockAccount(
  accountType: AccountType,
  sourceName: string,
  identifier: string,
  options?: {
    credentials?: ExchangeCredentials | undefined;
    id?: number | undefined;
    lastCursor?: Record<string, CursorState> | null | undefined;
    metadata?: Record<string, unknown> | undefined;
    parentAccountId?: number | undefined;
    providerName?: string | undefined;
  }
): Account {
  return {
    id: options?.id ?? 1,
    userId: 1,
    accountType,
    sourceName,
    identifier,
    providerName: options?.providerName,
    credentials: options?.credentials,
    lastCursor: options?.lastCursor ?? undefined,
    parentAccountId: options?.parentAccountId,
    metadata: options?.metadata as Account['metadata'],
    createdAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Session factory
// ---------------------------------------------------------------------------

export function createMockSession(overrides: Partial<ImportSession> = {}): ImportSession {
  return {
    id: 1,
    accountId: 1,
    status: 'completed',
    startedAt: new Date(),
    completedAt: new Date(),
    transactionsImported: 2,
    transactionsSkipped: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Streaming mock helpers
// ---------------------------------------------------------------------------

export function createBlockchainStreamingMock() {
  return vi.fn().mockImplementation(async function* () {
    yield ok({
      rawTransactions: [
        { transactionHash: 'tx1', blockHeight: 100 },
        { transactionHash: 'tx2', blockHeight: 101 },
      ],
      streamType: 'normal',
      cursor: { primary: { type: 'blockNumber', value: 2 }, lastTransactionId: 'tx2', totalFetched: 2 },
      isComplete: true,
    });
  });
}

export function createExchangeStreamingMock() {
  return vi.fn().mockImplementation(async function* () {
    yield ok({
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
}

// ---------------------------------------------------------------------------
// Registry factory
// ---------------------------------------------------------------------------

interface DerivedAddressMock {
  address: string;
  derivationPath: string;
}
type DeriveAddressesFn = (
  xpub: string,
  providerManager: BlockchainProviderManager,
  blockchain: string,
  gap?: number
) => Promise<DerivedAddressMock[]>;

export function createDeriveAddressesMock() {
  const inner = vi.fn<DeriveAddressesFn>();
  const wrapper = vi.fn(async (...args: Parameters<DeriveAddressesFn>) => {
    const result = await inner(...args);
    return ok(result);
  });
  return { mockDeriveAddresses: inner, mockDeriveAddressesResult: wrapper };
}

export function createTestRegistry(options?: {
  blockchainStreamingFn?: ReturnType<typeof vi.fn>;
  deriveAddressesResult?: ReturnType<typeof vi.fn>;
  exchangeStreamingFn?: ReturnType<typeof vi.fn>;
}) {
  const blockchainStreamingFn = options?.blockchainStreamingFn ?? createBlockchainStreamingMock();
  const exchangeStreamingFn = options?.exchangeStreamingFn ?? createExchangeStreamingMock();

  return new AdapterRegistry(
    [
      {
        blockchain: 'bitcoin',
        chainModel: 'utxo' as const,
        normalizeAddress: (addr: string) => ok(addr.toLowerCase()),
        isExtendedPublicKey: (addr: string) => addr.startsWith('xpub') || addr.startsWith('ypub'),
        deriveAddressesFromXpub: (options?.deriveAddressesResult ?? vi.fn()) as never,
        createImporter: () => ({ importStreaming: blockchainStreamingFn }) as never,
        createProcessor: vi.fn() as never,
      },
      {
        blockchain: 'cardano',
        chainModel: 'utxo' as const,
        normalizeAddress: (addr: string) => ok(addr),
        isExtendedPublicKey: (addr: string) =>
          addr.startsWith('stake') || addr.startsWith('xpub') || addr.startsWith('addr_xvk'),
        deriveAddressesFromXpub: (options?.deriveAddressesResult ?? vi.fn()) as never,
        createImporter: () => ({ importStreaming: blockchainStreamingFn }) as never,
        createProcessor: vi.fn() as never,
      },
      {
        blockchain: 'ethereum',
        chainModel: 'account-based' as const,
        normalizeAddress: (addr: string) => ok(addr.toLowerCase()),
        createImporter: () => ({ importStreaming: blockchainStreamingFn }) as never,
        createProcessor: vi.fn() as never,
      },
    ],
    [
      {
        capabilities: { supportsApi: true, supportsCsv: false },
        exchange: 'kraken',
        createImporter: () => ({ importStreaming: exchangeStreamingFn }) as never,
        createProcessor: vi.fn() as never,
      },
    ]
  );
}

// ---------------------------------------------------------------------------
// DataContext mock
// ---------------------------------------------------------------------------

export function createMockDataContext() {
  const mockRawTransactionsRepo = {
    createBatch: vi.fn().mockResolvedValue(ok({ inserted: 2, skipped: 0 })),
    countByStreamType: vi.fn().mockResolvedValue(ok(new Map())),
  };

  const mockImportSessionRepo = {
    create: vi.fn().mockResolvedValue(ok(1)),
    finalize: vi.fn().mockResolvedValue(ok(undefined)),
    findById: vi.fn(),
    findLatestIncomplete: vi.fn().mockResolvedValue(ok(undefined)),
    update: vi.fn().mockResolvedValue(ok(undefined)),
  };

  const mockAccountRepo = {
    findOrCreate: vi.fn(),
    findAll: vi.fn().mockResolvedValue(ok([])),
    update: vi.fn().mockResolvedValue(ok(undefined)),
    updateCursor: vi.fn().mockResolvedValue(ok(undefined)),
  };

  const mockUserRepo = {
    findOrCreateDefault: vi.fn().mockResolvedValue(ok({ id: 1, createdAt: new Date() })),
  };

  const mockDb = {
    users: mockUserRepo,
    accounts: mockAccountRepo,
    rawTransactions: mockRawTransactionsRepo,
    importSessions: mockImportSessionRepo,
    executeInTransaction: vi
      .fn()
      .mockImplementation((fn: (tx: DataContext) => Promise<unknown>) => fn(mockDb as unknown as DataContext)),
  } as unknown as DataContext;

  return {
    db: mockDb,
    users: mockUserRepo,
    accounts: mockAccountRepo,
    rawTransactions: mockRawTransactionsRepo,
    importSessions: mockImportSessionRepo,
  };
}

// ---------------------------------------------------------------------------
// Event sink mock
// ---------------------------------------------------------------------------

export function createMockEventSink(): EventSink & { emit: ReturnType<typeof vi.fn> } {
  return { emit: vi.fn() as EventSink['emit'] & ReturnType<typeof vi.fn> };
}

// ---------------------------------------------------------------------------
// Provider manager mock
// ---------------------------------------------------------------------------

export function createMockProviderManager(): BlockchainProviderManager {
  return {} as BlockchainProviderManager;
}
