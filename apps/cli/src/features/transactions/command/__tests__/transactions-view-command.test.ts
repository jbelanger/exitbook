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
  mockPrepareTransactionsCommandScope,
  mockReadTransactionsForCommand,
  mockRunCommand,
} = vi.hoisted(() => ({
  mockCtx: { tag: 'command-runtime' },
  mockExitCliFailure: vi.fn(),
  mockFindByFingerprintRef: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockOutputTransactionStaticDetail: vi.fn(),
  mockOutputTransactionsStaticList: vi.fn(),
  mockPrepareTransactionsCommandScope: vi.fn(),
  mockReadTransactionsForCommand: vi.fn(),
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

vi.mock('../transactions-command-scope.js', () => ({
  prepareTransactionsCommandScope: mockPrepareTransactionsCommandScope,
}));

vi.mock('../transactions-read-support.js', () => ({
  readTransactionsForCommand: mockReadTransactionsForCommand,
}));

vi.mock('../../view/transactions-static-renderer.js', () => ({
  outputTransactionStaticDetail: mockOutputTransactionStaticDetail,
  outputTransactionsStaticList: mockOutputTransactionsStaticList,
}));

import { registerTransactionsViewCommand } from '../transactions-view.js';

function createProgram(): Command {
  const program = new Command();
  registerTransactionsViewCommand(program.command('transactions'));
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
    diagnostics: overrides.diagnostics,
    userNotes: overrides.userNotes,
    excludedFromAccounting: overrides.excludedFromAccounting,
  });
}

describe('transactions view command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
      await fn(mockCtx);
    });
    mockExitCliFailure.mockImplementation(
      (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
      }
    );
    mockPrepareTransactionsCommandScope.mockResolvedValue(
      ok({
        database: {
          transactions: {
            findByFingerprintRef: mockFindByFingerprintRef,
          },
        },
        profile: {
          id: 1,
          profileKey: 'default',
          displayName: 'default',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      })
    );
    mockReadTransactionsForCommand.mockResolvedValue(ok([]));
    mockFindByFingerprintRef.mockResolvedValue(ok(undefined));
  });

  it('renders static detail for one transaction fingerprint ref', async () => {
    const program = createProgram();
    const transaction = createTransaction({ id: 9, txFingerprint: createFingerprint('c') });
    const fingerprintRef = transaction.txFingerprint.slice(0, 10);

    mockFindByFingerprintRef.mockResolvedValue(ok(transaction));

    await program.parseAsync(['transactions', 'view', fingerprintRef], { from: 'user' });

    expect(mockPrepareTransactionsCommandScope).toHaveBeenCalledWith(mockCtx, { format: 'text' });
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

  it('outputs detail JSON for one transaction fingerprint ref', async () => {
    const program = createProgram();
    const transaction = createTransaction({
      id: 42,
      txFingerprint: createFingerprint('f'),
      platformKey: 'coinbase',
      platformKind: 'exchange',
      operation: {
        category: 'transfer',
        type: 'withdrawal',
      },
      blockchain: {
        name: 'solana',
        transaction_hash: '4XDm1S4vvNCXUztCHsP55Z7H8d8cY3niaKMqtPsrnxJxHzbYFQNnWxytneDzUBLruRvZLhVWWC6JATqGfs9kbq4K',
        is_confirmed: true,
      },
    });
    const fingerprintRef = transaction.txFingerprint.slice(0, 10);

    mockFindByFingerprintRef.mockResolvedValue(ok(transaction));

    await program.parseAsync(['transactions', 'view', fingerprintRef, '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'transactions-view',
      expect.objectContaining({
        data: expect.objectContaining({
          id: 42,
          platformKey: 'coinbase',
          platformKind: 'exchange',
          txFingerprint: transaction.txFingerprint,
          blockchain: expect.objectContaining({
            name: 'solana',
            transactionHash: transaction.blockchain?.transaction_hash,
            isConfirmed: true,
          }),
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

  it('rejects combining a transaction ref with browse filters', async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(['transactions', 'view', 'abc123', '--platform', 'kraken'], { from: 'user' })
    ).rejects.toThrow(
      'CLI:transactions-view:text:Transaction selector cannot be combined with --platform, --asset, --since, --until, --operation-type, or --no-price:2'
    );

    expect(mockFindByFingerprintRef).not.toHaveBeenCalled();
    expect(mockPrepareTransactionsCommandScope).not.toHaveBeenCalled();
    expect(mockReadTransactionsForCommand).not.toHaveBeenCalled();
  });
});
