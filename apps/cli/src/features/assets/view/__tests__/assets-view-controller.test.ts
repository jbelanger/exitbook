import { describe, expect, it } from 'vitest';

import type { AssetViewItem } from '../../command/assets-handler.js';
import { assetsViewReducer } from '../assets-view-controller.js';
import { createAssetsViewState } from '../assets-view-state.js';

function createAsset(overrides: Partial<AssetViewItem> = {}): AssetViewItem {
  return {
    assetId: 'blockchain:ethereum:0xscam',
    assetSymbols: ['SCAM'],
    confirmationIsStale: false,
    currentQuantity: '100',
    evidenceFingerprint: 'asset-review:v1:blockchain:ethereum:0xscam',
    excluded: false,
    movementCount: 1,
    referenceStatus: 'unknown',
    reviewState: 'needs-review',
    reviewSummary: 'Suspicious asset evidence requires review',
    transactionCount: 1,
    ...overrides,
  };
}

describe('assetsViewReducer', () => {
  it('cycles to the needs-review filter and resets selection', () => {
    const state = createAssetsViewState(
      [
        createAsset(),
        createAsset({
          assetId: 'exchange:kraken:btc',
          assetSymbols: ['BTC'],
          reviewState: 'clear',
          reviewSummary: undefined,
        }),
      ],
      { totalCount: 2, excludedCount: 0, needsReviewCount: 1 }
    );
    state.selectedIndex = 1;
    state.scrollOffset = 1;

    const nextState = assetsViewReducer(state, { type: 'CYCLE_FILTER' });

    expect(nextState.filter).toBe('needs-review');
    expect(nextState.filteredAssets.map((asset) => asset.assetId)).toEqual(['blockchain:ethereum:0xscam']);
    expect(nextState.selectedIndex).toBe(0);
    expect(nextState.scrollOffset).toBe(0);
  });

  it('queues review confirmation for a selected needs-review asset', () => {
    const state = createAssetsViewState([createAsset()], { totalCount: 1, excludedCount: 0, needsReviewCount: 1 });

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
          reviewState: 'reviewed',
          confirmationIsStale: true,
        }),
      ],
      { totalCount: 1, excludedCount: 0, needsReviewCount: 0 }
    );

    const nextState = assetsViewReducer(state, { type: 'CLEAR_REVIEW' });

    expect(nextState.pendingAction).toEqual({
      type: 'clear-review',
      assetId: 'blockchain:ethereum:0xscam',
    });
  });

  it('rebuilds counts after confirming a review', () => {
    const state = createAssetsViewState([createAsset()], { totalCount: 1, excludedCount: 0, needsReviewCount: 1 });

    const nextState = assetsViewReducer(state, {
      type: 'CONFIRM_REVIEW_SUCCESS',
      assetId: 'blockchain:ethereum:0xscam',
    });

    expect(nextState.assets[0]?.reviewState).toBe('reviewed');
    expect(nextState.needsReviewCount).toBe(0);
    expect(nextState.pendingAction).toBeUndefined();
  });
});
