import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetsViewState } from '../../view/assets-view-state.js';
import type { AssetOverrideResult, AssetReviewOverrideResult } from '../assets-types.js';

const {
  mockCtx,
  mockDisplayCliError,
  mockOutputSuccess,
  mockRenderApp,
  mockRunAssetsClearReview,
  mockRunAssetsConfirmReview,
  mockRunAssetsExclude,
  mockRunAssetsExclusions,
  mockRunAssetsInclude,
  mockRunAssetsView,
  mockRunCommand,
  mockWithAssetsCommandScope,
} = vi.hoisted(() => ({
  mockCtx: {
    dataDir: '/tmp/exitbook-assets',
    database: vi.fn(),
    exitCode: 0,
  },
  mockDisplayCliError: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockRenderApp: vi.fn(),
  mockRunAssetsClearReview: vi.fn(),
  mockRunAssetsConfirmReview: vi.fn(),
  mockRunAssetsExclude: vi.fn(),
  mockRunAssetsExclusions: vi.fn(),
  mockRunAssetsInclude: vi.fn(),
  mockRunAssetsView: vi.fn(),
  mockRunCommand: vi.fn(),
  mockWithAssetsCommandScope: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  renderApp: mockRenderApp,
  runCommand: mockRunCommand,
}));

vi.mock('../../../shared/cli-error.js', () => ({
  displayCliError: mockDisplayCliError,
}));

vi.mock('../../../shared/json-output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../assets-command-scope.js', () => ({
  withAssetsCommandScope: mockWithAssetsCommandScope,
}));

vi.mock('../run-assets.js', () => ({
  runAssetsClearReview: mockRunAssetsClearReview,
  runAssetsConfirmReview: mockRunAssetsConfirmReview,
  runAssetsExclude: mockRunAssetsExclude,
  runAssetsExclusions: mockRunAssetsExclusions,
  runAssetsInclude: mockRunAssetsInclude,
  runAssetsView: mockRunAssetsView,
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
  const PROFILE_KEY = 'default';
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const assetsScope = {
    overrideService: {},
    profile: {
      id: 1,
      profileKey: PROFILE_KEY,
      displayName: PROFILE_KEY,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    },
    snapshotReader: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx.database.mockResolvedValue({ tag: 'db' });
    mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
      await fn(mockCtx);
    });
    mockWithAssetsCommandScope.mockImplementation(
      async (_ctx: unknown, operation: (scope: typeof assetsScope) => Promise<unknown>) => operation(assetsScope)
    );
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
    mockRunAssetsClearReview.mockResolvedValue(ok(result));

    await program.parseAsync(
      ['assets', 'clear-review', '--asset-id', 'asset-1', '--reason', 'reset evidence', '--json'],
      {
        from: 'user',
      }
    );

    expect(mockRunAssetsClearReview).toHaveBeenCalledWith(assetsScope, {
      assetId: 'asset-1',
      symbol: undefined,
      reason: 'reset evidence',
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith('assets-clear-review', result);
  });

  it('prints confirm guidance when the asset remains accounting-blocked after review confirmation', async () => {
    const program = createAssetsProgram();
    mockRunAssetsConfirmReview.mockResolvedValue(
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

    expect(mockRunAssetsConfirmReview).toHaveBeenCalledWith(assetsScope, {
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
    expect(mockRunAssetsExclude).not.toHaveBeenCalled();
  });

  it('prints excluded asset rows in text mode', async () => {
    const program = createAssetsProgram();
    mockRunAssetsExclusions.mockResolvedValue(
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

    expect(mockRunAssetsExclusions).toHaveBeenCalledWith(assetsScope);
    expect(consoleLogSpy).toHaveBeenCalledWith('Excluded assets (2):');
    expect(consoleLogSpy).toHaveBeenCalledWith('- BTC  asset-3  3 txs  5 movements');
    expect(consoleLogSpy).toHaveBeenCalledWith('- (unknown)  asset-4  1 txs  1 movements');
  });

  it('routes include handler failures through the JSON CLI error path', async () => {
    const program = createAssetsProgram();
    const includeError = new Error('override write failed');
    mockRunAssetsInclude.mockResolvedValue(err(includeError));

    await expect(
      program.parseAsync(['assets', 'include', '--asset-id', 'asset-5', '--json'], { from: 'user' })
    ).rejects.toThrow('CLI:assets-include:json:override write failed');

    expect(mockRunAssetsInclude).toHaveBeenCalledWith(assetsScope, {
      assetId: 'asset-5',
      symbol: undefined,
      reason: undefined,
    });
    expect(mockDisplayCliError).toHaveBeenCalledWith('assets-include', includeError, 1, 'json');
  });

  it('outputs asset view JSON with action-required metadata', async () => {
    const program = createAssetsProgram();
    mockRunAssetsView.mockResolvedValue(
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

    expect(mockRunAssetsView).toHaveBeenCalledWith(assetsScope, { actionRequiredOnly: true });
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

    mockRunAssetsView.mockResolvedValue(
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
    mockRunAssetsExclude.mockResolvedValue(
      ok({ assetId: 'asset-view-2', assetSymbols: ['TOKEN'], action: 'exclude', changed: true })
    );
    mockRunAssetsConfirmReview.mockResolvedValue(
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
    mockRunAssetsClearReview.mockResolvedValue(
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

    expect(mockRunAssetsExclude).toHaveBeenCalledWith(assetsScope, { assetId: 'asset-view-2' });
    expect(mockRunAssetsConfirmReview).toHaveBeenCalledWith(assetsScope, {
      assetId: 'asset-view-2',
    });
    expect(mockRunAssetsClearReview).toHaveBeenCalledWith(assetsScope, {
      assetId: 'asset-view-2',
    });
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
