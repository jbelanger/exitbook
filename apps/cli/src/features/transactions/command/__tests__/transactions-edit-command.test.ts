import type { Transaction } from '@exitbook/core';
import { ok, parseDecimal, type Currency } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';
import { createPersistedTransaction } from '../../../shared/__tests__/transaction-test-utils.js';

const {
  mockClearNote,
  mockCtx,
  mockExitCliFailure,
  mockFindByFingerprintRef,
  mockOutputSuccess,
  mockOverrideStoreConstructor,
  mockOverrideStoreInstance,
  mockPrepareTransactionsCommandScope,
  mockRunCommand,
  mockSetNote,
  mockTransactionsEditNoteHandlerConstructor,
} = vi.hoisted(() => ({
  mockClearNote: vi.fn(),
  mockCtx: {
    dataDir: '/tmp/exitbook-transactions',
    tag: 'command-runtime',
  },
  mockExitCliFailure: vi.fn(),
  mockFindByFingerprintRef: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockOverrideStoreConstructor: vi.fn(),
  mockOverrideStoreInstance: { tag: 'override-store' },
  mockPrepareTransactionsCommandScope: vi.fn(),
  mockRunCommand: vi.fn(),
  mockSetNote: vi.fn(),
  mockTransactionsEditNoteHandlerConstructor: vi.fn(),
}));

vi.mock('@exitbook/data/overrides', () => ({
  OverrideStore: vi.fn().mockImplementation(function MockOverrideStore(...args: unknown[]) {
    mockOverrideStoreConstructor(...args);
    return mockOverrideStoreInstance;
  }),
  readTransactionUserNoteOverrides: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  renderApp: vi.fn(),
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

vi.mock('../transactions-edit-note-handler.js', () => ({
  TransactionsEditNoteHandler: vi.fn().mockImplementation(function MockTransactionsEditNoteHandler(...args: unknown[]) {
    mockTransactionsEditNoteHandlerConstructor(...args);
    return {
      clearNote: mockClearNote,
      setNote: mockSetNote,
    };
  }),
}));

import { registerTransactionsCommand } from '../transactions.js';

const mockAppRuntime = { tag: 'app-runtime' } as unknown as CliAppRuntime;

function createProgram(): Command {
  const program = new Command();
  registerTransactionsCommand(program, mockAppRuntime);
  return program;
}

function createTransaction(): Transaction {
  return createPersistedTransaction({
    id: 123,
    accountId: 1,
    txFingerprint: '1234567890abcdef1234567890abcdef',
    platformKey: 'kraken',
    platformKind: 'exchange',
    datetime: '2026-03-01T12:00:00.000Z',
    timestamp: Date.parse('2026-03-01T12:00:00.000Z'),
    status: 'success',
    operation: { category: 'transfer', type: 'withdrawal' },
    movements: {
      inflows: [],
      outflows: [
        {
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('1'),
          netAmount: parseDecimal('1'),
        },
      ],
    },
    fees: [],
  });
}

describe('transactions edit command', () => {
  const PROFILE_KEY = 'default';
  const transaction = createTransaction();
  const selector = transaction.txFingerprint.slice(0, 10);
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

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
          tag: 'db',
          transactions: {
            findByFingerprintRef: mockFindByFingerprintRef,
          },
        },
        profile: {
          id: 1,
          profileKey: PROFILE_KEY,
          displayName: PROFILE_KEY,
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      })
    );
    mockFindByFingerprintRef.mockResolvedValue(ok(transaction));
    consoleLogSpy.mockClear();
  });

  it('sets a transaction note in text mode using a transaction selector', async () => {
    const program = createProgram();
    mockSetNote.mockResolvedValue(
      ok({
        action: 'set',
        changed: true,
        note: 'Moved to Ledger',
        projectionSyncStatus: 'synchronized',
        reason: 'wallet transfer',
        transaction: {
          platformKey: 'kraken',
          txFingerprint: transaction.txFingerprint,
          txRef: selector,
        },
        warnings: [],
      })
    );

    await program.parseAsync(
      ['transactions', 'edit', 'note', selector, '--message', 'Moved to Ledger', '--reason', 'wallet transfer'],
      {
        from: 'user',
      }
    );

    expect(mockOverrideStoreConstructor).toHaveBeenCalledWith('/tmp/exitbook-transactions');
    expect(mockPrepareTransactionsCommandScope).toHaveBeenCalledWith(mockCtx, { format: 'text' });
    expect(mockFindByFingerprintRef).toHaveBeenCalledWith(1, selector);
    expect(mockTransactionsEditNoteHandlerConstructor).toHaveBeenCalledWith(
      { tag: 'db', transactions: { findByFingerprintRef: mockFindByFingerprintRef } },
      mockOverrideStoreInstance
    );
    expect(mockSetNote).toHaveBeenCalledWith({
      profileKey: PROFILE_KEY,
      target: {
        accountId: 1,
        platformKey: 'kraken',
        transactionId: 123,
        txFingerprint: transaction.txFingerprint,
        txRef: selector,
      },
      message: 'Moved to Ledger',
      reason: 'wallet transfer',
    });
    expect(consoleLogSpy.mock.calls[0]?.[0]).toContain('✓');
    expect(consoleLogSpy.mock.calls[0]?.[0]).toContain('Transaction note saved');
    expect(consoleLogSpy).toHaveBeenCalledWith(`   Transaction: ${selector} (kraken / ${transaction.txFingerprint})`);
    expect(consoleLogSpy).toHaveBeenCalledWith('   Note: Moved to Ledger');
  });

  it('clears a transaction note in JSON mode using a transaction selector', async () => {
    const program = createProgram();
    const result = {
      action: 'clear',
      changed: true,
      projectionSyncStatus: 'synchronized',
      reason: 'duplicate reminder',
      transaction: {
        platformKey: 'kraken',
        txFingerprint: transaction.txFingerprint,
        txRef: selector,
      },
      warnings: [],
    };
    mockClearNote.mockResolvedValue(ok(result));

    await program.parseAsync(['transactions', 'edit', 'note', selector, '--clear', '--json'], {
      from: 'user',
    });

    expect(mockPrepareTransactionsCommandScope).toHaveBeenCalledWith(mockCtx, { format: 'json' });
    expect(mockFindByFingerprintRef).toHaveBeenCalledWith(1, selector);
    expect(mockClearNote).toHaveBeenCalledWith({
      profileKey: PROFILE_KEY,
      target: {
        accountId: 1,
        platformKey: 'kraken',
        transactionId: 123,
        txFingerprint: transaction.txFingerprint,
        txRef: selector,
      },
      reason: undefined,
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith('transactions-edit-note', result, undefined);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('prints repair guidance when note projection sync requires reprocess', async () => {
    const program = createProgram();
    mockSetNote.mockResolvedValue(
      ok({
        action: 'set',
        changed: true,
        note: 'Moved to Ledger',
        projectionSyncStatus: 'reprocess-required',
        repairCommand: 'exitbook reprocess',
        transaction: {
          platformKey: 'kraken',
          txFingerprint: transaction.txFingerprint,
          txRef: selector,
        },
        warnings: ['Override state is current, but transaction note projection refresh failed: materialize failed'],
      })
    );

    await program.parseAsync(['transactions', 'edit', 'note', selector, '--message', 'Moved to Ledger'], {
      from: 'user',
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Warning: Override state is current, but transaction note projection refresh failed: materialize failed'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('Repair: exitbook reprocess');
  });

  it('routes option validation failures through the shared boundary', async () => {
    const program = createProgram();

    await expect(program.parseAsync(['transactions', 'edit', 'note', selector], { from: 'user' })).rejects.toThrow(
      'CLI:transactions-edit-note:text:Either --message or --clear is required:2'
    );

    expect(mockPrepareTransactionsCommandScope).not.toHaveBeenCalled();
    expect(mockSetNote).not.toHaveBeenCalled();
    expect(mockClearNote).not.toHaveBeenCalled();
  });

  it('routes missing transaction refs through the shared boundary', async () => {
    const program = createProgram();
    mockFindByFingerprintRef.mockResolvedValue(ok(undefined));

    await expect(
      program.parseAsync(['transactions', 'edit', 'note', 'deadbeef00', '--message', 'Memo'], { from: 'user' })
    ).rejects.toThrow("CLI:transactions-edit-note:text:Transaction ref 'deadbeef00' not found:4");

    expect(mockPrepareTransactionsCommandScope).toHaveBeenCalledWith(mockCtx, { format: 'text' });
    expect(mockSetNote).not.toHaveBeenCalled();
  });
});
