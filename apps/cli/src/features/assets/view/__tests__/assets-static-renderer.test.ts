import { describe, expect, it } from 'vitest';

import type { AssetViewItem } from '../../command/assets-types.js';
import { buildAssetStaticDetail, buildAssetsStaticList } from '../assets-static-renderer.js';
import { createAssetsViewState } from '../assets-view-state.js';

const ansiPattern = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g');

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, '');
}

function createAsset(overrides: Partial<AssetViewItem> = {}): AssetViewItem {
  return {
    assetId: 'blockchain:ethereum:0xscam',
    assetSymbols: ['SCAM'],
    accountingBlocked: true,
    confirmationIsStale: false,
    currentQuantity: '100',
    evidence: [
      {
        kind: 'scam-diagnostic',
        severity: 'error',
        message: 'spam',
      },
    ],
    evidenceFingerprint: 'asset-review:v1:blockchain:ethereum:0xscam',
    excluded: false,
    movementCount: 2,
    referenceStatus: 'matched',
    reviewStatus: 'needs-review',
    warningSummary: 'spam',
    transactionCount: 1,
    ...overrides,
  };
}

describe('buildAssetsStaticList', () => {
  it('renders a compact asset table with status and asset IDs', () => {
    const output = buildAssetsStaticList(
      createAssetsViewState(
        [
          createAsset(),
          createAsset({
            assetId: 'exchange:kraken:btc',
            assetSymbols: ['BTC'],
            accountingBlocked: false,
            currentQuantity: '0.5',
            evidence: [],
            excluded: false,
            movementCount: 4,
            reviewStatus: 'clear',
            warningSummary: undefined,
            transactionCount: 3,
          }),
        ],
        { totalCount: 2, excludedCount: 0, actionRequiredCount: 1 }
      )
    );

    expect(stripAnsi(output)).toContain('Assets 2 · 1 flagged · 0 excluded');
    expect(stripAnsi(output)).toContain('SYMBOL');
    expect(stripAnsi(output)).toContain('STATUS');
    expect(stripAnsi(output)).toContain('ASSET ID');
    expect(stripAnsi(output)).toContain('SCAM');
    expect(stripAnsi(output)).toContain('Review');
    expect(stripAnsi(output)).toContain('scam warnings in imported transactions');
    expect(stripAnsi(output)).toContain('blockchain:ethereum:0xscam');
    expect(stripAnsi(output)).toContain('BTC');
    expect(stripAnsi(output)).not.toContain('q quit');
  });

  it('renders the friendly empty state for the default filter', () => {
    const output = buildAssetsStaticList(
      createAssetsViewState([], { totalCount: 0, excludedCount: 0, actionRequiredCount: 0 })
    );

    expect(stripAnsi(output)).toContain('Assets 0 · 0 flagged · 0 excluded');
    expect(stripAnsi(output)).toContain('No assets with holdings, exclusions, or review flags.');
    expect(stripAnsi(output)).not.toContain('SYMBOL');
  });
});

describe('buildAssetStaticDetail', () => {
  it('renders a detailed static asset card', () => {
    const output = buildAssetStaticDetail(
      createAsset({
        assetId: 'blockchain:ethereum:0xaaa',
        assetSymbols: ['USDC', 'USDC.e'],
        evidence: [
          {
            kind: 'same-symbol-ambiguity',
            severity: 'warning',
            message: 'ambiguity',
            metadata: {
              conflictingAssetIds: ['blockchain:ethereum:0xaaa', 'blockchain:ethereum:0xbbb'],
            },
          },
        ],
        referenceStatus: 'matched',
        reviewStatus: 'needs-review',
        warningSummary: 'ambiguity',
      })
    );

    expect(stripAnsi(output)).toContain('USDC 100 [Review]');
    expect(stripAnsi(output)).toContain('Asset ID: blockchain:ethereum:0xaaa');
    expect(stripAnsi(output)).toContain('Also seen as: USDC, USDC.e');
    expect(stripAnsi(output)).toContain('Contract: ethereum 0xaaa');
    expect(stripAnsi(output)).toContain('CoinGecko: matched canonical token');
    expect(stripAnsi(output)).toContain('Conflict asset: blockchain:ethereum:0xbbb');
    expect(stripAnsi(output)).toContain('Why: same symbol conflict');
    expect(stripAnsi(output)).toContain(
      'Action: Run "exitbook assets confirm --asset-id blockchain:ethereum:0xaaa" to mark it reviewed, or "exitbook assets exclude --asset-id blockchain:ethereum:0xaaa" to exclude a conflicting asset.'
    );
    expect(stripAnsi(output)).toContain(
      `Inspect: Run "exitbook transactions list --asset-id blockchain:ethereum:0xaaa" to inspect only this asset's transactions.`
    );
    expect(stripAnsi(output)).toContain('Signals');
    expect(stripAnsi(output)).not.toContain('q quit');
  });
});
