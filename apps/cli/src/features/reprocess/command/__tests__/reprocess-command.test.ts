import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const { mockCtx, mockExitCliFailure, mockOutputSuccess, mockRunCommand, mockRunReprocess } = vi.hoisted(() => ({
  mockCtx: {
    database: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRunReprocess: vi.fn(),
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

vi.mock('../run-reprocess.js', () => ({
  runReprocess: mockRunReprocess,
}));

import { registerReprocessCommand } from '../reprocess.js';

function createProgram(): Command {
  const program = new Command();
  registerReprocessCommand(program, {} as CliAppRuntime);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();

  mockRunCommand.mockImplementation(async (appOrFn: unknown, maybeFn?: (ctx: typeof mockCtx) => Promise<void>) => {
    const fn = typeof appOrFn === 'function' ? appOrFn : maybeFn;
    await fn?.(mockCtx);
    if (!fn) {
      throw new Error('Missing runCommand callback');
    }
  });
  mockRunReprocess.mockResolvedValue(
    ok({
      processed: 5,
      errors: [],
      failed: 0,
      runStats: { totalRequests: 0 },
    })
  );
  mockExitCliFailure.mockImplementation(
    (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
    }
  );
});

describe('reprocess command', () => {
  it('does not register a --verbose flag', () => {
    const program = createProgram();
    const reprocessCommand = program.commands.find((command) => command.name() === 'reprocess');

    expect(reprocessCommand?.options.map((option) => option.long)).not.toContain('--verbose');
  });

  it('outputs JSON results through the shared boundary', async () => {
    const program = createProgram();

    await program.parseAsync(['reprocess', '--json'], { from: 'user' });

    expect(mockRunReprocess).toHaveBeenCalledWith(mockCtx, { format: 'json' }, { accountId: undefined });
    expect(mockOutputSuccess).toHaveBeenCalledOnce();

    const [, payload] = mockOutputSuccess.mock.calls[0] as [
      string,
      {
        reprocess: {
          counts: {
            processed: number;
          };
        };
        status: string;
      },
    ];

    expect(payload.status).toBe('success');
    expect(payload.reprocess.counts.processed).toBe(5);
  });

  it('treats invalid options as invalid-args failures', async () => {
    const program = createProgram();

    await expect(program.parseAsync(['reprocess', '--account-id', '0', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:reprocess:json:Too small: expected number to be >0:2'
    );

    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  it('renders warning text after a successful text-mode reprocess with processing errors', async () => {
    const program = createProgram();
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    mockRunReprocess.mockResolvedValue(
      ok({
        processed: 5,
        errors: ['Account 7 needs manual review'],
        failed: 0,
        runStats: { totalRequests: 0 },
      })
    );

    await program.parseAsync(['reprocess'], { from: 'user' });

    expect(mockOutputSuccess).not.toHaveBeenCalled();
    expect(stderrWrite).toHaveBeenCalledWith('\nFirst 5 processing errors:\n');
    expect(stderrWrite).toHaveBeenCalledWith('  • Account 7 needs manual review\n');

    stderrWrite.mockRestore();
  });

  it('routes runtime failures through the shared failure boundary', async () => {
    const program = createProgram();

    mockRunReprocess.mockResolvedValue(err(new Error('Reprocess failed')));

    await expect(program.parseAsync(['reprocess', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:reprocess:json:Reprocess failed:1'
    );
  });
});
