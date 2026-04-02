import { ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockClearNote,
  mockCtx,
  mockExitCliFailure,
  mockOutputSuccess,
  mockOverrideStoreConstructor,
  mockOverrideStoreInstance,
  mockPrepareTransactionsCommandScope,
  mockRunCommand,
  mockSetNote,
  mockTransactionsEditHandlerConstructor,
} = vi.hoisted(() => ({
  mockClearNote: vi.fn(),
  mockCtx: {
    dataDir: '/tmp/exitbook-transactions',
    tag: 'command-runtime',
  },
  mockExitCliFailure: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockOverrideStoreConstructor: vi.fn(),
  mockOverrideStoreInstance: { tag: 'override-store' },
  mockPrepareTransactionsCommandScope: vi.fn(),
  mockRunCommand: vi.fn(),
  mockSetNote: vi.fn(),
  mockTransactionsEditHandlerConstructor: vi.fn(),
}));

vi.mock('@exitbook/data/overrides', () => ({
  OverrideStore: vi.fn().mockImplementation(function MockOverrideStore(...args: unknown[]) {
    mockOverrideStoreConstructor(...args);
    return mockOverrideStoreInstance;
  }),
  readTransactionNoteOverrides: vi.fn(),
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
  const PROFILE_KEY = 'default';
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

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
        database: { tag: 'db' },
        profile: {
          id: 1,
          profileKey: 'default',
          displayName: 'default',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      })
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
        platformKey: 'kraken',
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
    expect(mockPrepareTransactionsCommandScope).toHaveBeenCalledWith(mockCtx, { format: 'text' });
    expect(mockTransactionsEditHandlerConstructor).toHaveBeenCalledWith({ tag: 'db' }, mockOverrideStoreInstance);
    expect(mockSetNote).toHaveBeenCalledWith({
      profileId: 1,
      profileKey: PROFILE_KEY,
      transactionId: 123,
      message: 'Moved to Ledger',
      reason: 'wallet transfer',
    });
    expect(consoleLogSpy.mock.calls[0]?.[0]).toContain('✓');
    expect(consoleLogSpy.mock.calls[0]?.[0]).toContain('Transaction note saved');
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
      platformKey: 'kraken',
      transactionId: 123,
    };
    mockClearNote.mockResolvedValue(ok(result));

    await program.parseAsync(['transactions', 'edit', 'note', '123', '--clear', '--json'], {
      from: 'user',
    });

    expect(mockPrepareTransactionsCommandScope).toHaveBeenCalledWith(mockCtx, { format: 'json' });
    expect(mockClearNote).toHaveBeenCalledWith({
      profileId: 1,
      profileKey: PROFILE_KEY,
      transactionId: 123,
      reason: undefined,
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith('transactions-edit-note', result, undefined);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('routes option validation failures through the shared boundary', async () => {
    const program = createProgram();

    await expect(program.parseAsync(['transactions', 'edit', 'note', '123'], { from: 'user' })).rejects.toThrow(
      'CLI:transactions-edit-note:text:Either --message or --clear is required:2'
    );

    expect(mockPrepareTransactionsCommandScope).not.toHaveBeenCalled();
    expect(mockSetNote).not.toHaveBeenCalled();
    expect(mockClearNote).not.toHaveBeenCalled();
  });

  it('routes invalid transaction ids through the shared boundary', async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(['transactions', 'edit', 'note', 'not-a-number', '--message', 'Memo'], { from: 'user' })
    ).rejects.toThrow('CLI:transactions-edit-note:text:Invalid input: expected number, received NaN:2');

    expect(mockPrepareTransactionsCommandScope).not.toHaveBeenCalled();
    expect(mockSetNote).not.toHaveBeenCalled();
  });
});
