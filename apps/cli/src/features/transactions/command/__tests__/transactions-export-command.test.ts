import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const {
  mockCtx,
  mockExitCliFailure,
  mockExportExecute,
  mockOutputSuccess,
  mockPrepareTransactionsCommandScope,
  mockRunCommand,
  mockWriteFilesWithAtomicRenames,
} = vi.hoisted(() => ({
  mockCtx: { tag: 'command-runtime' },
  mockExitCliFailure: vi.fn(),
  mockExportExecute: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockPrepareTransactionsCommandScope: vi.fn(),
  mockRunCommand: vi.fn(),
  mockWriteFilesWithAtomicRenames: vi.fn(),
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

vi.mock('../../../shared/file-utils.js', () => ({
  writeFilesWithAtomicRenames: mockWriteFilesWithAtomicRenames,
}));

vi.mock('../transactions-command-scope.js', () => ({
  prepareTransactionsCommandScope: mockPrepareTransactionsCommandScope,
}));

vi.mock('../transactions-export-handler.js', () => ({
  TransactionsExportHandler: class {
    execute = mockExportExecute;
  },
}));

import { registerTransactionsExportCommand } from '../transactions-export.js';

const mockAppRuntime = { tag: 'app-runtime' } as unknown as CliAppRuntime;

function createProgram(): Command {
  const program = new Command();
  registerTransactionsExportCommand(program.command('transactions'), mockAppRuntime);
  return program;
}

describe('transactions export command', () => {
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
        database: { tag: 'db' },
        profile: {
          id: 1,
          profileKey: 'default',
          displayName: 'default',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      })
    );
    mockExportExecute.mockResolvedValue(
      ok({
        transactionCount: 2,
        format: 'json',
        csvFormat: undefined,
        outputs: [{ path: 'data/transactions.json', content: '[]' }],
      })
    );
    mockWriteFilesWithAtomicRenames.mockResolvedValue(ok(['/tmp/transactions.json']));
    consoleLogSpy.mockClear();
  });

  it('outputs JSON metadata through the shared boundary', async () => {
    const program = createProgram();

    await program.parseAsync(['transactions', 'export', '--format', 'json', '--json'], { from: 'user' });

    expect(mockPrepareTransactionsCommandScope).toHaveBeenCalledWith(mockCtx, { format: 'json' });
    expect(mockExportExecute).toHaveBeenCalledWith({
      profileId: 1,
      format: 'json',
      csvFormat: undefined,
      outputPath: 'data/transactions.json',
    });
    expect(mockWriteFilesWithAtomicRenames).toHaveBeenCalledWith([{ path: 'data/transactions.json', content: '[]' }]);
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'transactions-export',
      {
        data: {
          transactionCount: 2,
          format: 'json',
          csvFormat: undefined,
          outputPaths: ['/tmp/transactions.json'],
        },
      },
      undefined
    );
  });

  it('passes annotation filters through to the export handler', async () => {
    const program = createProgram();

    await program.parseAsync(
      ['transactions', 'export', '--annotation-kind', 'bridge_participant', '--annotation-tier', 'heuristic'],
      { from: 'user' }
    );

    expect(mockExportExecute).toHaveBeenCalledWith({
      profileId: 1,
      annotationKind: 'bridge_participant',
      annotationTier: 'heuristic',
      format: 'csv',
      csvFormat: 'normalized',
      outputPath: 'data/transactions.csv',
    });
  });

  it('prints a text message when there are no transactions to export', async () => {
    const program = createProgram();
    mockExportExecute.mockResolvedValue(
      ok({
        transactionCount: 0,
        format: 'csv',
        csvFormat: 'normalized',
        outputs: [],
      })
    );

    await program.parseAsync(['transactions', 'export'], { from: 'user' });

    expect(mockWriteFilesWithAtomicRenames).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith('No transactions found to export.');
  });

  it('treats invalid format/csv combinations as invalid args before opening the runtime', async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(['transactions', 'export', '--format', 'json', '--csv-format', 'simple', '--json'], {
        from: 'user',
      })
    ).rejects.toThrow('CLI:transactions-export:json:--csv-format is only supported when --format csv is selected:2');

    expect(mockPrepareTransactionsCommandScope).not.toHaveBeenCalled();
    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  it('routes file write failures through the shared boundary', async () => {
    const program = createProgram();
    mockWriteFilesWithAtomicRenames.mockResolvedValue(err(new Error('Disk full')));

    await expect(program.parseAsync(['transactions', 'export', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:transactions-export:json:Disk full:1'
    );
  });
});
