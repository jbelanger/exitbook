import { describe, expect, it } from 'vitest';

import type { AssetViewItem } from '../../command/assets-handler.js';
import { assetsViewReducer, handleAssetsKeyboardInput, type AssetsViewAction } from '../assets-view-controller.js';
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

  it('rebuilds counts and sets status message after confirming a review', () => {
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
    expect(nextState.statusMessage).toBe('Marked as reviewed');
  });

  it('sets blocking status message when confirm leaves accounting blocked', () => {
    const state = createAssetsViewState([createAsset()], { totalCount: 1, excludedCount: 0, actionRequiredCount: 1 });

    const nextState = assetsViewReducer(state, {
      type: 'CONFIRM_REVIEW_SUCCESS',
      assetId: 'blockchain:ethereum:0xscam',
      review: {
        accountingBlocked: true,
        confirmationIsStale: false,
        evidence: [{ kind: 'same-symbol-ambiguity', severity: 'warning', message: 'ambiguity' }],
        evidenceFingerprint: 'asset-review:v1:blockchain:ethereum:0xscam',
        referenceStatus: 'matched',
        reviewStatus: 'reviewed',
        warningSummary: 'ambiguity',
      },
    });

    expect(nextState.statusMessage).toBe('Marked as reviewed — exclude a conflicting asset to unblock');
  });

  it('sets status message on exclusion toggle', () => {
    const state = createAssetsViewState(
      [
        createAsset({
          assetId: 'blockchain:ethereum:0xdust',
          assetSymbols: ['DUST'],
          accountingBlocked: false,
          currentQuantity: '0',
          excluded: true,
          evidence: [],
          reviewStatus: 'clear',
          warningSummary: undefined,
        }),
      ],
      { totalCount: 1, excludedCount: 1, actionRequiredCount: 0 }
    );

    const excluded = assetsViewReducer(state, {
      type: 'TOGGLE_EXCLUSION_SUCCESS',
      assetId: 'blockchain:ethereum:0xdust',
      excluded: true,
    });
    expect(excluded.statusMessage).toBe('Excluded');

    const included = assetsViewReducer(excluded, {
      type: 'TOGGLE_EXCLUSION_SUCCESS',
      assetId: 'blockchain:ethereum:0xdust',
      excluded: false,
    });
    expect(included.statusMessage).toBe('Included');
    expect(included.filteredAssets).toHaveLength(0);
  });

  it('sets status message on clear review', () => {
    const state = createAssetsViewState([createAsset({ reviewStatus: 'reviewed', confirmationIsStale: true })], {
      totalCount: 1,
      excludedCount: 0,
      actionRequiredCount: 0,
    });

    const nextState = assetsViewReducer(state, {
      type: 'CLEAR_REVIEW_SUCCESS',
      assetId: 'blockchain:ethereum:0xscam',
      review: {
        accountingBlocked: true,
        confirmationIsStale: false,
        evidence: [{ kind: 'spam-flag', severity: 'error', message: 'spam' }],
        evidenceFingerprint: 'asset-review:v1:blockchain:ethereum:0xscam',
        referenceStatus: 'unknown',
        reviewStatus: 'needs-review',
        warningSummary: 'spam',
      },
    });

    expect(nextState.statusMessage).toBe('Review reopened');
  });

  it('clears status message on navigation', () => {
    const state = createAssetsViewState(
      [
        createAsset(),
        createAsset({
          assetId: 'exchange:kraken:btc',
          assetSymbols: ['BTC'],
          accountingBlocked: false,
          evidence: [],
          reviewStatus: 'clear',
          warningSummary: undefined,
        }),
      ],
      { totalCount: 2, excludedCount: 0, actionRequiredCount: 1 }
    );
    state.statusMessage = 'Marked as reviewed';

    const nextState = assetsViewReducer(state, { type: 'NAVIGATE_DOWN', visibleRows: 10 });

    expect(nextState.statusMessage).toBeUndefined();
  });

  it('clears status message when a new action starts', () => {
    const state = createAssetsViewState([createAsset()], { totalCount: 1, excludedCount: 0, actionRequiredCount: 1 });
    state.statusMessage = 'Included';

    const nextState = assetsViewReducer(state, { type: 'TOGGLE_EXCLUSION' });

    expect(nextState.statusMessage).toBeUndefined();
    expect(nextState.pendingAction).toEqual({
      type: 'toggle-exclusion',
      assetId: 'blockchain:ethereum:0xscam',
    });
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

describe('handleAssetsKeyboardInput', () => {
  function createKeyState(overrides: Partial<Parameters<typeof handleAssetsKeyboardInput>[1]> = {}) {
    return {
      ctrl: false,
      downArrow: false,
      end: false,
      escape: false,
      home: false,
      pageDown: false,
      pageUp: false,
      tab: false,
      upArrow: false,
      ...overrides,
    };
  }

  it('uses a smaller visible row budget when feedback is visible', () => {
    const dispatchedWithoutFeedback: AssetsViewAction[] = [];
    handleAssetsKeyboardInput(
      'j',
      createKeyState(),
      (action) => dispatchedWithoutFeedback.push(action),
      () => {
        /* noop */
      },
      26,
      { error: undefined, statusMessage: undefined }
    );

    const dispatchedWithFeedback: AssetsViewAction[] = [];
    handleAssetsKeyboardInput(
      'j',
      createKeyState(),
      (action) => dispatchedWithFeedback.push(action),
      () => {
        /* noop */
      },
      26,
      { error: undefined, statusMessage: 'Included' }
    );

    expect(dispatchedWithoutFeedback).toEqual([{ type: 'NAVIGATE_DOWN', visibleRows: 4 }]);
    expect(dispatchedWithFeedback).toEqual([{ type: 'NAVIGATE_DOWN', visibleRows: 2 }]);
  });
});
