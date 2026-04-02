/* eslint-disable @typescript-eslint/no-unsafe-assignment -- ok for tests */
import type { Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { ok, parseDecimal } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPersistedTransaction } from '../../../shared/__tests__/transaction-test-utils.js';

const {
  mockCtx,
  mockExitCliFailure,
  mockFindByFingerprintRef,
  mockOutputSuccess,
  mockOutputTransactionStaticDetail,
  mockOutputTransactionsStaticList,
  mockReadTransactionsForCommand,
  mockResolveCommandProfile,
  mockRunCommand,
} = vi.hoisted(() => ({
  mockCtx: {
    database: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockFindByFingerprintRef: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockOutputTransactionStaticDetail: vi.fn(),
  mockOutputTransactionsStaticList: vi.fn(),
  mockReadTransactionsForCommand: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunCommand: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  runCommand: mockRunCommand,
}));

vi.mock('../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../profiles/profile-resolution.js', () => ({
  resolveCommandProfile: mockResolveCommandProfile,
}));

vi.mock('../transactions-read-support.js', () => ({
  readTransactionsForCommand: mockReadTransactionsForCommand,
}));

vi.mock('../../view/transactions-static-renderer.js', () => ({
  outputTransactionStaticDetail: mockOutputTransactionStaticDetail,
  outputTransactionsStaticList: mockOutputTransactionsStaticList,
}));

vi.mock('../transactions-view.js', () => ({
  registerTransactionsViewCommand: vi.fn(),
}));

vi.mock('../transactions-edit.js', () => ({
  registerTransactionsEditCommand: vi.fn(),
}));

vi.mock('../transactions-export.js', () => ({
  registerTransactionsExportCommand: vi.fn(),
}));

import { registerTransactionsCommand } from '../transactions.js';

function createProgram(): Command {
  const program = new Command();
  registerTransactionsCommand(program);
  return program;
}

function createFingerprint(seed: string): string {
  return seed.repeat(64);
}

function createTransaction(overrides: Partial<Transaction> = {}): Transaction {
  const datetime = overrides.datetime ?? '2026-03-01T12:00:00.000Z';

  return createPersistedTransaction({
    id: overrides.id ?? 1,
    accountId: overrides.accountId ?? 1,
    txFingerprint: overrides.txFingerprint ?? createFingerprint('a'),
    platformKey: overrides.platformKey ?? 'kraken',
    platformKind: overrides.platformKind ?? 'exchange',
    datetime,
    timestamp: overrides.timestamp ?? Date.parse(datetime),
    status: overrides.status ?? 'success',
    operation: overrides.operation ?? {
      category: 'trade',
      type: 'buy',
    },
    movements: overrides.movements ?? {
      inflows: [
        {
          assetId: 'asset:btc',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('1'),
          netAmount: parseDecimal('1'),
        },
      ],
      outflows: [],
    },
    fees: overrides.fees ?? [],
    from: overrides.from,
    to: overrides.to,
    blockchain: overrides.blockchain,
    notes: overrides.notes,
    excludedFromAccounting: overrides.excludedFromAccounting,
    isSpam: overrides.isSpam,
  });
}

describe('transactions root command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx.database.mockResolvedValue({
      transactions: {
        findByFingerprintRef: mockFindByFingerprintRef,
      },
    });
    mockResolveCommandProfile.mockResolvedValue(
      ok({ id: 1, profileKey: 'default', displayName: 'default', createdAt: new Date('2026-03-01T00:00:00.000Z') })
    );
    mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
      await fn(mockCtx);
    });
    mockExitCliFailure.mockImplementation(
      (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
      }
    );
    mockReadTransactionsForCommand.mockResolvedValue(ok([]));
    mockFindByFingerprintRef.mockResolvedValue(ok(undefined));
  });

  it('renders the static list for bare transactions', async () => {
    const program = createProgram();
    const first = createTransaction({ id: 1, txFingerprint: createFingerprint('a') });
    const second = createTransaction({ id: 2, txFingerprint: createFingerprint('b') });

    mockReadTransactionsForCommand.mockResolvedValue(ok([first, second]));

    await program.parseAsync(['transactions'], { from: 'user' });

    expect(mockReadTransactionsForCommand).toHaveBeenCalledWith({
      db: expect.objectContaining({
        transactions: expect.objectContaining({
          findByFingerprintRef: mockFindByFingerprintRef,
        }),
      }),
      profileId: 1,
      platformKey: undefined,
      since: undefined,
      until: undefined,
      assetSymbol: undefined,
      operationType: undefined,
      noPrice: undefined,
    });
    expect(mockOutputTransactionsStaticList).toHaveBeenCalledOnce();
    expect(mockOutputTransactionsStaticList).toHaveBeenCalledWith(
      expect.objectContaining({
        totalCount: 2,
        transactions: expect.arrayContaining([expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 })]),
      })
    );
    expect(mockOutputTransactionStaticDetail).not.toHaveBeenCalled();
  });

  it('renders the static detail for a bare fingerprint ref', async () => {
    const program = createProgram();
    const transaction = createTransaction({ id: 9, txFingerprint: createFingerprint('c') });
    const fingerprintRef = transaction.txFingerprint.slice(0, 10);

    mockFindByFingerprintRef.mockResolvedValue(ok(transaction));

    await program.parseAsync(['transactions', fingerprintRef], { from: 'user' });

    expect(mockFindByFingerprintRef).toHaveBeenCalledWith(1, fingerprintRef);
    expect(mockOutputTransactionStaticDetail).toHaveBeenCalledOnce();
    expect(mockOutputTransactionStaticDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 9,
        txFingerprint: transaction.txFingerprint,
      })
    );
    expect(mockReadTransactionsForCommand).not.toHaveBeenCalled();
  });

  it('outputs list JSON for the bare transactions command', async () => {
    const program = createProgram();
    const first = createTransaction({ id: 1, txFingerprint: createFingerprint('d') });
    const second = createTransaction({ id: 2, txFingerprint: createFingerprint('e') });

    mockReadTransactionsForCommand.mockResolvedValue(ok([first, second]));

    await program.parseAsync(['transactions', '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'transactions',
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 })]),
        meta: expect.objectContaining({
          count: 2,
          limit: 2,
          hasMore: false,
          offset: 0,
        }),
      }),
      undefined
    );
  });

  it('outputs detail JSON for the bare fingerprint ref form', async () => {
    const program = createProgram();
    const transaction = createTransaction({ id: 42, txFingerprint: createFingerprint('f') });
    const fingerprintRef = transaction.txFingerprint.slice(0, 10);

    mockFindByFingerprintRef.mockResolvedValue(ok(transaction));

    await program.parseAsync(['transactions', fingerprintRef, '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'transactions',
      expect.objectContaining({
        data: expect.objectContaining({
          id: 42,
          txFingerprint: transaction.txFingerprint,
        }),
        meta: expect.objectContaining({
          count: 1,
          limit: 1,
          hasMore: false,
          offset: 0,
          filters: {
            transaction: fingerprintRef,
          },
        }),
      }),
      undefined
    );
  });

  it('rejects combining a bare transaction ref with list filters', async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(['transactions', 'abc123', '--platform', 'kraken'], { from: 'user' })
    ).rejects.toThrow(
      'CLI:transactions:text:Transaction selector cannot be combined with --platform, --asset, --since, --until, --operation-type, or --no-price:2'
    );

    expect(mockFindByFingerprintRef).not.toHaveBeenCalled();
    expect(mockReadTransactionsForCommand).not.toHaveBeenCalled();
  });
});
