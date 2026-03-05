import type {
  BlockchainProviderManager,
  FailoverExecutionResult,
  RawBalanceData,
} from '@exitbook/blockchain-providers';
import type { Account, Currency, ImportSession, UniversalTransactionData, VerificationMetadata } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BalanceOperation } from '../balance-operation.js';

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    accountType: 'blockchain',
    sourceName: 'bitcoin',
    identifier: 'bc1-parent',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createCompletedImportSession(accountId = 1): ImportSession {
  return {
    id: 1,
    accountId,
    status: 'completed',
    startedAt: new Date('2026-02-20T00:00:00.000Z'),
    completedAt: new Date('2026-02-20T00:10:00.000Z'),
    transactionsImported: 1,
    transactionsSkipped: 0,
    createdAt: new Date('2026-02-20T00:00:00.000Z'),
  };
}

function createTransaction(overrides: Partial<UniversalTransactionData>): UniversalTransactionData {
  return {
    id: 100,
    accountId: 1,
    source: 'bitcoin',
    sourceType: 'blockchain',
    externalId: 'tx-1',
    status: 'success',
    datetime: '2026-02-20T00:00:00.000Z',
    timestamp: Date.parse('2026-02-20T00:00:00.000Z'),
    operation: { category: 'transfer', type: 'transfer' },
    movements: {
      inflows: [],
      outflows: [],
    },
    fees: [],
    ...overrides,
  };
}

function createProviderManager(
  providers: { capabilities: { supportedOperations: string[]; supportedTransactionTypes?: string[] | undefined } }[],
  nativeData: RawBalanceData
): BlockchainProviderManager {
  const nativeResult: FailoverExecutionResult<RawBalanceData> = {
    data: nativeData,
    providerName: 'mock-provider',
  };

  return {
    autoRegisterFromConfig: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    getProviders: vi.fn().mockReturnValue(providers),
    getAddressBalances: vi.fn().mockResolvedValue(ok(nativeResult)),
    getAddressTokenBalances: vi.fn(),
  } as unknown as BlockchainProviderManager;
}

function createDbMock(params: {
  account: Account;
  excludedTransactions: UniversalTransactionData[];
  normalTransactions: UniversalTransactionData[];
  sessions: ImportSession[];
}): {
  accountsUpdate: ReturnType<
    typeof vi.fn<
      (
        accountId: number,
        update: { lastBalanceCheckAt: Date; verificationMetadata: VerificationMetadata }
      ) => Promise<Result<void, Error>>
    >
  >;
  db: DataContext;
} {
  const accountsUpdate = vi
    .fn<
      (
        accountId: number,
        update: { lastBalanceCheckAt: Date; verificationMetadata: VerificationMetadata }
      ) => Promise<Result<void, Error>>
    >()
    .mockResolvedValue(ok(undefined));
  const db = {
    accounts: {
      findById: vi.fn().mockResolvedValue(ok(params.account)),
      findAll: vi.fn().mockResolvedValue(ok([])),
      update: accountsUpdate,
    },
    importSessions: {
      findAll: vi.fn().mockResolvedValue(ok(params.sessions)),
    },
    transactions: {
      findAll: vi
        .fn()
        .mockImplementation(
          (query: { includeExcluded?: boolean | undefined }): Result<UniversalTransactionData[], Error> => {
            if (query.includeExcluded) {
              return ok(params.excludedTransactions);
            }
            return ok(params.normalTransactions);
          }
        ),
    },
  } as unknown as DataContext;

  return { accountsUpdate, db };
}

describe('BalanceOperation', () => {
  it('adjusts live balances using excluded amounts and persists verification metadata', async () => {
    const account = createAccount();

    const normalTransactions = [
      createTransaction({
        externalId: 'tx-normal',
        movements: {
          inflows: [
            {
              assetId: 'blockchain:bitcoin:native',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('1.0'),
              netAmount: parseDecimal('1.0'),
            },
          ],
          outflows: [],
        },
      }),
    ];

    const excludedTransactions = [
      createTransaction({
        externalId: 'tx-excluded',
        excludedFromAccounting: true,
        movements: {
          inflows: [
            {
              assetId: 'blockchain:bitcoin:native',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('0.1'),
              netAmount: parseDecimal('0.1'),
            },
          ],
          outflows: [],
        },
      }),
    ];

    const { accountsUpdate, db } = createDbMock({
      account,
      sessions: [createCompletedImportSession(account.id)],
      normalTransactions,
      excludedTransactions,
    });

    const providerManager = createProviderManager([{ capabilities: { supportedOperations: ['getAddressBalances'] } }], {
      rawAmount: '110000000',
      decimalAmount: '1.1',
      symbol: 'BTC',
      decimals: 8,
    });

    const operation = new BalanceOperation(db, providerManager);
    const result = await operation.verifyBalance({ accountId: account.id });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.status).toBe('success');
      expect(result.value.summary.mismatches).toBe(0);
      expect(result.value.comparisons).toHaveLength(1);
      expect(result.value.comparisons[0]?.difference).toBe('0');
    }

    expect(accountsUpdate).toHaveBeenCalledTimes(1);
    const call = accountsUpdate.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) {
      throw new Error('Expected accounts.update call to be recorded');
    }
    const updateArg = call[1];
    expect(updateArg.verificationMetadata.current_balance).toEqual({
      'blockchain:bitcoin:native': '1',
    });
    expect(updateArg.verificationMetadata.last_verification?.status).toBe('match');
    expect(updateArg.verificationMetadata.last_verification?.live_balance).toEqual({
      'blockchain:bitcoin:native': '1',
    });
    expect(updateArg.verificationMetadata.last_verification?.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(updateArg.lastBalanceCheckAt).toBeInstanceOf(Date);
  });

  it('adds warning when token transactions are supported but token balances are unavailable', async () => {
    const account = createAccount();

    const normalTransactions = [
      createTransaction({
        movements: {
          inflows: [
            {
              assetId: 'blockchain:bitcoin:native',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('1.0'),
              netAmount: parseDecimal('1.0'),
            },
          ],
          outflows: [],
        },
      }),
    ];

    const { db } = createDbMock({
      account,
      sessions: [createCompletedImportSession(account.id)],
      normalTransactions,
      excludedTransactions: [],
    });

    const providerManager = createProviderManager(
      [
        {
          capabilities: {
            supportedOperations: ['getAddressBalances', 'getAddressTransactions'],
            supportedTransactionTypes: ['token'],
          },
        },
      ],
      {
        rawAmount: '100000000',
        decimalAmount: '1.0',
        symbol: 'BTC',
        decimals: 8,
      }
    );

    const operation = new BalanceOperation(db, providerManager);
    const result = await operation.verifyBalance({ accountId: account.id });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.status).toBe('warning');
      expect(result.value.warnings).toContain(
        'Token balances are not available for bitcoin. Live balance includes native assets only; token mismatches may be false negatives.'
      );
    }
  });

  it('returns an error when account does not exist', async () => {
    const db = {
      accounts: {
        findById: vi.fn().mockResolvedValue(ok(undefined)),
      },
    } as unknown as DataContext;

    const providerManager = {
      destroy: vi.fn().mockResolvedValue(undefined),
    } as unknown as BlockchainProviderManager;

    const operation = new BalanceOperation(db, providerManager);
    const result = await operation.verifyBalance({ accountId: 999 });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('No account found with ID 999');
    }
  });

  it('returns provider errors from live balance fetch', async () => {
    const account = createAccount();

    const { db } = createDbMock({
      account,
      sessions: [createCompletedImportSession(account.id)],
      normalTransactions: [],
      excludedTransactions: [],
    });

    const providerManager = {
      autoRegisterFromConfig: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
      getProviders: vi.fn().mockReturnValue([{ capabilities: { supportedOperations: ['getAddressBalances'] } }]),
      getAddressBalances: vi.fn().mockResolvedValue(err(new Error('RPC down'))),
    } as unknown as BlockchainProviderManager;

    const operation = new BalanceOperation(db, providerManager);
    const result = await operation.verifyBalance({ accountId: account.id });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('RPC down');
    }
  });
});
