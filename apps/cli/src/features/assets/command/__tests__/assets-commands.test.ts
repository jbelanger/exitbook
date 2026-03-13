import { err, ok } from '@exitbook/core';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAssetsHandlerConstructor,
  mockClearReview,
  mockConfirmReview,
  mockCtx,
  mockDisplayCliError,
  mockExclude,
  mockInclude,
  mockListExclusions,
  mockOutputSuccess,
  mockOverrideStoreConstructor,
  mockOverrideStoreInstance,
  mockRunCommand,
} = vi.hoisted(() => ({
  mockAssetsHandlerConstructor: vi.fn(),
  mockClearReview: vi.fn(),
  mockConfirmReview: vi.fn(),
  mockCtx: {
    dataDir: '/tmp/exitbook-assets',
    database: vi.fn(),
    exitCode: 0,
  },
  mockDisplayCliError: vi.fn(),
  mockExclude: vi.fn(),
  mockInclude: vi.fn(),
  mockListExclusions: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockOverrideStoreConstructor: vi.fn(),
  mockOverrideStoreInstance: { tag: 'override-store' },
  mockRunCommand: vi.fn(),
}));

vi.mock('@exitbook/data', () => ({
  OverrideStore: vi.fn().mockImplementation(function MockOverrideStore(...args: unknown[]) {
    mockOverrideStoreConstructor(...args);
    return mockOverrideStoreInstance;
  }),
}));

vi.mock('../../../shared/command-runtime.js', () => ({
  runCommand: mockRunCommand,
}));

vi.mock('../../../shared/cli-error.js', () => ({
  displayCliError: mockDisplayCliError,
}));

vi.mock('../../../shared/json-output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../assets-handler.js', () => ({
  AssetsHandler: vi.fn().mockImplementation(function MockAssetsHandler(...args: unknown[]) {
    mockAssetsHandlerConstructor(...args);
    return {
      clearReview: mockClearReview,
      confirmReview: mockConfirmReview,
      exclude: mockExclude,
      include: mockInclude,
      listExclusions: mockListExclusions,
    };
  }),
}));

import { registerAssetsClearReviewCommand } from '../assets-clear-review.js';
import { registerAssetsConfirmCommand } from '../assets-confirm.js';
import { registerAssetsExcludeCommand } from '../assets-exclude.js';
import { registerAssetsExclusionsCommand } from '../assets-exclusions.js';
import { registerAssetsIncludeCommand } from '../assets-include.js';

function createAssetsProgram(): Command {
  const program = new Command();
  const assets = program.command('assets');
  registerAssetsClearReviewCommand(assets);
  registerAssetsConfirmCommand(assets);
  registerAssetsExcludeCommand(assets);
  registerAssetsExclusionsCommand(assets);
  registerAssetsIncludeCommand(assets);
  return program;
}

describe('assets command modules', () => {
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

  it('runs clear-review in JSON mode and outputs the handler result', async () => {
    const program = createAssetsProgram();
    const result = {
      assetId: 'asset-1',
      assetSymbols: ['ETH'],
      changed: true,
      reviewStatus: 'not-reviewed',
      reason: 'reset evidence',
    };
    mockClearReview.mockResolvedValue(ok(result));

    await program.parseAsync(
      ['assets', 'clear-review', '--asset-id', 'asset-1', '--reason', 'reset evidence', '--json'],
      {
        from: 'user',
      }
    );

    expect(mockOverrideStoreConstructor).toHaveBeenCalledWith('/tmp/exitbook-assets');
    expect(mockAssetsHandlerConstructor).toHaveBeenCalledWith(
      { tag: 'db' },
      mockOverrideStoreInstance,
      '/tmp/exitbook-assets'
    );
    expect(mockClearReview).toHaveBeenCalledWith({
      assetId: 'asset-1',
      symbol: undefined,
      reason: 'reset evidence',
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith('assets-clear-review', result);
  });

  it('prints confirm guidance when the asset remains accounting-blocked after review confirmation', async () => {
    const program = createAssetsProgram();
    mockConfirmReview.mockResolvedValue(
      ok({
        assetId: 'asset-2',
        assetSymbols: ['USDC'],
        changed: true,
        reviewStatus: 'confirmed-safe',
        accountingBlocked: true,
        reason: 'ambiguous symbol',
        evidence: [{ kind: 'same-symbol-ambiguity' }],
      })
    );

    await program.parseAsync(['assets', 'confirm', '--symbol', 'USDC'], { from: 'user' });

    expect(mockConfirmReview).toHaveBeenCalledWith({
      assetId: undefined,
      symbol: 'USDC',
      reason: undefined,
    });
    expect(consoleLogSpy).toHaveBeenCalledWith('Asset review confirmed');
    expect(consoleLogSpy).toHaveBeenCalledWith('   Accounting: blocked');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Confirmation recorded, but accounting is still blocked until one conflicting contract is excluded.'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('Run: assets exclude --asset-id <conflicting-asset-id>');
  });

  it('routes exclude option validation failures through the JSON error path', async () => {
    const program = createAssetsProgram();

    await expect(program.parseAsync(['assets', 'exclude', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:assets-exclude:json:Either --asset-id or --symbol is required'
    );

    expect(mockDisplayCliError).toHaveBeenCalledWith('assets-exclude', expect.any(Error), 2, 'json');
    expect(mockExclude).not.toHaveBeenCalled();
  });

  it('prints excluded asset rows in text mode', async () => {
    const program = createAssetsProgram();
    mockListExclusions.mockResolvedValue(
      ok({
        excludedAssets: [
          {
            assetId: 'asset-3',
            assetSymbols: ['BTC'],
            transactionCount: 3,
            movementCount: 5,
          },
          {
            assetId: 'asset-4',
            assetSymbols: [],
            transactionCount: 1,
            movementCount: 1,
          },
        ],
      })
    );

    await program.parseAsync(['assets', 'exclusions'], { from: 'user' });

    expect(consoleLogSpy).toHaveBeenCalledWith('Excluded assets (2):');
    expect(consoleLogSpy).toHaveBeenCalledWith('- BTC  asset-3  3 txs  5 movements');
    expect(consoleLogSpy).toHaveBeenCalledWith('- (unknown)  asset-4  1 txs  1 movements');
  });

  it('routes include handler failures through the JSON CLI error path', async () => {
    const program = createAssetsProgram();
    const includeError = new Error('override write failed');
    mockInclude.mockResolvedValue(err(includeError));

    await expect(
      program.parseAsync(['assets', 'include', '--asset-id', 'asset-5', '--json'], { from: 'user' })
    ).rejects.toThrow('CLI:assets-include:json:override write failed');

    expect(mockInclude).toHaveBeenCalledWith({
      assetId: 'asset-5',
      symbol: undefined,
      reason: undefined,
    });
    expect(mockDisplayCliError).toHaveBeenCalledWith('assets-include', includeError, 1, 'json');
  });
});
