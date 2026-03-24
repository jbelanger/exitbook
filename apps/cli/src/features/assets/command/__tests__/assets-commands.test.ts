import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetsViewState } from '../../view/assets-view-state.js';
import type { AssetOverrideResult, AssetReviewOverrideResult } from '../assets-handler.js';

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
  mockRenderApp,
  mockRunCommand,
  mockView,
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
  mockRenderApp: vi.fn(),
  mockRunCommand: vi.fn(),
  mockView: vi.fn(),
}));

vi.mock('@exitbook/data/overrides', () => ({
  OverrideStore: vi.fn().mockImplementation(function MockOverrideStore(...args: unknown[]) {
    mockOverrideStoreConstructor(...args);
    return mockOverrideStoreInstance;
  }),
}));

vi.mock('../../../../runtime/command-scope.js', () => ({
  renderApp: mockRenderApp,
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
      view: mockView,
    };
  }),
}));

vi.mock('../../view/assets-view-components.jsx', () => ({
  AssetsViewApp: 'AssetsViewApp',
}));

import { registerAssetsCommand } from '../assets.js';

interface AssetsViewAppProps {
  initialState: AssetsViewState;
  onClearReview: (assetId: string) => Promise<AssetReviewOverrideResult>;
  onConfirmReview: (assetId: string) => Promise<AssetReviewOverrideResult>;
  onQuit: () => void;
  onToggleExclusion: (assetId: string, excluded: boolean) => Promise<AssetOverrideResult>;
}

function createAssetsProgram(): Command {
  const program = new Command();
  registerAssetsCommand(program);
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
    mockRenderApp.mockReset();
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

  it('outputs asset view JSON with action-required metadata', async () => {
    const program = createAssetsProgram();
    mockView.mockResolvedValue(
      ok({
        assets: [
          {
            assetId: 'asset-view-1',
            assetSymbols: ['SCAM'],
            accountingBlocked: true,
            confirmationIsStale: false,
            currentQuantity: '100',
            evidence: [{ kind: 'spam-flag', severity: 'error', message: 'flagged' }],
            evidenceFingerprint: 'fingerprint-1',
            excluded: false,
            movementCount: 2,
            referenceStatus: 'unknown',
            reviewStatus: 'needs-review',
            warningSummary: 'flagged',
            transactionCount: 1,
          },
        ],
        totalCount: 3,
        excludedCount: 1,
        actionRequiredCount: 1,
      })
    );

    await program.parseAsync(['assets', 'view', '--action-required', '--json'], { from: 'user' });

    expect(mockView).toHaveBeenCalledWith({ actionRequiredOnly: true });
    expect(mockOutputSuccess).toHaveBeenCalledWith('assets-view', {
      data: [
        {
          assetId: 'asset-view-1',
          assetSymbols: ['SCAM'],
          accountingBlocked: true,
          confirmationIsStale: false,
          currentQuantity: '100',
          evidence: [{ kind: 'spam-flag', severity: 'error', message: 'flagged' }],
          evidenceFingerprint: 'fingerprint-1',
          excluded: false,
          movementCount: 2,
          referenceStatus: 'unknown',
          reviewStatus: 'needs-review',
          warningSummary: 'flagged',
          transactionCount: 1,
        },
      ],
      meta: {
        count: 1,
        offset: 0,
        limit: 1,
        hasMore: true,
        filters: { actionRequired: true },
      },
    });
  });

  it('renders the assets TUI and wires action callbacks to handler methods', async () => {
    const program = createAssetsProgram();
    let renderedElement: ReactElement<AssetsViewAppProps> | undefined;

    mockView.mockResolvedValue(
      ok({
        assets: [
          {
            assetId: 'asset-view-2',
            assetSymbols: ['TOKEN'],
            accountingBlocked: false,
            confirmationIsStale: false,
            currentQuantity: '5',
            evidence: [],
            evidenceFingerprint: undefined,
            excluded: false,
            movementCount: 4,
            referenceStatus: 'matched',
            reviewStatus: 'clear',
            warningSummary: undefined,
            transactionCount: 2,
          },
        ],
        totalCount: 1,
        excludedCount: 0,
        actionRequiredCount: 0,
      })
    );
    mockExclude.mockResolvedValue(
      ok({ assetId: 'asset-view-2', assetSymbols: ['TOKEN'], action: 'exclude', changed: true })
    );
    mockConfirmReview.mockResolvedValue(
      ok({
        action: 'confirm',
        accountingBlocked: false,
        assetId: 'asset-view-2',
        assetSymbols: ['TOKEN'],
        changed: true,
        confirmationIsStale: false,
        evidence: [],
        evidenceFingerprint: 'fingerprint-2',
        referenceStatus: 'matched',
        reviewStatus: 'reviewed',
        warningSummary: undefined,
      })
    );
    mockClearReview.mockResolvedValue(
      ok({
        action: 'clear-review',
        accountingBlocked: true,
        assetId: 'asset-view-2',
        assetSymbols: ['TOKEN'],
        changed: true,
        confirmationIsStale: false,
        evidence: [{ kind: 'spam-flag', severity: 'error', message: 'flagged' }],
        evidenceFingerprint: 'fingerprint-3',
        referenceStatus: 'unknown',
        reviewStatus: 'needs-review',
        warningSummary: 'flagged',
      })
    );
    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      renderedElement = create(() => undefined) as ReactElement<AssetsViewAppProps>;
    });

    await program.parseAsync(['assets', 'view', '--needs-review'], { from: 'user' });

    expect(mockRenderApp).toHaveBeenCalledOnce();
    expect(renderedElement?.type).toBe('AssetsViewApp');
    expect(renderedElement?.props.initialState.filter).toBe('action-required');
    expect(renderedElement?.props.initialState.totalCount).toBe(1);
    expect(renderedElement?.props.initialState.excludedCount).toBe(0);
    expect(renderedElement?.props.initialState.actionRequiredCount).toBe(0);
    expect(renderedElement?.props.initialState.filteredAssets).toEqual([]);
    expect(renderedElement?.props.initialState.assets).toHaveLength(1);

    await renderedElement?.props.onToggleExclusion('asset-view-2', false);
    await renderedElement?.props.onConfirmReview('asset-view-2');
    await renderedElement?.props.onClearReview('asset-view-2');

    expect(mockExclude).toHaveBeenCalledWith({ assetId: 'asset-view-2' });
    expect(mockConfirmReview).toHaveBeenCalledWith({ assetId: 'asset-view-2' });
    expect(mockClearReview).toHaveBeenCalledWith({ assetId: 'asset-view-2' });
  });

  it('registers the assets namespace with the expected subcommands', () => {
    const program = createAssetsProgram();
    const assetsCommand = program.commands.find((command) => command.name() === 'assets');

    expect(assetsCommand).toBeDefined();
    expect(assetsCommand?.commands.map((command) => command.name())).toEqual([
      'view',
      'confirm',
      'clear-review',
      'exclude',
      'include',
      'exclusions',
    ]);
  });
});
