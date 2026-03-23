import {
  type IBlockchainProviderRuntime,
  type FailoverExecutionResult,
  type RawBalanceData,
} from '@exitbook/blockchain-providers';
import type {
  Account,
  BalanceSnapshot,
  BalanceSnapshotAsset,
  ImportSession,
  Transaction,
  TransactionDraft,
} from '@exitbook/core';
import { buildAssetMovementCanonicalMaterial, buildFeeMovementCanonicalMaterial } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { parseDecimal, sha256Hex } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

import type { BalancePorts } from '../../../ports/balance-ports.js';
import { BalanceWorkflow } from '../balance-workflow.js';

function materializeMovementFingerprint(
  txFingerprint: string,
  canonicalMaterial: string,
  duplicateOccurrence: number
): string {
  return `movement:${sha256Hex(`${txFingerprint}|${canonicalMaterial}`)}:${duplicateOccurrence}`;
}

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

function createTransaction(
  overrides: Omit<Partial<Transaction>, 'movements' | 'fees'> & {
    fees?: TransactionDraft['fees'];
    movements?: TransactionDraft['movements'];
  }
): Transaction {
  const { fees: overrideFees, movements: overrideMovements, txFingerprint: overrideTxFingerprint, ...rest } = overrides;
  const txFingerprint = String(overrideTxFingerprint ?? 'tx-1');
  const inflowDuplicateCounts = new Map<string, number>();
  const outflowDuplicateCounts = new Map<string, number>();
  const feeDuplicateCounts = new Map<string, number>();
  const inflows = (overrideMovements?.inflows ?? []).map((movement) => {
    const canonicalMaterial = buildAssetMovementCanonicalMaterial({
      movementType: 'inflow',
      assetId: movement.assetId,
      grossAmount: movement.grossAmount,
      netAmount: movement.netAmount,
    });
    const duplicateOccurrence = (inflowDuplicateCounts.get(canonicalMaterial) ?? 0) + 1;
    inflowDuplicateCounts.set(canonicalMaterial, duplicateOccurrence);

    return {
      ...movement,
      movementFingerprint:
        'movementFingerprint' in movement && typeof movement.movementFingerprint === 'string'
          ? movement.movementFingerprint
          : materializeMovementFingerprint(txFingerprint, canonicalMaterial, duplicateOccurrence),
    };
  });
  const outflows = (overrideMovements?.outflows ?? []).map((movement) => {
    const canonicalMaterial = buildAssetMovementCanonicalMaterial({
      movementType: 'outflow',
      assetId: movement.assetId,
      grossAmount: movement.grossAmount,
      netAmount: movement.netAmount,
    });
    const duplicateOccurrence = (outflowDuplicateCounts.get(canonicalMaterial) ?? 0) + 1;
    outflowDuplicateCounts.set(canonicalMaterial, duplicateOccurrence);

    return {
      ...movement,
      movementFingerprint:
        'movementFingerprint' in movement && typeof movement.movementFingerprint === 'string'
          ? movement.movementFingerprint
          : materializeMovementFingerprint(txFingerprint, canonicalMaterial, duplicateOccurrence),
    };
  });
  const fees = (overrideFees ?? []).map((fee) => {
    const canonicalMaterial = buildFeeMovementCanonicalMaterial({
      assetId: fee.assetId,
      amount: fee.amount,
      scope: fee.scope,
      settlement: fee.settlement,
    });
    const duplicateOccurrence = (feeDuplicateCounts.get(canonicalMaterial) ?? 0) + 1;
    feeDuplicateCounts.set(canonicalMaterial, duplicateOccurrence);

    return {
      ...fee,
      movementFingerprint:
        'movementFingerprint' in fee && typeof fee.movementFingerprint === 'string'
          ? fee.movementFingerprint
          : materializeMovementFingerprint(txFingerprint, canonicalMaterial, duplicateOccurrence),
    };
  });

  return {
    id: 100,
    accountId: 1,
    source: 'bitcoin',
    sourceType: 'blockchain',
    txFingerprint,
    status: 'success',
    datetime: '2026-02-20T00:00:00.000Z',
    timestamp: Date.parse('2026-02-20T00:00:00.000Z'),
    operation: { category: 'transfer', type: 'transfer' },
    movements: {
      inflows,
      outflows,
    },
    fees,
    ...rest,
  };
}

function createProviderManager(
  providers: { capabilities: { supportedOperations: string[]; supportedTransactionTypes?: string[] | undefined } }[],
  nativeData: RawBalanceData
): IBlockchainProviderRuntime {
  const nativeResult: FailoverExecutionResult<RawBalanceData> = {
    data: nativeData,
    providerName: 'mock-provider',
  };

  return {
    destroy: vi.fn().mockResolvedValue(undefined),
    hasRegisteredOperationSupport: vi.fn((_: string, operation: string) =>
      providers.some((provider) => provider.capabilities.supportedOperations.includes(operation))
    ),
    getProviders: vi.fn().mockReturnValue(providers),
    getAddressBalances: vi.fn().mockResolvedValue(ok(nativeResult)),
    getAddressTokenBalances: vi.fn(),
  } as unknown as IBlockchainProviderRuntime;
}

function createPortsMock(params: {
  accounts: Account[];
  excludedTransactions: Transaction[];
  normalTransactions: Transaction[];
  sessions: ImportSession[];
}): {
  findById: ReturnType<typeof vi.fn<(accountId: number) => Promise<Result<Account | undefined, Error>>>>;
  findChildAccounts: ReturnType<typeof vi.fn<(parentAccountId: number) => Promise<Result<Account[], Error>>>>;
  markBuilding: ReturnType<typeof vi.fn<(scopeAccountId: number) => Promise<Result<void, Error>>>>;
  markFailed: ReturnType<typeof vi.fn<(scopeAccountId: number) => Promise<Result<void, Error>>>>;
  markFresh: ReturnType<typeof vi.fn<(scopeAccountId: number) => Promise<Result<void, Error>>>>;
  ports: BalancePorts;
  replaceSnapshot: ReturnType<
    typeof vi.fn<
      (params: { assets: BalanceSnapshotAsset[]; snapshot: BalanceSnapshot }) => Promise<Result<void, Error>>
    >
  >;
} {
  const accountsById = new Map(params.accounts.map((account) => [account.id, account]));
  const replaceSnapshot = vi
    .fn<(params: { assets: BalanceSnapshotAsset[]; snapshot: BalanceSnapshot }) => Promise<Result<void, Error>>>()
    .mockResolvedValue(ok(undefined));
  const markBuilding = vi
    .fn<(scopeAccountId: number) => Promise<Result<void, Error>>>()
    .mockResolvedValue(ok(undefined));
  const markFresh = vi.fn<(scopeAccountId: number) => Promise<Result<void, Error>>>().mockResolvedValue(ok(undefined));
  const markFailed = vi.fn<(scopeAccountId: number) => Promise<Result<void, Error>>>().mockResolvedValue(ok(undefined));
  const findById = vi
    .fn<(accountId: number) => Promise<Result<Account | undefined, Error>>>()
    .mockImplementation(async (accountId) => ok(accountsById.get(accountId)));
  const findChildAccounts = vi
    .fn<(parentAccountId: number) => Promise<Result<Account[], Error>>>()
    .mockImplementation(async (parentAccountId) =>
      ok(params.accounts.filter((account) => account.parentAccountId === parentAccountId))
    );

  const ports: BalancePorts = {
    accountLookup: {
      findById,
      findChildAccounts,
    },
    snapshotStore: {
      replaceSnapshot,
    },
    projectionState: {
      markBuilding,
      markFresh,
      markFailed,
    },
    importSessionLookup: {
      findByAccountIds: vi
        .fn()
        .mockImplementation((accountIds: number[]) =>
          ok(params.sessions.filter((session) => accountIds.includes(session.accountId)))
        ),
    },
    transactionSource: {
      findByAccountIds: vi
        .fn()
        .mockImplementation(
          (query: { accountIds: number[]; includeExcluded?: boolean | undefined }): Result<Transaction[], Error> => {
            const normalTransactions = params.normalTransactions.filter((tx) =>
              query.accountIds.includes(tx.accountId)
            );
            const excludedTransactions = params.excludedTransactions.filter((tx) =>
              query.accountIds.includes(tx.accountId)
            );
            if (query.includeExcluded) {
              return ok([...normalTransactions, ...excludedTransactions]);
            }
            return ok(normalTransactions);
          }
        ),
    },
  };

  return { findById, findChildAccounts, markBuilding, markFailed, markFresh, replaceSnapshot, ports };
}

describe('BalanceWorkflow', () => {
  it('rebuilds the calculated snapshot before persisting the verified snapshot', async () => {
    const account = createAccount();

    const normalTransactions = [
      createTransaction({
        txFingerprint: 'tx-normal',
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
        txFingerprint: 'tx-excluded',
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

    const { markBuilding, markFailed, markFresh, replaceSnapshot, ports } = createPortsMock({
      accounts: [account],
      sessions: [createCompletedImportSession(account.id)],
      normalTransactions,
      excludedTransactions,
    });

    const providerRuntime = createProviderManager([{ capabilities: { supportedOperations: ['getAddressBalances'] } }], {
      rawAmount: '110000000',
      decimalAmount: '1.1',
      symbol: 'BTC',
      decimals: 8,
    });

    const workflow = new BalanceWorkflow(ports, providerRuntime);
    const result = await workflow.refreshVerification({ accountId: account.id });

    if (result.isErr()) {
      throw result.error;
    }
    expect(result.isOk()).toBe(true);
    expect(result.value.status).toBe('success');
    expect(result.value.summary.mismatches).toBe(0);
    expect(result.value.comparisons).toHaveLength(1);
    expect(result.value.comparisons[0]?.difference).toBe('0');

    expect(markBuilding).toHaveBeenCalledWith(1);
    expect(markFresh).toHaveBeenCalledWith(1);
    expect(markFailed).not.toHaveBeenCalled();

    expect(replaceSnapshot).toHaveBeenCalledTimes(2);

    const calculatedCall = replaceSnapshot.mock.calls[0]?.[0];
    expect(calculatedCall?.snapshot).toMatchObject({
      scopeAccountId: 1,
      verificationStatus: 'never-run',
      matchCount: 0,
      warningCount: 0,
      mismatchCount: 0,
    });
    expect(calculatedCall?.assets).toEqual([
      {
        scopeAccountId: 1,
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC',
        calculatedBalance: '1',
        excludedFromAccounting: false,
      },
    ]);

    const verifiedCall = replaceSnapshot.mock.calls[1]?.[0];
    expect(verifiedCall?.snapshot).toMatchObject({
      scopeAccountId: 1,
      verificationStatus: 'match',
      matchCount: 1,
      warningCount: 0,
      mismatchCount: 0,
      coverageStatus: 'complete',
      coverageConfidence: 'high',
    });
    expect(verifiedCall?.assets).toEqual([
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

  it('rebuilds a calculated-only snapshot without live provider calls', async () => {
    const account = createAccount();
    const normalTransactions = [
      createTransaction({
        movements: {
          inflows: [
            {
              assetId: 'blockchain:bitcoin:native',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('2.5'),
              netAmount: parseDecimal('2.5'),
            },
          ],
          outflows: [],
        },
      }),
    ];

    const { markBuilding, markFailed, markFresh, replaceSnapshot, ports } = createPortsMock({
      accounts: [account],
      sessions: [createCompletedImportSession(account.id)],
      normalTransactions,
      excludedTransactions: [],
    });

    const providerRuntime = createProviderManager([{ capabilities: { supportedOperations: ['getAddressBalances'] } }], {
      rawAmount: '250000000',
      decimalAmount: '2.5',
      symbol: 'BTC',
      decimals: 8,
    });

    const workflow = new BalanceWorkflow(ports, providerRuntime);
    const result = await workflow.rebuildCalculatedSnapshot({ accountId: account.id });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.scopeAccount.id).toBe(account.id);
      expect(result.value.assetCount).toBe(1);
    }

    expect(markBuilding).toHaveBeenCalledWith(1);
    expect(markFresh).toHaveBeenCalledWith(1);
    expect(markFailed).not.toHaveBeenCalled();
    expect(replaceSnapshot).toHaveBeenCalledTimes(1);
    expect(replaceSnapshot.mock.calls[0]?.[0]).toMatchObject({
      snapshot: {
        scopeAccountId: 1,
        verificationStatus: 'never-run',
      },
      assets: [
        {
          scopeAccountId: 1,
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          calculatedBalance: '2.5',
          excludedFromAccounting: false,
        },
      ],
    });
  });

  it('falls back to a calculated-only unavailable snapshot when no provider supports live balances', async () => {
    const account = createAccount({ sourceName: 'lukso', identifier: '0xlukso' });
    const normalTransactions = [
      createTransaction({
        movements: {
          inflows: [
            {
              assetId: 'blockchain:lukso:native',
              assetSymbol: 'LYX' as Currency,
              grossAmount: parseDecimal('12.5'),
              netAmount: parseDecimal('12.5'),
            },
          ],
          outflows: [],
        },
      }),
    ];

    const { markBuilding, markFailed, markFresh, replaceSnapshot, ports } = createPortsMock({
      accounts: [account],
      sessions: [createCompletedImportSession(account.id)],
      normalTransactions,
      excludedTransactions: [],
    });

    const providerRuntime = createProviderManager(
      [{ capabilities: { supportedOperations: ['getAddressTransactions'] } }],
      {
        rawAmount: '0',
        decimalAmount: '0',
        symbol: 'LYX',
        decimals: 18,
      }
    );

    const workflow = new BalanceWorkflow(ports, providerRuntime);
    const result = await workflow.refreshVerification({ accountId: account.id });

    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.mode).toBe('calculated-only');
    expect(result.value.status).toBe('warning');
    expect(result.value.warnings).toEqual([
      'Live balance verification is unavailable for lukso: no registered provider supports getAddressBalances. Stored calculated balances only.',
    ]);
    expect(markBuilding).toHaveBeenCalledWith(1);
    expect(markFresh).toHaveBeenCalledWith(1);
    expect(markFailed).not.toHaveBeenCalled();
    expect(replaceSnapshot).toHaveBeenCalledTimes(2);

    const unavailableCall = replaceSnapshot.mock.calls[1]?.[0];
    expect(unavailableCall?.snapshot).toMatchObject({
      scopeAccountId: 1,
      verificationStatus: 'unavailable',
      coverageStatus: 'partial',
      coverageConfidence: 'low',
      statusReason:
        'Live balance verification is unavailable for lukso: no registered provider supports getAddressBalances. Stored calculated balances only.',
    });
    expect(unavailableCall?.assets).toEqual([
      {
        scopeAccountId: 1,
        assetId: 'blockchain:lukso:native',
        assetSymbol: 'LYX',
        calculatedBalance: '12.5',
        comparisonStatus: 'unavailable',
        excludedFromAccounting: false,
      },
    ]);
  });

  it('fails when a registered balance provider cannot be initialized', async () => {
    const account = createAccount({ sourceName: 'lukso', identifier: '0xlukso' });
    const normalTransactions = [
      createTransaction({
        movements: {
          inflows: [
            {
              assetId: 'blockchain:lukso:native',
              assetSymbol: 'LYX' as Currency,
              grossAmount: parseDecimal('12.5'),
              netAmount: parseDecimal('12.5'),
            },
          ],
          outflows: [],
        },
      }),
    ];

    const { markBuilding, markFailed, markFresh, replaceSnapshot, ports } = createPortsMock({
      accounts: [account],
      sessions: [createCompletedImportSession(account.id)],
      normalTransactions,
      excludedTransactions: [],
    });

    const providerRuntime = {
      destroy: vi.fn().mockResolvedValue(undefined),
      hasRegisteredOperationSupport: vi.fn().mockReturnValue(true),
      getProviders: vi.fn().mockReturnValue([]),
      getAddressBalances: vi.fn(),
      getAddressTokenBalances: vi.fn(),
    } as unknown as IBlockchainProviderRuntime;

    const workflow = new BalanceWorkflow(ports, providerRuntime);
    const result = await workflow.refreshVerification({ accountId: account.id });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe(
        'Failed to initialize a balance-capable provider for lukso. A registered provider supports getAddressBalances, but none could be initialized. Check provider configuration and API keys.'
      );
    }

    expect(markBuilding).toHaveBeenCalledWith(1);
    expect(markFresh).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith(1);
    expect(replaceSnapshot).toHaveBeenCalledTimes(1);
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
      accounts: [account],
      sessions: [createCompletedImportSession(account.id)],
      normalTransactions,
      excludedTransactions: [],
    });

    const providerRuntime = createProviderManager(
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

    const workflow = new BalanceWorkflow(ports, providerRuntime);
    const result = await workflow.refreshVerification({ accountId: account.id });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.status).toBe('warning');
      expect(result.value.warnings).toContain(
        'Token balances are not available for bitcoin. Live balance includes native assets only; token mismatches may be false negatives.'
      );
    }
  });

  it('subtracts only the net excluded inflow after excluded outflows', async () => {
    const account = createAccount();

    const normalTransactions = [
      createTransaction({
        movements: {
          inflows: [
            {
              assetId: 'blockchain:bitcoin:native',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('50'),
              netAmount: parseDecimal('50'),
            },
          ],
          outflows: [],
        },
      }),
    ];

    const excludedTransactions = [
      createTransaction({
        txFingerprint: 'tx-excluded-inflow',
        excludedFromAccounting: true,
        movements: {
          inflows: [
            {
              assetId: 'blockchain:bitcoin:native',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('100'),
              netAmount: parseDecimal('100'),
            },
          ],
          outflows: [],
        },
      }),
      createTransaction({
        txFingerprint: 'tx-excluded-outflow',
        excludedFromAccounting: true,
        movements: {
          inflows: [],
          outflows: [
            {
              assetId: 'blockchain:bitcoin:native',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('40'),
              netAmount: parseDecimal('40'),
            },
          ],
        },
      }),
    ];

    const { ports } = createPortsMock({
      accounts: [account],
      sessions: [createCompletedImportSession(account.id)],
      normalTransactions,
      excludedTransactions,
    });

    const providerRuntime = createProviderManager([{ capabilities: { supportedOperations: ['getAddressBalances'] } }], {
      rawAmount: '11000000000',
      decimalAmount: '110',
      symbol: 'BTC',
      decimals: 8,
    });

    const workflow = new BalanceWorkflow(ports, providerRuntime);
    const result = await workflow.refreshVerification({ accountId: account.id });

    if (result.isErr()) {
      throw result.error;
    }
    expect(result.isOk()).toBe(true);
    expect(result.value.status).toBe('success');
    expect(result.value.comparisons).toHaveLength(1);
    expect(result.value.comparisons[0]).toMatchObject({
      calculatedBalance: '50',
      liveBalance: '50',
      difference: '0',
      status: 'match',
    });
  });

  it('adds excluded outflows back to live balance comparisons', async () => {
    const account = createAccount();

    const normalTransactions = [
      createTransaction({
        movements: {
          inflows: [
            {
              assetId: 'blockchain:bitcoin:native',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('100'),
              netAmount: parseDecimal('100'),
            },
          ],
          outflows: [],
        },
      }),
    ];

    const excludedTransactions = [
      createTransaction({
        txFingerprint: 'tx-excluded-outflow',
        excludedFromAccounting: true,
        movements: {
          inflows: [],
          outflows: [
            {
              assetId: 'blockchain:bitcoin:native',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('40'),
              netAmount: parseDecimal('40'),
            },
          ],
        },
      }),
    ];

    const { ports } = createPortsMock({
      accounts: [account],
      sessions: [createCompletedImportSession(account.id)],
      normalTransactions,
      excludedTransactions,
    });

    const providerRuntime = createProviderManager([{ capabilities: { supportedOperations: ['getAddressBalances'] } }], {
      rawAmount: '6000000000',
      decimalAmount: '60',
      symbol: 'BTC',
      decimals: 8,
    });

    const workflow = new BalanceWorkflow(ports, providerRuntime);
    const result = await workflow.refreshVerification({ accountId: account.id });

    if (result.isErr()) {
      throw result.error;
    }
    expect(result.isOk()).toBe(true);
    expect(result.value.status).toBe('success');
    expect(result.value.comparisons).toHaveLength(1);
    expect(result.value.comparisons[0]).toMatchObject({
      calculatedBalance: '100',
      liveBalance: '100',
      difference: '0',
      status: 'match',
    });
  });

  it('returns an error when account does not exist', async () => {
    const ports: BalancePorts = {
      accountLookup: {
        findById: vi.fn().mockResolvedValue(ok(undefined)),
        findChildAccounts: vi.fn(),
      },
      snapshotStore: { replaceSnapshot: vi.fn() },
      projectionState: {
        markBuilding: vi.fn(),
        markFresh: vi.fn(),
        markFailed: vi.fn(),
      },
      importSessionLookup: { findByAccountIds: vi.fn() },
      transactionSource: { findByAccountIds: vi.fn() },
    };

    const providerRuntime = {
      destroy: vi.fn().mockResolvedValue(undefined),
      hasRegisteredOperationSupport: vi.fn(),
    } as unknown as IBlockchainProviderRuntime;

    const workflow = new BalanceWorkflow(ports, providerRuntime);
    const result = await workflow.refreshVerification({ accountId: 999 });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('No account found with ID 999');
    }
  });

  it('returns provider errors from live balance fetch', async () => {
    const account = createAccount();

    const { markFailed, replaceSnapshot, ports } = createPortsMock({
      accounts: [account],
      sessions: [createCompletedImportSession(account.id)],
      normalTransactions: [],
      excludedTransactions: [],
    });

    const providerRuntime = {
      destroy: vi.fn().mockResolvedValue(undefined),
      hasRegisteredOperationSupport: vi.fn().mockReturnValue(true),
      getProviders: vi.fn().mockReturnValue([{ capabilities: { supportedOperations: ['getAddressBalances'] } }]),
      getAddressBalances: vi.fn().mockResolvedValue(err(new Error('RPC down'))),
    } as unknown as IBlockchainProviderRuntime;

    const workflow = new BalanceWorkflow(ports, providerRuntime);
    const result = await workflow.refreshVerification({ accountId: account.id });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('RPC down');
    }

    expect(replaceSnapshot).toHaveBeenCalledTimes(1);
    expect(markFailed).toHaveBeenCalledWith(account.id);
  });

  it('fails when snapshot persistence fails', async () => {
    const account = createAccount();

    const { markFailed, ports, replaceSnapshot } = createPortsMock({
      accounts: [account],
      sessions: [createCompletedImportSession(account.id)],
      normalTransactions: [],
      excludedTransactions: [],
    });

    replaceSnapshot.mockResolvedValueOnce(err(new Error('write failed')));

    const providerRuntime = createProviderManager([{ capabilities: { supportedOperations: ['getAddressBalances'] } }], {
      rawAmount: '0',
      decimalAmount: '0',
      symbol: 'BTC',
      decimals: 8,
    });

    const workflow = new BalanceWorkflow(ports, providerRuntime);
    const result = await workflow.refreshVerification({ accountId: account.id });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('write failed');
    }

    expect(markFailed).toHaveBeenCalledWith(account.id);
  });

  it('resolves child-account refreshes to the parent balance scope', async () => {
    const parentAccount = createAccount();
    const childAccount = createAccount({
      id: 2,
      identifier: 'bc1-child',
      parentAccountId: parentAccount.id,
    });

    const normalTransactions = [
      createTransaction({
        accountId: childAccount.id,
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

    const { findById, markBuilding, markFailed, markFresh, replaceSnapshot, ports } = createPortsMock({
      accounts: [parentAccount, childAccount],
      sessions: [createCompletedImportSession(childAccount.id)],
      normalTransactions,
      excludedTransactions: [],
    });

    const providerRuntime = createProviderManager([{ capabilities: { supportedOperations: ['getAddressBalances'] } }], {
      rawAmount: '100000000',
      decimalAmount: '1.0',
      symbol: 'BTC',
      decimals: 8,
    });

    const workflow = new BalanceWorkflow(ports, providerRuntime);
    const result = await workflow.refreshVerification({ accountId: childAccount.id });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.account.id).toBe(parentAccount.id);
    }

    expect(findById).toHaveBeenCalledWith(childAccount.id);
    expect(findById).toHaveBeenCalledWith(parentAccount.id);
    expect(markBuilding).toHaveBeenCalledWith(parentAccount.id);
    expect(markFresh).toHaveBeenCalledWith(parentAccount.id);
    expect(markFailed).not.toHaveBeenCalled();
    expect(replaceSnapshot).toHaveBeenCalledTimes(2);
    expect(replaceSnapshot.mock.calls[1]?.[0]?.snapshot.scopeAccountId).toBe(parentAccount.id);
  });

  it('resolves nested child-account rebuilds to the root balance scope', async () => {
    const rootAccount = createAccount({
      id: 1,
      identifier: 'xpub-root',
    });
    const childAccount = createAccount({
      id: 2,
      identifier: 'bc1-child',
      parentAccountId: rootAccount.id,
    });
    const grandchildAccount = createAccount({
      id: 3,
      identifier: 'bc1-grandchild',
      parentAccountId: childAccount.id,
    });

    const normalTransactions = [
      createTransaction({
        accountId: grandchildAccount.id,
        movements: {
          inflows: [
            {
              assetId: 'blockchain:bitcoin:native',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('1.5'),
              netAmount: parseDecimal('1.5'),
            },
          ],
          outflows: [],
        },
      }),
    ];

    const { markBuilding, markFailed, markFresh, replaceSnapshot, ports } = createPortsMock({
      accounts: [rootAccount, childAccount, grandchildAccount],
      sessions: [createCompletedImportSession(grandchildAccount.id)],
      normalTransactions,
      excludedTransactions: [],
    });

    const providerRuntime = createProviderManager([{ capabilities: { supportedOperations: ['getAddressBalances'] } }], {
      rawAmount: '0',
      decimalAmount: '0',
      symbol: 'BTC',
      decimals: 8,
    });

    const workflow = new BalanceWorkflow(ports, providerRuntime);
    const result = await workflow.rebuildCalculatedSnapshot({ accountId: grandchildAccount.id });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.requestedAccount.id).toBe(grandchildAccount.id);
      expect(result.value.scopeAccount.id).toBe(rootAccount.id);
      expect(result.value.assetCount).toBe(1);
    }

    expect(markBuilding).toHaveBeenCalledWith(rootAccount.id);
    expect(markFresh).toHaveBeenCalledWith(rootAccount.id);
    expect(markFailed).not.toHaveBeenCalled();
    expect(replaceSnapshot).toHaveBeenCalledTimes(1);
    expect(replaceSnapshot.mock.calls[0]?.[0]).toMatchObject({
      snapshot: {
        scopeAccountId: rootAccount.id,
        verificationStatus: 'never-run',
      },
      assets: [
        {
          scopeAccountId: rootAccount.id,
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          calculatedBalance: '1.5',
          excludedFromAccounting: false,
        },
      ],
    });
  });
});
