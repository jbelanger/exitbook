/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- Vitest command-boundary mocks intentionally use partial test doubles and matcher objects. */
import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCtx,
  mockExecute,
  mockExecuteCoverageDetail,
  mockExecuteMissing,
  mockExitCliFailure,
  mockOutputSuccess,
  mockRenderApp,
  mockResolveCommandProfile,
  mockRunCommand,
  mockWithCommandPriceProviderRuntime,
} = vi.hoisted(() => ({
  mockCtx: {
    dataDir: '/tmp/exitbook-test',
    database: vi.fn(),
    openDatabaseSession: vi.fn(),
    closeDatabaseSession: vi.fn(),
  },
  mockExecute: vi.fn(),
  mockExecuteCoverageDetail: vi.fn(),
  mockExecuteMissing: vi.fn(),
  mockExitCliFailure: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockRenderApp: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunCommand: vi.fn(),
  mockWithCommandPriceProviderRuntime: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  renderApp: mockRenderApp,
  runCommand: mockRunCommand,
  withCommandPriceProviderRuntime: mockWithCommandPriceProviderRuntime,
}));

vi.mock('../../../profiles/profile-resolution.js', () => ({
  resolveCommandProfile: mockResolveCommandProfile,
}));

vi.mock('../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../prices-view-handler.js', () => ({
  PricesViewHandler: class {
    execute = mockExecute;
    executeCoverageDetail = mockExecuteCoverageDetail;
    executeMissing = mockExecuteMissing;
  },
}));

vi.mock('../../view/index.js', () => ({
  PricesViewApp: 'PricesViewApp',
  createCoverageViewState: vi.fn((coverage, summary, assetFilter, platformFilter) => ({
    mode: 'coverage',
    coverage,
    summary,
    selectedIndex: 0,
    scrollOffset: 0,
    assetFilter,
    platformFilter,
  })),
  createMissingViewState: vi.fn((movements, assetBreakdown, assetFilter, platformFilter) => ({
    mode: 'missing',
    movements,
    assetBreakdown,
    selectedIndex: 0,
    scrollOffset: 0,
    resolvedRows: new Set(),
    assetFilter,
    platformFilter,
  })),
}));

import { registerPricesViewCommand } from '../prices-view.js';

function createProgram(): Command {
  const program = new Command();
  const prices = program.command('prices');
  registerPricesViewCommand(prices);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCtx.openDatabaseSession.mockResolvedValue({});
  mockCtx.closeDatabaseSession.mockResolvedValue(undefined);

  mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
    await fn(mockCtx);
  });
  mockWithCommandPriceProviderRuntime.mockImplementation(async (_ctx, _options, operation) =>
    operation({ tag: 'price-runtime' })
  );
  mockResolveCommandProfile.mockResolvedValue(
    ok({
      id: 1,
      profileKey: 'default',
      displayName: 'default',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
  );
  mockExecute.mockResolvedValue(
    ok({
      coverage: [
        {
          assetSymbol: 'BTC',
          total_transactions: 3,
          with_price: 2,
          missing_price: 1,
          coverage_percentage: 66.6667,
        },
      ],
      summary: {
        total_transactions: 3,
        with_price: 2,
        missing_price: 1,
        overall_coverage_percentage: 66.6667,
      },
    })
  );
  mockExecuteCoverageDetail.mockResolvedValue(
    ok([
      {
        assetSymbol: 'BTC',
        total_transactions: 3,
        with_price: 2,
        missing_price: 1,
        coverage_percentage: 66.6667,
        sources: [{ name: 'kraken', count: 3 }],
        missingSources: [{ name: 'kraken', count: 1 }],
        dateRange: {
          earliest: '2024-01-15T00:00:00Z',
          latest: '2024-01-16T00:00:00Z',
        },
      },
    ])
  );
  mockExecuteMissing.mockResolvedValue(
    ok({
      movements: [
        {
          transactionId: 7,
          source: 'kraken',
          datetime: '2024-01-15T00:00:00Z',
          assetSymbol: 'BTC',
          amount: '1.5',
          direction: 'inflow',
          operationLabel: 'trade/buy',
        },
      ],
      assetBreakdown: [
        {
          assetSymbol: 'BTC',
          count: 1,
          sources: [{ name: 'kraken', count: 1 }],
        },
      ],
    })
  );
  mockExitCliFailure.mockImplementation(
    (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
    }
  );
});

describe('prices view command', () => {
  it('outputs JSON coverage results through the shared boundary', async () => {
    const program = createProgram();

    await program.parseAsync(['prices', 'view', '--asset', 'BTC', '--json'], { from: 'user' });

    expect(mockExecute).toHaveBeenCalledWith({
      asset: 'BTC',
      platform: undefined,
      missingOnly: undefined,
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'prices-view',
      expect.objectContaining({
        data: expect.objectContaining({
          coverage: expect.any(Array),
          summary: expect.objectContaining({
            total_transactions: 3,
          }),
        }),
      }),
      undefined
    );
  });

  it('outputs JSON missing-price results when --missing-only is set', async () => {
    const program = createProgram();

    await program.parseAsync(['prices', 'view', '--missing-only', '--json'], { from: 'user' });

    expect(mockExecuteMissing).toHaveBeenCalledWith({
      asset: undefined,
      platform: undefined,
      missingOnly: true,
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'prices-view',
      expect.objectContaining({
        data: expect.objectContaining({
          assetBreakdown: expect.any(Array),
          movements: [
            expect.objectContaining({
              transactionId: 7,
              operationLabel: 'trade/buy',
            }),
          ],
        }),
      }),
      undefined
    );
  });

  it('renders the TUI in text mode through the runtime-scoped flow', async () => {
    const program = createProgram();
    let renderedElement: ReactElement | undefined;

    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      renderedElement = create(() => undefined);
    });

    await program.parseAsync(['prices', 'view'], { from: 'user' });

    expect(mockExecuteCoverageDetail).toHaveBeenCalledWith({
      asset: undefined,
      platform: undefined,
      missingOnly: undefined,
    });
    expect(mockWithCommandPriceProviderRuntime).toHaveBeenCalledOnce();
    expect(mockRenderApp).toHaveBeenCalledOnce();
    expect(renderedElement?.type).toBe('PricesViewApp');
    expect(mockOutputSuccess).not.toHaveBeenCalled();
  });

  it('routes profile-resolution failures through the shared boundary', async () => {
    const program = createProgram();

    mockResolveCommandProfile.mockResolvedValue(err(new Error('Profile lookup failed')));

    await expect(program.parseAsync(['prices', 'view', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:prices-view:json:Profile lookup failed:1'
    );
  });
});
