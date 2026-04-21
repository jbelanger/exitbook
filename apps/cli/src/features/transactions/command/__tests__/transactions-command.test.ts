/* eslint-disable @typescript-eslint/no-unsafe-assignment -- ok for tests */
import type { Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { ok, parseDecimal } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';
import { createPersistedTransaction } from '../../../shared/__tests__/transaction-test-utils.js';

const {
  mockCtx,
  mockExitCliFailure,
  mockFindAccountByName,
  mockFindAllAccounts,
  mockFindByFingerprintRef,
  mockOutputSuccess,
  mockOutputTransactionStaticDetail,
  mockOutputTransactionsStaticList,
  mockPrepareTransactionsCommandScope,
  mockReadTransactionAnnotationsForCommand,
  mockReadTransactionsForCommand,
  mockRunCommand,
} = vi.hoisted(() => ({
  mockCtx: { tag: 'command-runtime' },
  mockExitCliFailure: vi.fn(),
  mockFindAccountByName: vi.fn(),
  mockFindAllAccounts: vi.fn(),
  mockFindByFingerprintRef: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockOutputTransactionStaticDetail: vi.fn(),
  mockOutputTransactionsStaticList: vi.fn(),
  mockPrepareTransactionsCommandScope: vi.fn(),
  mockReadTransactionAnnotationsForCommand: vi.fn(),
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
  readTransactionAnnotationsForCommand: mockReadTransactionAnnotationsForCommand,
  readTransactionsForCommand: mockReadTransactionsForCommand,
}));

vi.mock('../transactions-explore.js', () => ({
  registerTransactionsExploreCommand: vi.fn(),
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

const mockAppRuntime = { tag: 'app-runtime' } as unknown as CliAppRuntime;

function createProgram(): Command {
  const program = new Command();
  registerTransactionsCommand(program, mockAppRuntime);
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

describe('transactions root command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunCommand.mockImplementation(async (...args: unknown[]) => {
      const fn = (typeof args[0] === 'function' ? args[0] : args[1]) as (ctx: typeof mockCtx) => Promise<void>;
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
          accounts: {
            create: vi.fn(),
            findAll: mockFindAllAccounts,
            findByFingerprintRef: vi.fn(),
            findById: vi.fn(),
            findByIdentifier: vi.fn(),
            findByIdentity: vi.fn(),
            findByName: mockFindAccountByName,
            update: vi.fn(),
          },
          assetReview: {
            listAll: vi.fn().mockResolvedValue(ok([])),
          },
          profiles: {
            list: vi.fn().mockResolvedValue(ok([])),
          },
          transactionAnnotations: {
            readAnnotations: vi.fn().mockResolvedValue(ok([])),
          },
          transactions: {
            findAll: vi.fn().mockResolvedValue(ok([])),
            findByFingerprintRef: mockFindByFingerprintRef,
            findRawTransactionsByTransactionId: vi.fn().mockResolvedValue(ok([])),
          },
          transactionLinks: {
            findAll: vi.fn().mockResolvedValue(ok([])),
          },
        },
        dataDir: '/tmp/exitbook-cli-tests',
        profile: {
          id: 1,
          profileKey: 'default',
          displayName: 'default',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      })
    );
    mockFindAllAccounts.mockResolvedValue(ok([]));
    mockFindAccountByName.mockResolvedValue(ok(undefined));
    mockReadTransactionAnnotationsForCommand.mockResolvedValue(ok([]));
    mockReadTransactionsForCommand.mockResolvedValue(ok([]));
    mockFindByFingerprintRef.mockResolvedValue(ok(undefined));
  });

  it('renders the static list for bare transactions', async () => {
    const program = createProgram();
    const first = createTransaction({ id: 1, txFingerprint: createFingerprint('a') });
    const second = createTransaction({ id: 2, txFingerprint: createFingerprint('b') });

    mockReadTransactionsForCommand.mockResolvedValue(ok([first, second]));

    await program.parseAsync(['transactions'], { from: 'user' });

    expect(mockRunCommand).toHaveBeenCalledWith(mockAppRuntime, expect.any(Function));
    expect(mockPrepareTransactionsCommandScope).toHaveBeenCalledWith(mockCtx, { format: 'text' });
    expect(mockReadTransactionsForCommand).toHaveBeenCalledWith({
      db: expect.objectContaining({
        accounts: expect.objectContaining({
          findAll: mockFindAllAccounts,
          findByName: mockFindAccountByName,
        }),
        transactions: expect.objectContaining({
          findByFingerprintRef: mockFindByFingerprintRef,
        }),
      }),
      profileId: 1,
      accountIds: undefined,
      platformKey: undefined,
      since: undefined,
      until: undefined,
      assetId: undefined,
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

  it('rejects bare selectors and points callers to view or explore', async () => {
    const program = createProgram();

    await expect(program.parseAsync(['transactions', 'abc123'], { from: 'user' })).rejects.toThrow(
      'CLI:transactions:text:Use "transactions view abc123" for static detail or "transactions explore abc123" for the explorer.:2'
    );

    expect(mockFindByFingerprintRef).not.toHaveBeenCalled();
    expect(mockOutputTransactionStaticDetail).not.toHaveBeenCalled();
    expect(mockReadTransactionsForCommand).not.toHaveBeenCalled();
  });

  it('outputs list JSON for the bare transactions command', async () => {
    const program = createProgram();
    const first = createTransaction({ id: 1, txFingerprint: createFingerprint('d') });
    const second = createTransaction({ id: 2, txFingerprint: createFingerprint('e') });

    mockReadTransactionsForCommand.mockResolvedValue(ok([first, second]));

    await program.parseAsync(['transactions', '--json'], { from: 'user' });

    expect(mockPrepareTransactionsCommandScope).toHaveBeenCalledWith(mockCtx, { format: 'json' });
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

  it('routes --account through account selection before reading the static list', async () => {
    const program = createProgram();
    const rootAccount = {
      id: 3,
      profileId: 1,
      name: 'wallet-main',
      parentAccountId: undefined,
      accountType: 'blockchain',
      platformKey: 'bitcoin',
      identifier: 'bc1-root',
      accountFingerprint: '3aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: undefined,
    };
    const childAccount = {
      ...rootAccount,
      id: 4,
      name: undefined,
      parentAccountId: 3,
      identifier: 'bc1-child',
      accountFingerprint: '4bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    };

    mockFindAccountByName.mockResolvedValue(ok(rootAccount));
    mockFindAllAccounts.mockImplementation(async (filters?: { parentAccountId?: number | undefined }) => {
      if (filters?.parentAccountId === rootAccount.id) {
        return ok([childAccount]);
      }

      if (filters?.parentAccountId === childAccount.id) {
        return ok([]);
      }

      return ok([rootAccount, childAccount]);
    });

    await program.parseAsync(['transactions', 'list', '--account', 'wallet-main', '--json'], { from: 'user' });

    expect(mockReadTransactionsForCommand).toHaveBeenCalledWith({
      db: expect.objectContaining({
        accounts: expect.objectContaining({
          findAll: mockFindAllAccounts,
          findByName: mockFindAccountByName,
        }),
      }),
      profileId: 1,
      accountIds: [3, 4],
      platformKey: undefined,
      since: undefined,
      until: undefined,
      assetId: undefined,
      assetSymbol: undefined,
      operationType: undefined,
      noPrice: undefined,
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'transactions-list',
      expect.objectContaining({
        meta: expect.objectContaining({
          filters: {
            account: 'wallet-main',
          },
        }),
      }),
      undefined
    );
  });

  it('rejects bare selectors with JSON and points callers to view or explore', async () => {
    const program = createProgram();

    await expect(program.parseAsync(['transactions', 'abc123', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:transactions:json:Use "transactions view abc123" for static detail or "transactions explore abc123" for the explorer.:2'
    );

    expect(mockFindByFingerprintRef).not.toHaveBeenCalled();
    expect(mockPrepareTransactionsCommandScope).not.toHaveBeenCalled();
    expect(mockReadTransactionsForCommand).not.toHaveBeenCalled();
  });
});
