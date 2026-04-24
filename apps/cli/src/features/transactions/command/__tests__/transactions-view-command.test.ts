/* eslint-disable @typescript-eslint/no-unsafe-assignment -- ok for tests */
import type { Transaction } from '@exitbook/core';
import type { RawTransaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { ok, parseDecimal } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';
import { createPersistedTransaction } from '../../../shared/__tests__/transaction-test-utils.js';

const {
  mockCtx,
  mockExitCliFailure,
  mockFindByFingerprintRef,
  mockFindRawTransactionsByTransactionId,
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
  mockFindByFingerprintRef: vi.fn(),
  mockFindRawTransactionsByTransactionId: vi.fn(),
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

vi.mock('../../view/transactions-static-renderer.js', () => ({
  outputTransactionStaticDetail: mockOutputTransactionStaticDetail,
  outputTransactionsStaticList: mockOutputTransactionsStaticList,
}));

import { registerTransactionsViewCommand } from '../transactions-view.js';

const mockAppRuntime = { tag: 'app-runtime' } as unknown as CliAppRuntime;

function createProgram(): Command {
  const program = new Command();
  registerTransactionsViewCommand(program.command('transactions'), mockAppRuntime);
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
            findAll: vi.fn().mockResolvedValue(ok([])),
            findByFingerprintRef: vi.fn(),
            findById: vi.fn(),
            findByIdentifier: vi.fn(),
            findByIdentity: vi.fn(),
            findByName: vi.fn(),
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
            findRawTransactionsByTransactionId: mockFindRawTransactionsByTransactionId,
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
    mockReadTransactionsForCommand.mockResolvedValue(ok([]));
    mockReadTransactionAnnotationsForCommand.mockResolvedValue(ok([]));
    mockFindByFingerprintRef.mockResolvedValue(ok(undefined));
    mockFindRawTransactionsByTransactionId.mockResolvedValue(ok([]));
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
      from: 'bc1qtrackedwallet',
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
    mockPrepareTransactionsCommandScope.mockResolvedValue(
      ok({
        database: {
          accounts: {
            create: vi.fn(),
            findAll: vi.fn().mockResolvedValue(
              ok([
                {
                  id: 44,
                  profileId: 1,
                  name: 'btc-wallet',
                  parentAccountId: undefined,
                  accountType: 'blockchain',
                  platformKey: 'bitcoin',
                  identifier: 'bc1qtrackedwallet',
                  accountFingerprint: 'accountfingerprint-1234567890',
                  providerName: undefined,
                  credentials: undefined,
                  lastCursor: undefined,
                  metadata: undefined,
                  createdAt: new Date('2026-03-01T00:00:00.000Z'),
                  updatedAt: undefined,
                },
              ])
            ),
            findByFingerprintRef: vi.fn(),
            findById: vi.fn(),
            findByIdentifier: vi.fn(),
            findByIdentity: vi.fn(),
            findByName: vi.fn(),
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
            findAll: vi.fn().mockResolvedValue(ok([transaction])),
            findByFingerprintRef: mockFindByFingerprintRef,
            findRawTransactionsByTransactionId: mockFindRawTransactionsByTransactionId,
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
          relatedContext: expect.objectContaining({
            fromAccount: expect.objectContaining({
              accountName: 'btc-wallet',
              platformKey: 'bitcoin',
            }),
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

  it('loads source lineage by default and full source data when --source-data is requested', async () => {
    const program = createProgram();
    const transaction = createTransaction({ id: 17, txFingerprint: createFingerprint('d') });
    const rawSource: RawTransaction = {
      accountId: 1,
      blockchainTransactionHash: undefined,
      createdAt: new Date('2026-03-02T00:00:00.000Z'),
      eventId: 'evt-1',
      id: 301,
      normalizedData: { normalized: true },
      processedAt: new Date('2026-03-02T00:00:00.000Z'),
      processingStatus: 'processed',
      providerData: { amount: '1.25' },
      providerName: 'kraken',
      sourceAddress: undefined,
      timestamp: Date.parse('2026-03-01T12:00:00.000Z'),
      transactionTypeHint: 'trade',
    };
    const fingerprintRef = transaction.txFingerprint.slice(0, 10);

    mockFindByFingerprintRef.mockResolvedValue(ok(transaction));
    mockFindRawTransactionsByTransactionId.mockResolvedValue(ok([rawSource]));

    await program.parseAsync(['transactions', 'view', fingerprintRef, '--source-data'], { from: 'user' });

    expect(mockFindRawTransactionsByTransactionId).toHaveBeenCalledWith(transaction.id, 1);
    expect(mockOutputTransactionStaticDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLineage: [
          expect.objectContaining({
            rawTransactionId: rawSource.id,
            providerName: rawSource.providerName,
            eventId: rawSource.eventId,
          }),
        ],
        sourceData: [
          expect.objectContaining({
            rawTransactionId: rawSource.id,
            providerName: rawSource.providerName,
            eventId: rawSource.eventId,
            providerPayload: rawSource.providerData,
            normalizedPayload: rawSource.normalizedData,
          }),
        ],
      })
    );
  });

  it('rejects combining a transaction ref with browse filters', async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(['transactions', 'view', 'abc123', '--platform', 'kraken'], { from: 'user' })
    ).rejects.toThrow(
      'CLI:transactions-view:text:Transaction selector cannot be combined with --account, --platform, --asset, --asset-id, --address, --from, --to, --since, --until, --operation-type, --annotation-kind, --annotation-tier, or --no-price:2'
    );

    expect(mockFindByFingerprintRef).not.toHaveBeenCalled();
    expect(mockPrepareTransactionsCommandScope).not.toHaveBeenCalled();
    expect(mockReadTransactionsForCommand).not.toHaveBeenCalled();
  });
});
