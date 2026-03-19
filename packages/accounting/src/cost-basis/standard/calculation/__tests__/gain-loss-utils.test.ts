/**
 * Tests for gain/loss calculation utility functions
 *
 * These tests verify the pure business logic for gain/loss calculations
 * according to the "Functional Core, Imperative Shell" pattern
 */

import { type Currency } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { createDisposal, createLot } from '../../../../__tests__/test-utils.js';
import { CanadaRules } from '../../../jurisdictions/canada/rules.js';
import type { IJurisdictionRules } from '../../../jurisdictions/jurisdiction-rules.js';
import { USRules } from '../../../jurisdictions/us/rules.js';
import type { AssetLotMatchResult } from '../../matching/lot-matcher.js';
import { calculateGainLoss } from '../gain-loss-utils.js';

describe('calculateGainLoss', () => {
  const rules: IJurisdictionRules = new CanadaRules();

  it('calculates gain/loss for single asset with single disposal', () => {
    const lot = createLot('lot1', 'BTC', '1.0', '40000', new Date('2023-03-07'));
    const disposal = createDisposal('d1', 'lot1', 'BTC', new Date('2023-06-15'), '1.0', '50000', '40000', 100);

    const assetResult: AssetLotMatchResult = {
      assetSymbol: 'BTC' as Currency,
      assetId: 'test:btc',
      lots: [lot],
      disposals: [disposal],
      lotTransfers: [],
    };

    const result = calculateGainLoss([assetResult], rules);

    const resultValue = assertOk(result);

    const gainLoss = resultValue;
    expect(gainLoss.totalProceeds.toFixed()).toBe('50000');
    expect(gainLoss.totalCostBasis.toFixed()).toBe('40000');
    expect(gainLoss.totalCapitalGainLoss.toFixed()).toBe('10000');
    expect(gainLoss.totalDisposalsProcessed).toBe(1);
    expect(gainLoss.disallowedLossCount).toBe(0);
  });

  it('skips assets with no lots and no disposals', () => {
    const assetResult: AssetLotMatchResult = {
      assetId: 'test:usd',
      assetSymbol: 'USD' as Currency,
      lots: [],
      disposals: [],
      lotTransfers: [],
    };

    const result = calculateGainLoss([assetResult], rules);

    const resultValue = assertOk(result);

    const gainLoss = resultValue;
    expect(gainLoss.byAsset.size).toBe(0);
    expect(gainLoss.totalDisposalsProcessed).toBe(0);
  });

  it('returns error when disposal references non-existent lot', () => {
    const disposal = createDisposal(
      'd1',
      'lot-nonexistent',
      'BTC',
      new Date('2023-06-15'),
      '1.0',
      '50000',
      '40000',
      100
    );

    const assetResult: AssetLotMatchResult = {
      assetSymbol: 'BTC' as Currency,
      assetId: 'test:btc',
      lots: [],
      disposals: [disposal],
      lotTransfers: [],
    };

    const result = calculateGainLoss([assetResult], rules);

    const resultError = assertErr(result);

    expect(resultError.message).toContain('lot-nonexistent');
    expect(resultError.message).toContain('not found');
  });

  it('applies tax treatment categories', () => {
    // Use US rules which distinguish between short-term and long-term gains
    const usRules: IJurisdictionRules = new USRules();

    const lot = createLot('lot1', 'BTC', '1.0', '40000', new Date('2023-03-07'));
    const disposal = createDisposal('d1', 'lot1', 'BTC', new Date('2023-06-15'), '1.0', '50000', '40000', 100);

    const assetResult: AssetLotMatchResult = {
      assetSymbol: 'BTC' as Currency,
      assetId: 'test:btc',
      lots: [lot],
      disposals: [disposal],
      lotTransfers: [],
    };

    const result = calculateGainLoss([assetResult], usRules);

    const resultValue = assertOk(result);

    const gainLoss = resultValue;
    const btcSummary = gainLoss.byAsset.get('test:btc');

    expect(btcSummary).toBeDefined();
    expect(btcSummary!.disposals[0]!.taxTreatmentCategory).toBe('short_term'); // 100 days < 365 days
  });

  it('detects and counts disallowed losses', () => {
    const disposalDate = new Date('2023-06-15');
    const lot1 = createLot('lot1', 'BTC', '1.0', '40000', new Date('2023-03-07'));
    const disposal = createDisposal(
      'd1',
      'lot1',
      'BTC',
      disposalDate,
      '1.0',
      '30000', // loss of 10000
      '40000',
      100
    );

    // Reacquisition within superficial loss window
    const lot2 = createLot('lot2', 'BTC', '1.0', '35000', new Date('2023-06-20'));

    const assetResult: AssetLotMatchResult = {
      assetSymbol: 'BTC' as Currency,
      assetId: 'test:btc',
      lots: [lot1, lot2],
      disposals: [disposal],
      lotTransfers: [],
    };

    const result = calculateGainLoss([assetResult], rules);

    const resultValue = assertOk(result);

    const gainLoss = resultValue;
    expect(gainLoss.disallowedLossCount).toBe(1);

    const btcSummary = gainLoss.byAsset.get('test:btc');
    expect(btcSummary!.disposals[0]!.lossDisallowed).toBe(true);
    expect(btcSummary!.disposals[0]!.taxableGainLoss.toFixed()).toBe('0'); // Loss disallowed
  });

  it('handles multiple assets', () => {
    const btcLot = createLot('lot1', 'BTC', '1.0', '40000', new Date('2023-03-07'));
    const btcDisposal = createDisposal('d1', 'lot1', 'BTC', new Date('2023-06-15'), '1.0', '50000', '40000', 100);

    const ethLot = createLot('lot2', 'ETH', '10.0', '2000', new Date('2023-04-01'));
    const ethDisposal = createDisposal('d2', 'lot2', 'ETH', new Date('2023-07-01'), '5.0', '2500', '2000', 91);

    const assetResults: AssetLotMatchResult[] = [
      {
        assetId: 'test:btc',
        assetSymbol: 'BTC' as Currency,
        lots: [btcLot],
        disposals: [btcDisposal],
        lotTransfers: [],
      },
      {
        assetId: 'test:eth',
        assetSymbol: 'ETH' as Currency,
        lots: [ethLot],
        disposals: [ethDisposal],
        lotTransfers: [],
      },
    ];

    const result = calculateGainLoss(assetResults, rules);

    const resultValue = assertOk(result);

    const gainLoss = resultValue;
    expect(gainLoss.byAsset.size).toBe(2);
    expect(gainLoss.byAsset.has('test:btc')).toBe(true);
    expect(gainLoss.byAsset.has('test:eth')).toBe(true);
    expect(gainLoss.totalDisposalsProcessed).toBe(2);
  });

  it('handles fiat-only transactions (no crypto assets)', () => {
    const assetResult: AssetLotMatchResult = {
      assetId: 'test:usd',
      assetSymbol: 'USD' as Currency,
      lots: [],
      disposals: [],
      lotTransfers: [],
    };

    const result = calculateGainLoss([assetResult], rules);

    const resultValue = assertOk(result);

    const gainLoss = resultValue;
    expect(gainLoss.byAsset.size).toBe(0);
    expect(gainLoss.totalProceeds.toFixed()).toBe('0');
    expect(gainLoss.totalCostBasis.toFixed()).toBe('0');
    expect(gainLoss.totalCapitalGainLoss.toFixed()).toBe('0');
    expect(gainLoss.totalTaxableGainLoss.toFixed()).toBe('0');
  });
});
