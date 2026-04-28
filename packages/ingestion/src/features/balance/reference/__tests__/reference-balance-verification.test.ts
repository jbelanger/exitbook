import { parseDecimal } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import type { UnifiedBalanceRow } from '../reference-balance-fetching.js';
import { compareBalanceRows, convertBalanceRowsToDecimals } from '../reference-balance-verification.js';

describe('reference balance row verification', () => {
  it('aggregates duplicate rows by asset and balance category without collapsing categories', () => {
    const rows: UnifiedBalanceRow[] = [
      {
        amount: '1.25',
        assetId: 'blockchain:solana:native',
        assetSymbol: 'SOL',
        balanceCategory: 'liquid',
        refs: ['liquid-1'],
      },
      {
        amount: '0.75',
        assetId: 'blockchain:solana:native',
        assetSymbol: 'SOL',
        balanceCategory: 'liquid',
        refs: ['liquid-2'],
      },
      {
        amount: '3',
        assetId: 'blockchain:solana:native',
        assetSymbol: 'SOL',
        balanceCategory: 'staked',
        refs: ['stake-1'],
      },
    ];

    const result = convertBalanceRowsToDecimals(rows);

    expect(result.coverage).toEqual({
      failedAssetCount: 0,
      parsedAssetCount: 3,
      totalAssetCount: 3,
    });
    expect(
      result.rows.map((row) => ({
        amount: row.amount.toFixed(),
        assetId: row.assetId,
        balanceCategory: row.balanceCategory,
        refs: row.refs,
      }))
    ).toEqual([
      {
        amount: '2',
        assetId: 'blockchain:solana:native',
        balanceCategory: 'liquid',
        refs: ['liquid-1', 'liquid-2'],
      },
      {
        amount: '3',
        assetId: 'blockchain:solana:native',
        balanceCategory: 'staked',
        refs: ['stake-1'],
      },
    ]);
  });

  it('compares the same asset independently across liquid and staked rows', () => {
    const comparisons = compareBalanceRows(
      [
        {
          amount: parseDecimal('2'),
          assetId: 'blockchain:solana:native',
          assetSymbol: 'SOL',
          balanceCategory: 'liquid',
          refs: [],
        },
        {
          amount: parseDecimal('3'),
          assetId: 'blockchain:solana:native',
          assetSymbol: 'SOL',
          balanceCategory: 'staked',
          refs: [],
        },
      ],
      [
        {
          amount: parseDecimal('2'),
          assetId: 'blockchain:solana:native',
          assetSymbol: 'SOL',
          balanceCategory: 'liquid',
          refs: [],
        },
        {
          amount: parseDecimal('2.5'),
          assetId: 'blockchain:solana:native',
          assetSymbol: 'SOL',
          balanceCategory: 'staked',
          refs: [],
        },
      ]
    );

    expect(
      comparisons.map((comparison) => ({
        balanceCategory: comparison.balanceCategory,
        calculatedBalance: comparison.calculatedBalance,
        difference: comparison.difference,
        liveBalance: comparison.liveBalance,
        status: comparison.status,
      }))
    ).toEqual([
      {
        balanceCategory: 'staked',
        calculatedBalance: '3',
        difference: '0.5',
        liveBalance: '2.5',
        status: 'mismatch',
      },
      {
        balanceCategory: 'liquid',
        calculatedBalance: '2',
        difference: '0',
        liveBalance: '2',
        status: 'match',
      },
    ]);
  });
});
