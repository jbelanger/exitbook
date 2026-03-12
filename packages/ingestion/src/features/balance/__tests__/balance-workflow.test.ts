import type {
  BlockchainProviderManager,
  FailoverExecutionResult,
  RawBalanceData,
} from '@exitbook/blockchain-providers';
import type {
  Account,
  BalanceSnapshot,
  BalanceSnapshotAsset,
  Currency,
  ImportSession,
  UniversalTransactionData,
} from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { describe, expect, it, vi } from 'vitest';

import type { BalancePorts } from '../../../ports/balance-ports.js';
import { BalanceWorkflow } from '../balance-workflow.js';

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

function createPortsMock(params: {
  account: Account;
  excludedTransactions: UniversalTransactionData[];
  normalTransactions: UniversalTransactionData[];
  sessions: ImportSession[];
}): {
  ports: BalancePorts;
  replaceSnapshot: ReturnType<
    typeof vi.fn<
      (params: { assets: BalanceSnapshotAsset[]; snapshot: BalanceSnapshot }) => Promise<Result<void, Error>>
    >
  >;
} {
  const replaceSnapshot = vi
    .fn<(params: { assets: BalanceSnapshotAsset[]; snapshot: BalanceSnapshot }) => Promise<Result<void, Error>>>()
    .mockResolvedValue(ok(undefined));

  const ports: BalancePorts = {
    accountLookup: {
      findById: vi.fn().mockResolvedValue(ok(params.account)),
      findChildAccounts: vi.fn().mockResolvedValue(ok([])),
    },
    snapshotStore: {
      replaceSnapshot,
    },
    importSessionLookup: {
      findByAccountIds: vi.fn().mockResolvedValue(ok(params.sessions)),
    },
    transactionSource: {
      findByAccountIds: vi
        .fn()
        .mockImplementation(
          (query: { includeExcluded?: boolean | undefined }): Result<UniversalTransactionData[], Error> => {
            if (query.includeExcluded) {
              return ok([...params.normalTransactions, ...params.excludedTransactions]);
            }
            return ok(params.normalTransactions);
          }
        ),
    },
  };

  return { replaceSnapshot, ports };
}

describe('BalanceWorkflow', () => {
  it('adjusts live balances using excluded amounts and persists a balance snapshot', async () => {
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

    const { replaceSnapshot, ports } = createPortsMock({
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

    const workflow = new BalanceWorkflow(ports, providerManager);
    const result = await workflow.verifyBalance({ accountId: account.id });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.status).toBe('success');
      expect(result.value.summary.mismatches).toBe(0);
      expect(result.value.comparisons).toHaveLength(1);
      expect(result.value.comparisons[0]?.difference).toBe('0');
    }

    expect(replaceSnapshot).toHaveBeenCalledTimes(1);
    const call = replaceSnapshot.mock.calls[0]?.[0];
    expect(call?.snapshot).toMatchObject({
      scopeAccountId: 1,
      verificationStatus: 'match',
      matchCount: 1,
      warningCount: 0,
      mismatchCount: 0,
      coverageStatus: 'complete',
      coverageConfidence: 'high',
    });
    expect(call?.assets).toEqual([
      {
        scopeAccountId: 1,
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC',
        calculatedBalance: '1',
        liveBalance: '1',
        difference: '0',
        comparisonStatus: 'match',
        excludedFromAccounting: false,
      },
    ]);
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

    const { ports } = createPortsMock({
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

    const workflow = new BalanceWorkflow(ports, providerManager);
    const result = await workflow.verifyBalance({ accountId: account.id });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.status).toBe('warning');
      expect(result.value.warnings).toContain(
        'Token balances are not available for bitcoin. Live balance includes native assets only; token mismatches may be false negatives.'
      );
    }
  });

  it('returns an error when account does not exist', async () => {
    const ports: BalancePorts = {
      accountLookup: {
        findById: vi.fn().mockResolvedValue(ok(undefined)),
        findChildAccounts: vi.fn(),
      },
      snapshotStore: { replaceSnapshot: vi.fn() },
      importSessionLookup: { findByAccountIds: vi.fn() },
      transactionSource: { findByAccountIds: vi.fn() },
    };

    const providerManager = {
      destroy: vi.fn().mockResolvedValue(undefined),
    } as unknown as BlockchainProviderManager;

    const workflow = new BalanceWorkflow(ports, providerManager);
    const result = await workflow.verifyBalance({ accountId: 999 });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('No account found with ID 999');
    }
  });

  it('returns provider errors from live balance fetch', async () => {
    const account = createAccount();

    const { ports } = createPortsMock({
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

    const workflow = new BalanceWorkflow(ports, providerManager);
    const result = await workflow.verifyBalance({ accountId: account.id });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('RPC down');
    }
  });

  it('fails when snapshot persistence fails', async () => {
    const account = createAccount();

    const { ports, replaceSnapshot } = createPortsMock({
      account,
      sessions: [createCompletedImportSession(account.id)],
      normalTransactions: [],
      excludedTransactions: [],
    });

    replaceSnapshot.mockResolvedValueOnce(err(new Error('write failed')));

    const providerManager = createProviderManager([{ capabilities: { supportedOperations: ['getAddressBalances'] } }], {
      rawAmount: '0',
      decimalAmount: '0',
      symbol: 'BTC',
      decimals: 8,
    });

    const workflow = new BalanceWorkflow(ports, providerManager);
    const result = await workflow.verifyBalance({ accountId: account.id });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('write failed');
    }
  });
});
