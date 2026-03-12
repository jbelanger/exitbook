import { describe, expect, it } from 'vitest';

import type { AssetViewItem } from '../../command/assets-handler.js';
import { assetsViewReducer } from '../assets-view-controller.js';
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
        message: 'Suspicious asset evidence requires review',
      },
    ],
    evidenceFingerprint: 'asset-review:v1:blockchain:ethereum:0xscam',
    excluded: false,
    movementCount: 1,
    referenceStatus: 'unknown',
    reviewStatus: 'needs-review',
    warningSummary: 'Suspicious asset evidence requires review',
    transactionCount: 1,
    ...overrides,
  };
}

describe('assetsViewReducer', () => {
  it('defaults to holdings plus exceptions instead of all historical assets', () => {
    const state = createAssetsViewState(
      [
        createAsset({
          assetId: 'exchange:kraken:btc',
          assetSymbols: ['BTC'],
          accountingBlocked: false,
          currentQuantity: '0.5',
          evidence: [],
          reviewStatus: 'clear',
          warningSummary: undefined,
        }),
        createAsset({
          assetId: 'exchange:kraken:eth',
          assetSymbols: ['ETH'],
          accountingBlocked: false,
          currentQuantity: '0',
          evidence: [],
          reviewStatus: 'clear',
          warningSummary: undefined,
        }),
      ],
      { totalCount: 2, excludedCount: 0, actionRequiredCount: 0 }
    );

    expect(state.filter).toBe('default');
    expect(state.filteredAssets.map((asset) => asset.assetId)).toEqual(['exchange:kraken:btc']);
  });

  it('cycles to the needs-review filter and resets selection', () => {
    const state = createAssetsViewState(
      [
        createAsset(),
        createAsset({
          assetId: 'exchange:kraken:btc',
          assetSymbols: ['BTC'],
          accountingBlocked: false,
          reviewStatus: 'clear',
          warningSummary: undefined,
          evidence: [],
        }),
      ],
      { totalCount: 2, excludedCount: 0, actionRequiredCount: 1 }
    );
    state.selectedIndex = 1;
    state.scrollOffset = 1;

    const nextState = assetsViewReducer(state, { type: 'CYCLE_FILTER' });

    expect(nextState.filter).toBe('action-required');
    expect(nextState.filteredAssets.map((asset) => asset.assetId)).toEqual(['blockchain:ethereum:0xscam']);
    expect(nextState.selectedIndex).toBe(0);
    expect(nextState.scrollOffset).toBe(0);
  });

  it('queues review confirmation for a selected needs-review asset', () => {
    const state = createAssetsViewState([createAsset()], { totalCount: 1, excludedCount: 0, actionRequiredCount: 1 });

    const nextState = assetsViewReducer(state, { type: 'CONFIRM_REVIEW' });

    expect(nextState.pendingAction).toEqual({
      type: 'confirm-review',
      assetId: 'blockchain:ethereum:0xscam',
    });
    expect(nextState.error).toBeUndefined();
  });

  it('queues clearing a selected review confirmation', () => {
    const state = createAssetsViewState(
      [
        createAsset({
          reviewStatus: 'reviewed',
          confirmationIsStale: true,
        }),
      ],
      { totalCount: 1, excludedCount: 0, actionRequiredCount: 0 }
    );

    const nextState = assetsViewReducer(state, { type: 'CLEAR_REVIEW' });

    expect(nextState.pendingAction).toEqual({
      type: 'clear-review',
      assetId: 'blockchain:ethereum:0xscam',
    });
  });

  it('rebuilds counts after confirming a review', () => {
    const state = createAssetsViewState([createAsset()], { totalCount: 1, excludedCount: 0, actionRequiredCount: 1 });

    const nextState = assetsViewReducer(state, {
      type: 'CONFIRM_REVIEW_SUCCESS',
      assetId: 'blockchain:ethereum:0xscam',
      review: {
        accountingBlocked: false,
        confirmationIsStale: false,
        evidence: [],
        evidenceFingerprint: 'asset-review:v1:blockchain:ethereum:0xscam',
        referenceStatus: 'matched',
        reviewStatus: 'reviewed',
        warningSummary: undefined,
      },
    });

    expect(nextState.assets[0]?.reviewStatus).toBe('reviewed');
    expect(nextState.assets[0]?.accountingBlocked).toBe(false);
    expect(nextState.assets[0]?.evidence).toEqual([]);
    expect(nextState.assets[0]?.referenceStatus).toBe('matched');
    expect(nextState.actionRequiredCount).toBe(0);
    expect(nextState.pendingAction).toBeUndefined();
  });

  it('keeps reviewed but still-blocking assets in the needs-review filter after mutation', () => {
    const state = createAssetsViewState(
      [createAsset()],
      { totalCount: 1, excludedCount: 0, actionRequiredCount: 1 },
      'action-required'
    );

    const nextState = assetsViewReducer(state, {
      type: 'CONFIRM_REVIEW_SUCCESS',
      assetId: 'blockchain:ethereum:0xscam',
      review: {
        accountingBlocked: true,
        confirmationIsStale: false,
        evidence: [
          {
            kind: 'same-symbol-ambiguity',
            severity: 'warning',
            message: 'Same-chain symbol ambiguity on ethereum:scam',
          },
        ],
        evidenceFingerprint: 'asset-review:v1:blockchain:ethereum:0xscam',
        referenceStatus: 'matched',
        reviewStatus: 'reviewed',
        warningSummary: 'Same-chain symbol ambiguity on ethereum:scam',
      },
    });

    expect(nextState.assets[0]?.reviewStatus).toBe('reviewed');
    expect(nextState.assets[0]?.accountingBlocked).toBe(true);
    expect(nextState.filteredAssets.map((asset) => asset.assetId)).toEqual(['blockchain:ethereum:0xscam']);
    expect(nextState.actionRequiredCount).toBe(1);
    expect(nextState.pendingAction).toBeUndefined();
  });
});
