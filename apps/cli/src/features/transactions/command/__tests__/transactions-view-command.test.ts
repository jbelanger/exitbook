import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockComputeCategoryCounts,
  mockCreateTransactionsViewState,
  mockCtx,
  mockExitCliFailure,
  mockExportExecute,
  mockOutputSuccess,
  mockReadTransactionsForCommand,
  mockRenderApp,
  mockResolveCommandProfile,
  mockRunCommand,
  mockToTransactionViewItem,
  mockWriteFilesWithAtomicRenames,
} = vi.hoisted(() => ({
  mockComputeCategoryCounts: vi.fn(),
  mockCreateTransactionsViewState: vi.fn(),
  mockCtx: {
    database: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockExportExecute: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockReadTransactionsForCommand: vi.fn(),
  mockRenderApp: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunCommand: vi.fn(),
  mockToTransactionViewItem: vi.fn(),
  mockWriteFilesWithAtomicRenames: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  renderApp: mockRenderApp,
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

vi.mock('../../../profiles/profile-resolution.js', () => ({
  resolveCommandProfile: mockResolveCommandProfile,
}));

vi.mock('../transactions-read-support.js', () => ({
  readTransactionsForCommand: mockReadTransactionsForCommand,
}));

vi.mock('../transactions-view-utils.js', () => ({
  buildTransactionsJsonFilters: vi.fn(
    (params: {
      assetSymbol?: string | undefined;
      noPrice?: boolean | undefined;
      operationType?: string | undefined;
      platform?: string | undefined;
      since?: string | undefined;
      until?: string | undefined;
    }) => {
      const filters = Object.fromEntries(
        Object.entries({
          platform: params.platform,
          asset: params.assetSymbol,
          since: params.since,
          until: params.until,
          operationType: params.operationType,
          noPrice: params.noPrice ? true : undefined,
        }).filter(([, value]) => value !== undefined)
      );

      return Object.keys(filters).length > 0 ? filters : undefined;
    }
  ),
  buildTransactionsViewFilters: vi.fn(
    (params: {
      assetSymbol?: string | undefined;
      noPrice?: boolean | undefined;
      operationType?: string | undefined;
      platform?: string | undefined;
    }) => ({
      platformFilter: params.platform,
      assetFilter: params.assetSymbol,
      operationTypeFilter: params.operationType,
      noPriceFilter: params.noPrice,
    })
  ),
  generateDefaultPath: vi.fn(() => 'data/kraken-transactions.json'),
  parseSinceToUnixSeconds: vi.fn((since: string | undefined) => {
    if (!since) {
      return ok(undefined);
    }

    const date = new Date(since);
    if (Number.isNaN(date.getTime())) {
      return err(new Error(`Invalid date format: ${since}`));
    }

    return ok(Math.floor(date.getTime() / 1000));
  }),
  validateUntilDate: vi.fn((until: string | undefined) => {
    if (!until) {
      return ok(undefined);
    }

    const date = new Date(until);
    if (Number.isNaN(date.getTime())) {
      return err(new Error(`Invalid date format: ${until}`));
    }

    return ok(undefined);
  }),
}));

vi.mock('../../transaction-view-projection.js', () => ({
  toTransactionViewItem: mockToTransactionViewItem,
}));

vi.mock('../transactions-export-handler.js', () => ({
  TransactionsExportHandler: class {
    execute = mockExportExecute;
  },
}));

vi.mock('../../view/index.js', () => ({
  TransactionsViewApp: 'TransactionsViewApp',
  computeCategoryCounts: mockComputeCategoryCounts,
  createTransactionsViewState: mockCreateTransactionsViewState,
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
    mockReadTransactionsForCommand.mockResolvedValue(ok([{ id: 1 }, { id: 2 }]));
    mockToTransactionViewItem.mockImplementation((transaction: { id: number }) => ({
      id: transaction.id,
      platformKey: 'kraken',
    }));
    mockComputeCategoryCounts.mockReturnValue({ trade: 2 });
    mockCreateTransactionsViewState.mockReturnValue({ tag: 'view-state' });
    mockExportExecute.mockResolvedValue(
      ok({
        outputs: [{ path: '/tmp/transactions.json', content: '{}' }],
        transactionCount: 2,
        format: 'json',
        csvFormat: undefined,
      })
    );
    mockWriteFilesWithAtomicRenames.mockResolvedValue(ok(['/tmp/transactions.json']));
  });

  it('outputs JSON through the shared boundary with the normalized command id', async () => {
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
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'transactions-view',
      {
        data: [
          { id: 1, platformKey: 'kraken' },
          { id: 2, platformKey: 'kraken' },
        ],
        meta: {
          count: 2,
          offset: 0,
          limit: 50,
          hasMore: false,
          filters: {
            platform: 'kraken',
          },
        },
      },
      undefined
    );
  });

  it('treats invalid --until values as invalid-args failures before loading transactions', async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(['transactions', 'view', '--until', 'not-a-date', '--json'], { from: 'user' })
    ).rejects.toThrow('CLI:transactions-view:json:Invalid date format: not-a-date:2');

    expect(mockReadTransactionsForCommand).not.toHaveBeenCalled();
  });

  it('renders the TUI and preserves the parsed --since filter for inline export', async () => {
    const program = createProgram();
    let renderedElement: ReactElement | undefined;

    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      renderedElement = create(() => undefined);
    });

    await program.parseAsync(['transactions', 'view', '--platform', 'kraken', '--since', '2024-01-15'], {
      from: 'user',
    });

    expect(mockRenderApp).toHaveBeenCalledOnce();
    expect(renderedElement?.type).toBe('TransactionsViewApp');
    const appElement = renderedElement as ReactElement<{
      onExport: (format: 'json' | 'csv', csvFormat?: 'normalized' | 'simple') => Promise<unknown>;
    }>;
    const exportResult = await appElement.props.onExport('json', undefined);
    expect(mockExportExecute).toHaveBeenCalledWith({
      profileId: 1,
      platformKey: 'kraken',
      format: 'json',
      csvFormat: undefined,
      outputPath: 'data/kraken-transactions.json',
      since: Math.floor(new Date('2024-01-15').getTime() / 1000),
      until: undefined,
      assetSymbol: undefined,
      operationType: undefined,
      noPrice: undefined,
    });
    expect(mockWriteFilesWithAtomicRenames).toHaveBeenCalledWith([{ path: '/tmp/transactions.json', content: '{}' }]);
    expect(exportResult).toEqual(
      ok({
        outputPaths: ['/tmp/transactions.json'],
        transactionCount: 2,
      })
    );
  });
});
