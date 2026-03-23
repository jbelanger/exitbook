import { ok } from '@exitbook/core';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockClearNote,
  mockCtx,
  mockDisplayCliError,
  mockOutputSuccess,
  mockOverrideStoreConstructor,
  mockOverrideStoreInstance,
  mockRunCommand,
  mockSetNote,
  mockTransactionsEditHandlerConstructor,
} = vi.hoisted(() => ({
  mockClearNote: vi.fn(),
  mockCtx: {
    dataDir: '/tmp/exitbook-transactions',
    database: vi.fn(),
    exitCode: 0,
  },
  mockDisplayCliError: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockOverrideStoreConstructor: vi.fn(),
  mockOverrideStoreInstance: { tag: 'override-store' },
  mockRunCommand: vi.fn(),
  mockSetNote: vi.fn(),
  mockTransactionsEditHandlerConstructor: vi.fn(),
}));

vi.mock('@exitbook/data', () => ({
  OverrideStore: vi.fn().mockImplementation(function MockOverrideStore(...args: unknown[]) {
    mockOverrideStoreConstructor(...args);
    return mockOverrideStoreInstance;
  }),
  readTransactionNoteOverrides: vi.fn(),
}));

vi.mock('../../../../runtime/command-scope.js', () => ({
  runCommand: mockRunCommand,
  renderApp: vi.fn(),
}));

vi.mock('../../../shared/cli-error.js', () => ({
  displayCliError: mockDisplayCliError,
}));

vi.mock('../../../shared/json-output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../transactions-edit-handler.js', () => ({
  TransactionsEditHandler: vi.fn().mockImplementation(function MockTransactionsEditHandler(...args: unknown[]) {
    mockTransactionsEditHandlerConstructor(...args);
    return {
      clearNote: mockClearNote,
      setNote: mockSetNote,
    };
  }),
}));

import { registerTransactionsCommand } from '../transactions.js';

function createProgram(): Command {
  const program = new Command();
  registerTransactionsCommand(program);
  return program;
}

describe('transactions edit command', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx.database.mockResolvedValue({ tag: 'db' });
    mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
      await fn(mockCtx);
    });
    mockDisplayCliError.mockImplementation(
      (command: string, error: Error, _exitCode: number, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${error.message}`);
      }
    );
    consoleLogSpy.mockClear();
  });

  it('sets a transaction note in text mode', async () => {
    const program = createProgram();
    mockSetNote.mockResolvedValue(
      ok({
        action: 'set',
        changed: true,
        txFingerprint: 'trade-123',
        note: 'Moved to Ledger',
        reason: 'wallet transfer',
        source: 'kraken',
        transactionId: 123,
      })
    );

    await program.parseAsync(
      ['transactions', 'edit', 'note', '123', '--message', 'Moved to Ledger', '--reason', 'wallet transfer'],
      {
        from: 'user',
      }
    );

    expect(mockOverrideStoreConstructor).toHaveBeenCalledWith('/tmp/exitbook-transactions');
    expect(mockTransactionsEditHandlerConstructor).toHaveBeenCalledWith({ tag: 'db' }, mockOverrideStoreInstance);
    expect(mockSetNote).toHaveBeenCalledWith({
      transactionId: 123,
      message: 'Moved to Ledger',
      reason: 'wallet transfer',
    });
    expect(consoleLogSpy).toHaveBeenCalledWith('Transaction note saved');
    expect(consoleLogSpy).toHaveBeenCalledWith('   Transaction: #123 (kraken / trade-123)');
    expect(consoleLogSpy).toHaveBeenCalledWith('   Note: Moved to Ledger');
  });

  it('clears a transaction note in JSON mode', async () => {
    const program = createProgram();
    const result = {
      action: 'clear',
      changed: true,
      txFingerprint: 'trade-123',
      reason: 'duplicate reminder',
      source: 'kraken',
      transactionId: 123,
    };
    mockClearNote.mockResolvedValue(ok(result));

    await program.parseAsync(['transactions', 'edit', 'note', '123', '--clear', '--json'], {
      from: 'user',
    });

    expect(mockClearNote).toHaveBeenCalledWith({
      transactionId: 123,
      reason: undefined,
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith('transactions-edit-note', result);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('routes option validation failures through the CLI error path', async () => {
    const program = createProgram();

    await expect(program.parseAsync(['transactions', 'edit', 'note', '123'], { from: 'user' })).rejects.toThrow(
      'CLI:transactions-edit-note:text:Either --message or --clear is required'
    );

    expect(mockSetNote).not.toHaveBeenCalled();
    expect(mockClearNote).not.toHaveBeenCalled();
  });

  it('routes invalid transaction ids through the CLI error path', async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(['transactions', 'edit', 'note', 'not-a-number', '--message', 'Memo'], { from: 'user' })
    ).rejects.toThrow('CLI:transactions-edit-note:text:Invalid input: expected number, received NaN');

    expect(mockSetNote).not.toHaveBeenCalled();
  });
});
