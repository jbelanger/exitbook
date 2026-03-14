import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import type { AssetViewItem } from '../../command/assets-handler.js';
import { AssetsViewApp } from '../assets-view-components.jsx';
import { createAssetsViewState } from '../assets-view-state.js';

function createAsset(overrides: Partial<AssetViewItem> = {}): AssetViewItem {
  return {
    assetId: 'blockchain:ethereum:0xscam',
    assetSymbols: ['SCAM'],
    accountingBlocked: true,
    confirmationIsStale: false,
    currentQuantity: '100',
    evidence: [
      {
        kind: 'spam-flag',
        severity: 'error',
        message: 'Provider flagged this token as spam',
      },
    ],
    evidenceFingerprint: 'asset-review:v1:blockchain:ethereum:0xscam',
    excluded: false,
    movementCount: 1,
    referenceStatus: 'matched',
    reviewStatus: 'needs-review',
    warningSummary: 'Provider flagged this token as spam',
    transactionCount: 1,
    ...overrides,
  };
}

const noop = async () => ({
  action: 'exclude' as const,
  assetId: 'ignored',
  assetSymbols: [],
  changed: false,
});

describe('AssetsViewApp', () => {
  it('shows a minimal default asset view and hides clear zero-balance history', () => {
    const initialState = createAssetsViewState(
      [
        createAsset({
          assetId: 'exchange:kraken:btc',
          assetSymbols: ['BTC'],
          accountingBlocked: false,
          currentQuantity: '0.5',
          evidence: [],
          excluded: false,
          movementCount: 4,
          referenceStatus: 'unknown',
          reviewStatus: 'clear',
          transactionCount: 2,
          warningSummary: undefined,
        }),
        createAsset({
          assetId: 'exchange:kraken:eth',
          assetSymbols: ['ETH'],
          accountingBlocked: false,
          currentQuantity: '0',
          evidence: [],
          excluded: false,
          movementCount: 3,
          referenceStatus: 'unknown',
          reviewStatus: 'clear',
          transactionCount: 2,
          warningSummary: undefined,
        }),
      ],
      { totalCount: 2, excludedCount: 0, actionRequiredCount: 0 }
    );

    const { lastFrame } = render(
      <AssetsViewApp
        initialState={initialState}
        onQuit={() => {
          /* noop */
        }}
        onToggleExclusion={noop}
        onConfirmReview={async () => ({
          action: 'confirm',
          assetId: 'ignored',
          assetSymbols: [],
          changed: false,
          accountingBlocked: false,
          confirmationIsStale: false,
          evidence: [],
          evidenceFingerprint: 'asset-review:v1:ignored',
          referenceStatus: 'unknown',
          reviewStatus: 'clear',
          warningSummary: undefined,
        })}
        onClearReview={async () => ({
          action: 'clear-review',
          assetId: 'ignored',
          assetSymbols: [],
          changed: false,
          accountingBlocked: false,
          confirmationIsStale: false,
          evidence: [],
          evidenceFingerprint: 'asset-review:v1:ignored',
          referenceStatus: 'unknown',
          reviewStatus: 'clear',
          warningSummary: undefined,
        })}
      />
    );

    const frame = lastFrame() ?? '';

    expect(frame).toContain('Assets 1 of 2');
    expect(frame).toContain('BTC');
    expect(frame).not.toContain('ETH');
    expect(frame).not.toContain('[clear]');
    expect(frame).not.toContain('Reference:');
    expect(frame).not.toContain('Accounting:');
    expect(frame).not.toContain('Quantity:');
    expect(frame).not.toContain('Signals:');
    expect(frame).toContain('Action: Nothing needs your attention right now.');
  });

  it('shows multi-signal reason hint when multiple categories apply', () => {
    const initialState = createAssetsViewState(
      [
        createAsset({
          evidence: [
            { kind: 'spam-flag', severity: 'error', message: 'spam' },
            { kind: 'same-symbol-ambiguity', severity: 'warning', message: 'ambiguity' },
          ],
        }),
      ],
      { totalCount: 1, excludedCount: 0, actionRequiredCount: 1 }
    );

    const { lastFrame } = render(
      <AssetsViewApp
        initialState={initialState}
        onQuit={() => {
          /* empty */
        }}
        onToggleExclusion={noop}
        onConfirmReview={async () => ({
          action: 'confirm',
          assetId: 'ignored',
          assetSymbols: [],
          changed: false,
          accountingBlocked: false,
          confirmationIsStale: false,
          evidence: [],
          evidenceFingerprint: 'asset-review:v1:ignored',
          referenceStatus: 'unknown',
          reviewStatus: 'clear',
          warningSummary: undefined,
        })}
        onClearReview={async () => ({
          action: 'clear-review',
          assetId: 'ignored',
          assetSymbols: [],
          changed: false,
          accountingBlocked: false,
          confirmationIsStale: false,
          evidence: [],
          evidenceFingerprint: 'asset-review:v1:ignored',
          referenceStatus: 'unknown',
          reviewStatus: 'clear',
          warningSummary: undefined,
        })}
      />
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('same symbol conflict (+1 more)');
  });

  it('shows contract and CoinGecko context for same-symbol conflicts', () => {
    const initialState = createAssetsViewState(
      [
        createAsset({
          assetId: 'blockchain:ethereum:0xaaa',
          assetSymbols: ['USDC'],
          evidence: [
            {
              kind: 'same-symbol-ambiguity',
              severity: 'warning',
              message: 'ambiguity',
              metadata: {
                chain: 'ethereum',
                normalizedSymbol: 'usdc',
                conflictingAssetIds: ['blockchain:ethereum:0xaaa', 'blockchain:ethereum:0xbbb'],
              },
            },
          ],
          referenceStatus: 'matched',
          reviewStatus: 'needs-review',
          warningSummary: 'ambiguity',
        }),
      ],
      { totalCount: 1, excludedCount: 0, actionRequiredCount: 1 },
      'action-required'
    );

    const { lastFrame } = render(
      <AssetsViewApp
        initialState={initialState}
        onQuit={() => {
          /* noop */
        }}
        onToggleExclusion={noop}
        onConfirmReview={async () => ({
          action: 'confirm',
          assetId: 'ignored',
          assetSymbols: [],
          changed: false,
          accountingBlocked: false,
          confirmationIsStale: false,
          evidence: [],
          evidenceFingerprint: 'asset-review:v1:ignored',
          referenceStatus: 'unknown',
          reviewStatus: 'clear',
          warningSummary: undefined,
        })}
        onClearReview={async () => ({
          action: 'clear-review',
          assetId: 'ignored',
          assetSymbols: [],
          changed: false,
          accountingBlocked: false,
          confirmationIsStale: false,
          evidence: [],
          evidenceFingerprint: 'asset-review:v1:ignored',
          referenceStatus: 'unknown',
          reviewStatus: 'clear',
          warningSummary: undefined,
        })}
      />
    );

    const frame = lastFrame() ?? '';

    expect(frame).toContain('Contract: ethereum 0xaaa');
    expect(frame).toContain('CoinGecko: matched canonical token');
    expect(frame).toContain('Conflict: 0xbbb');
  });

  it('shows one review badge, reason, and action for flagged assets', () => {
    const initialState = createAssetsViewState(
      [createAsset()],
      { totalCount: 1, excludedCount: 0, actionRequiredCount: 1 },
      'action-required'
    );

    const { lastFrame } = render(
      <AssetsViewApp
        initialState={initialState}
        onQuit={() => {
          /* noop */
        }}
        onToggleExclusion={noop}
        onConfirmReview={async () => ({
          action: 'confirm',
          assetId: 'blockchain:ethereum:0xscam',
          assetSymbols: ['SCAM'],
          changed: true,
          accountingBlocked: false,
          confirmationIsStale: false,
          evidence: [],
          evidenceFingerprint: 'asset-review:v1:blockchain:ethereum:0xscam',
          referenceStatus: 'matched',
          reviewStatus: 'reviewed',
          warningSummary: undefined,
        })}
        onClearReview={async () => ({
          action: 'clear-review',
          assetId: 'blockchain:ethereum:0xscam',
          assetSymbols: ['SCAM'],
          changed: true,
          accountingBlocked: true,
          confirmationIsStale: false,
          evidence: [
            {
              kind: 'spam-flag',
              severity: 'error',
              message: 'Provider flagged this token as spam',
            },
          ],
          evidenceFingerprint: 'asset-review:v1:blockchain:ethereum:0xscam',
          referenceStatus: 'matched',
          reviewStatus: 'needs-review',
          warningSummary: 'Provider flagged this token as spam',
        })}
      />
    );

    const frame = lastFrame() ?? '';

    expect(frame).toContain('Review Queue');
    expect(frame).toContain('[Review]');
    expect(frame).toContain('possible spam');
    expect(frame).toContain('Why: possible spam');
    expect(frame).toContain('Action: Press c to mark it reviewed, or x to exclude it.');
    expect(frame).toContain('Imported transactions marked this asset as spam.');
    expect(frame).not.toContain('Next action:');
    expect(frame).not.toContain('Reference:');
  });

  it('treats unmatched canonical references as possible spam in the review queue', () => {
    const initialState = createAssetsViewState(
      [
        createAsset({
          accountingBlocked: false,
          evidence: [
            {
              kind: 'unmatched-reference',
              severity: 'warning',
              message: "Provider 'coingecko' could not match this token to a canonical asset",
              metadata: {
                provider: 'coingecko',
              },
            },
          ],
          referenceStatus: 'unmatched',
          warningSummary: "Provider 'coingecko' could not match this token to a canonical asset",
        }),
      ],
      { totalCount: 1, excludedCount: 0, actionRequiredCount: 1 },
      'action-required'
    );

    const { lastFrame } = render(
      <AssetsViewApp
        initialState={initialState}
        onQuit={() => {
          /* noop */
        }}
        onToggleExclusion={noop}
        onConfirmReview={async () => ({
          action: 'confirm',
          assetId: 'ignored',
          assetSymbols: [],
          changed: false,
          accountingBlocked: false,
          confirmationIsStale: false,
          evidence: [],
          evidenceFingerprint: 'asset-review:v1:ignored',
          referenceStatus: 'unknown',
          reviewStatus: 'clear',
          warningSummary: undefined,
        })}
        onClearReview={async () => ({
          action: 'clear-review',
          assetId: 'ignored',
          assetSymbols: [],
          changed: false,
          accountingBlocked: false,
          confirmationIsStale: false,
          evidence: [],
          evidenceFingerprint: 'asset-review:v1:ignored',
          referenceStatus: 'unknown',
          reviewStatus: 'clear',
          warningSummary: undefined,
        })}
      />
    );

    const frame = lastFrame() ?? '';

    expect(frame).toContain('possible spam');
    expect(frame).toContain('Why: possible spam');
    expect(frame).toContain('Canonical reference lookup could not match this token.');
  });

  it('shows a reviewed badge when a confirmed asset still needs exclusion to unblock accounting', () => {
    const initialState = createAssetsViewState(
      [
        createAsset({
          assetId: 'blockchain:ethereum:0xaaa',
          assetSymbols: ['USDC'],
          reviewStatus: 'reviewed',
          accountingBlocked: true,
          evidence: [
            {
              kind: 'same-symbol-ambiguity',
              severity: 'warning',
              message: 'ambiguity',
              metadata: {
                chain: 'ethereum',
                normalizedSymbol: 'usdc',
                conflictingAssetIds: ['blockchain:ethereum:0xaaa', 'blockchain:ethereum:0xbbb'],
              },
            },
          ],
          warningSummary: 'ambiguity',
        }),
      ],
      { totalCount: 1, excludedCount: 0, actionRequiredCount: 1 },
      'action-required'
    );

    const { lastFrame } = render(
      <AssetsViewApp
        initialState={initialState}
        onQuit={() => {
          /* noop */
        }}
        onToggleExclusion={noop}
        onConfirmReview={async () => ({
          action: 'confirm',
          assetId: 'ignored',
          assetSymbols: [],
          changed: false,
          accountingBlocked: false,
          confirmationIsStale: false,
          evidence: [],
          evidenceFingerprint: 'asset-review:v1:ignored',
          referenceStatus: 'unknown',
          reviewStatus: 'clear',
          warningSummary: undefined,
        })}
        onClearReview={async () => ({
          action: 'clear-review',
          assetId: 'ignored',
          assetSymbols: [],
          changed: false,
          accountingBlocked: false,
          confirmationIsStale: false,
          evidence: [],
          evidenceFingerprint: 'asset-review:v1:ignored',
          referenceStatus: 'unknown',
          reviewStatus: 'clear',
          warningSummary: undefined,
        })}
      />
    );

    const frame = lastFrame() ?? '';

    expect(frame).toContain('[Reviewed]');
    expect(frame).toContain('same symbol conflict');
    expect(frame).toContain('Action: Press x to exclude a conflicting asset.');
  });
});
