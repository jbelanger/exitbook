import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const {
  mockBuildAssetIdsBySymbol,
  mockBuildTransactionItems,
  mockCreatePortfolioAssetsState,
  mockCreateSpinner,
  mockExitCliFailure,
  mockFilterTransactionsForAssets,
  mockOutputSuccess,
  mockRenderApp,
  mockRunCommand,
  mockRunPortfolio,
  mockStopSpinner,
  mockWithPortfolioCommandScope,
} = vi.hoisted(() => ({
  mockBuildAssetIdsBySymbol: vi.fn(),
  mockBuildTransactionItems: vi.fn(),
  mockCreatePortfolioAssetsState: vi.fn(),
  mockCreateSpinner: vi.fn(),
  mockExitCliFailure: vi.fn(),
  mockFilterTransactionsForAssets: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockRenderApp: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRunPortfolio: vi.fn(),
  mockStopSpinner: vi.fn(),
  mockWithPortfolioCommandScope: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  renderApp: mockRenderApp,
  runCommand: mockRunCommand,
}));

vi.mock('../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../shared/spinner.js', () => ({
  createSpinner: mockCreateSpinner,
  stopSpinner: mockStopSpinner,
}));

vi.mock('../portfolio-command-scope.js', () => ({
  withPortfolioCommandScope: mockWithPortfolioCommandScope,
}));

vi.mock('../run-portfolio.js', () => ({
  runPortfolio: mockRunPortfolio,
}));

vi.mock('../../shared/portfolio-history-utils.js', () => ({
  buildAssetIdsBySymbol: mockBuildAssetIdsBySymbol,
  buildTransactionItems: mockBuildTransactionItems,
  filterTransactionsForAssets: mockFilterTransactionsForAssets,
}));

vi.mock('../../view/index.js', () => ({
  PortfolioApp: 'PortfolioApp',
  createPortfolioAssetsState: mockCreatePortfolioAssetsState,
}));

import { registerPortfolioCommand } from '../portfolio.js';

interface MockCtx {
  closeDatabase: ReturnType<typeof vi.fn>;
  database: ReturnType<typeof vi.fn>;
}

function createProgram(): Command {
  const program = new Command();
  registerPortfolioCommand(program, {
    blockchainExplorersConfig: {},
  } as CliAppRuntime);
  return program;
}

describe('portfolio command', () => {
  const ctx: MockCtx = {
    closeDatabase: vi.fn(),
    database: vi.fn(),
  };
  const scope = {
    handler: {},
    profile: {
      id: 1,
      profileKey: 'default',
      displayName: 'default',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    },
  };
  const portfolioResult = {
    asOf: '2026-03-30T00:00:00.000Z',
    method: 'fifo',
    jurisdiction: 'US',
    displayCurrency: 'USD',
    totalValue: '100',
    totalCost: '80',
    totalUnrealizedGainLoss: '20',
    totalUnrealizedPct: '25',
    totalRealizedGainLossAllTime: '10',
    totalNetFiatIn: '70',
    positions: [
      {
        assetId: 'btc',
        assetSymbol: 'BTC',
        sourceAssetIds: undefined,
      },
    ],
    closedPositions: [],
    warnings: [],
    meta: { calculationId: 'calc-1' },
    transactions: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunCommand.mockImplementation(async (appOrFn: unknown, maybeFn?: (runtime: MockCtx) => Promise<void>) => {
      const fn = typeof appOrFn === 'function' ? appOrFn : maybeFn;
      await fn?.(ctx);
    });
    mockWithPortfolioCommandScope.mockImplementation(
      async (_ctx: unknown, _options: unknown, operation: (value: typeof scope) => Promise<unknown>) => operation(scope)
    );
    mockRunPortfolio.mockResolvedValue(ok(portfolioResult));
    mockBuildAssetIdsBySymbol.mockReturnValue(new Map());
    mockFilterTransactionsForAssets.mockReturnValue([]);
    mockBuildTransactionItems.mockReturnValue([]);
    mockCreatePortfolioAssetsState.mockReturnValue({ tag: 'portfolio-state' });
    mockCreateSpinner.mockReturnValue({ text: 'spinner' });
    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      create(() => undefined);
    });
    mockExitCliFailure.mockImplementation(
      (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
      }
    );
  });

  it('outputs JSON through the shared boundary', async () => {
    const program = createProgram();

    await program.parseAsync(['portfolio', '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'portfolio',
      {
        data: {
          asOf: '2026-03-30T00:00:00.000Z',
          method: 'fifo',
          jurisdiction: 'US',
          displayCurrency: 'USD',
          totalValue: '100',
          totalCost: '80',
          totalUnrealizedGainLoss: '20',
          totalUnrealizedPct: '25',
          totalRealizedGainLossAllTime: '10',
          totalNetFiatIn: '70',
          positions: portfolioResult.positions,
          closedPositions: [],
        },
        warnings: [],
        meta: { calculationId: 'calc-1' },
      },
      undefined
    );
  });

  it('renders the portfolio TUI after calculation', async () => {
    const program = createProgram();
    let renderedElement: ReactElement | undefined;

    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      renderedElement = create(() => undefined);
    });

    await program.parseAsync(['portfolio'], { from: 'user' });

    expect(mockCreateSpinner).toHaveBeenCalledWith('Calculating portfolio...', false);
    expect(mockStopSpinner).toHaveBeenCalled();
    expect(ctx.closeDatabase).toHaveBeenCalledOnce();
    expect(renderedElement?.type).toBe('PortfolioApp');
  });

  it('rejects invalid as-of timestamps before entering the runtime', async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(['portfolio', '--as-of', 'not-a-date', '--json'], { from: 'user' })
    ).rejects.toThrow('CLI:portfolio:json:Invalid --as-of datetime. Use an ISO 8601 timestamp.:2');

    expect(mockRunCommand).not.toHaveBeenCalled();
    expect(mockExitCliFailure).toHaveBeenCalledWith('portfolio', expect.objectContaining({ exitCode: 2 }), 'json');
  });

  it('routes calculation failures through the shared boundary', async () => {
    const program = createProgram();
    const failure = new Error('portfolio failed');
    mockRunPortfolio.mockResolvedValue(err(failure));

    await expect(program.parseAsync(['portfolio', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:portfolio:json:portfolio failed:1'
    );

    expect(mockExitCliFailure).toHaveBeenCalledWith(
      'portfolio',
      expect.objectContaining({ error: failure, exitCode: 1 }),
      'json'
    );
  });
});
