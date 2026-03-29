import { ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCtx,
  mockDisplayCliError,
  mockOutputSuccess,
  mockReadTransactionsForCommand,
  mockResolveCommandProfile,
  mockRunCommand,
  mockToTransactionViewItem,
} = vi.hoisted(() => ({
  mockCtx: {
    database: vi.fn(),
    exitCode: 0,
  },
  mockDisplayCliError: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockReadTransactionsForCommand: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunCommand: vi.fn(),
  mockToTransactionViewItem: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  renderApp: vi.fn(),
  runCommand: mockRunCommand,
}));

vi.mock('../../../shared/cli-error.js', () => ({
  displayCliError: mockDisplayCliError,
}));

vi.mock('../../../shared/json-output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../profiles/profile-resolution.js', () => ({
  resolveCommandProfile: mockResolveCommandProfile,
}));

vi.mock('../transactions-read-support.js', () => ({
  readTransactionsForCommand: mockReadTransactionsForCommand,
}));

vi.mock('../transactions-view-utils.js', () => ({
  generateDefaultPath: vi.fn(),
  toTransactionViewItem: mockToTransactionViewItem,
}));

vi.mock('../../view/index.js', () => ({
  TransactionsViewApp: 'TransactionsViewApp',
  computeCategoryCounts: vi.fn(),
  createTransactionsViewState: vi.fn(),
}));

import { registerTransactionsViewCommand } from '../transactions-view.js';

function createProgram(): Command {
  const program = new Command();
  registerTransactionsViewCommand(program.command('transactions'));
  return program;
}

describe('transactions view command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx.database.mockResolvedValue({ tag: 'db' });
    mockCtx.exitCode = 0;
    mockResolveCommandProfile.mockResolvedValue(
      ok({ id: 1, profileKey: 'default', displayName: 'default', createdAt: new Date('2026-03-01T00:00:00.000Z') })
    );
    mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
      await fn(mockCtx);
    });
    mockDisplayCliError.mockImplementation(
      (command: string, error: Error, _exitCode: number, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${error.message}`);
      }
    );
    mockReadTransactionsForCommand.mockResolvedValue(ok([{ id: 1 }]));
    mockToTransactionViewItem.mockReturnValue({ id: 1, platformKey: 'kraken' });
  });

  it('uses --platform as the primary transaction platform filter', async () => {
    const program = createProgram();

    await program.parseAsync(['transactions', 'view', '--platform', 'kraken', '--json'], { from: 'user' });

    expect(mockReadTransactionsForCommand).toHaveBeenCalledWith({
      db: { tag: 'db' },
      profileId: 1,
      platformKey: 'kraken',
      since: undefined,
      until: undefined,
      assetSymbol: undefined,
      operationType: undefined,
      noPrice: undefined,
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith('view-transactions', {
      data: [{ id: 1, platformKey: 'kraken' }],
      meta: {
        count: 1,
        offset: 0,
        limit: 50,
        hasMore: false,
        filters: {
          platform: 'kraken',
        },
      },
    });
  });
});
