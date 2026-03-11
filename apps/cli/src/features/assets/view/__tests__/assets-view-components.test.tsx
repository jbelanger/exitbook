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
    excluded: true,
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
  it('renders review and exclusion state separately in the row and detail panel', () => {
    const initialState = createAssetsViewState(
      [
        createAsset(),
        createAsset({
          assetId: 'exchange:kraken:btc',
          assetSymbols: ['BTC'],
          excluded: false,
          accountingBlocked: false,
          referenceStatus: 'unknown',
          reviewStatus: 'clear',
          warningSummary: undefined,
          evidence: [],
        }),
      ],
      { totalCount: 2, excludedCount: 1, actionRequiredCount: 1 }
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

    expect(frame).toContain('1 action required');
    expect(frame).toContain('[review] SCAM 100 reference matched excluded');
    expect(frame).toContain('Review: [review]');
    expect(frame).toContain('Reference: reference matched');
    expect(frame).toContain('Accounting: blocked');
    expect(frame).toContain('Exclusion: excluded');
    expect(frame).toContain('[error] Provider flagged this token as spam');
  });
});
