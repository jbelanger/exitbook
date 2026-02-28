/**
 * Tests for gain/loss calculation utility functions
 *
 * These tests verify the pure business logic for gain/loss calculations
 * according to the "Functional Core, Imperative Shell" pattern
 */

import { type Currency, parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { createDisposal, createLot } from '../../__tests__/test-utils.js';
import {
  aggregateAssetGainLoss,
  aggregateOverallGainLoss,
  calculateGainLoss,
  checkLossDisallowance,
} from '../gain-loss-utils.js';
import type { IJurisdictionRules } from '../jurisdictions/base-rules.js';
import { CanadaRules } from '../jurisdictions/canada-rules.js';
import { USRules } from '../jurisdictions/us-rules.js';
import type { AssetLotMatchResult } from '../lot-matcher.js';

describe('checkLossDisallowance', () => {
  const rules: IJurisdictionRules = new CanadaRules(); // Canada: 30 days before/after

  describe('gains and break-even', () => {
    it('does not disallow gains (positive gainLoss)', () => {
      const disposal = createDisposal(
        'd1',
        'lot1',
        'BTC',
        new Date('2023-06-15'),
        '1.0',
        '50000', // proceeds
        '40000', // cost basis
        100 // gain of 10000
      );

      const lot = createLot('lot1', 'BTC', '1.0', '40000', new Date('2023-03-07'));

      const isDisallowed = checkLossDisallowance(disposal, lot, [], [lot], rules);

      expect(isDisallowed).toBe(false);
    });

    it('does not disallow break-even (zero gainLoss)', () => {
      const disposal = createDisposal('d1', 'lot1', 'BTC', new Date('2023-06-15'), '1.0', '40000', '40000', 100);

      const lot = createLot('lot1', 'BTC', '1.0', '40000', new Date('2023-03-07'));

      const isDisallowed = checkLossDisallowance(disposal, lot, [], [lot], rules);

      expect(isDisallowed).toBe(false);
    });
  });

  describe('losses without reacquisition', () => {
    it('does not disallow loss when no other lots exist', () => {
      const disposal = createDisposal(
        'd1',
        'lot1',
        'BTC',
        new Date('2023-06-15'),
        '1.0',
        '30000', // loss of 10000
        '40000',
        100
      );

      const lot = createLot('lot1', 'BTC', '1.0', '40000', new Date('2023-03-07'));

      const isDisallowed = checkLossDisallowance(disposal, lot, [], [lot], rules);

      expect(isDisallowed).toBe(false);
    });

    it('does not disallow loss when reacquisition is outside 61-day window', () => {
      const disposalDate = new Date('2023-06-15');
      const disposal = createDisposal('d1', 'lot1', 'BTC', disposalDate, '1.0', '30000', '40000', 100);

      const lot1 = createLot('lot1', 'BTC', '1.0', '40000', new Date('2023-03-07'));

      // Reacquisition 40 days before disposal (> 30 days before)
      const lot2 = createLot('lot2', 'BTC', '1.0', '35000', new Date('2023-05-06'));

      // Reacquisition 40 days after disposal (> 30 days after)
      const lot3 = createLot('lot3', 'BTC', '1.0', '35000', new Date('2023-07-25'));

      const isDisallowed = checkLossDisallowance(disposal, lot1, [], [lot1, lot2, lot3], rules);

      expect(isDisallowed).toBe(false);
    });
  });

  describe('superficial loss detection (Canada rules)', () => {
    it('disallows loss when reacquisition within 30 days after disposal', () => {
      const disposalDate = new Date('2023-06-15');
      const disposal = createDisposal('d1', 'lot1', 'BTC', disposalDate, '1.0', '30000', '40000', 100);

      const lot1 = createLot('lot1', 'BTC', '1.0', '40000', new Date('2023-03-07'));

      // Reacquisition 15 days after disposal
      const lot2 = createLot('lot2', 'BTC', '1.0', '35000', new Date('2023-06-30'));

      const isDisallowed = checkLossDisallowance(disposal, lot1, [], [lot1, lot2], rules);

      expect(isDisallowed).toBe(true);
    });

    it('disallows loss when reacquisition within 30 days before disposal', () => {
      const disposalDate = new Date('2023-06-15');
      const disposal = createDisposal('d1', 'lot1', 'BTC', disposalDate, '1.0', '30000', '40000', 100);

      const lot1 = createLot('lot1', 'BTC', '1.0', '40000', new Date('2023-03-07'));

      // Reacquisition 15 days before disposal
      const lot2 = createLot('lot2', 'BTC', '1.0', '35000', new Date('2023-05-31'));

      const isDisallowed = checkLossDisallowance(disposal, lot1, [], [lot1, lot2], rules);

      expect(isDisallowed).toBe(true);
    });

    it('disallows loss on exact 30-day boundary (after)', () => {
      const disposalDate = new Date('2023-06-15');
      const disposal = createDisposal('d1', 'lot1', 'BTC', disposalDate, '1.0', '30000', '40000', 100);

      const lot1 = createLot('lot1', 'BTC', '1.0', '40000', new Date('2023-03-07'));

      // Exactly 30 days after
      const lot2 = createLot('lot2', 'BTC', '1.0', '35000', new Date('2023-07-15'));

      const isDisallowed = checkLossDisallowance(disposal, lot1, [], [lot1, lot2], rules);

      expect(isDisallowed).toBe(true);
    });
  });

  describe('wash sale detection (US rules)', () => {
    const usRules: IJurisdictionRules = new USRules(); // US: 30 days after only

    it('disallows loss when reacquisition within 30 days after disposal', () => {
      const disposalDate = new Date('2023-06-15');
      const disposal = createDisposal('d1', 'lot1', 'BTC', disposalDate, '1.0', '30000', '40000', 100);

      const lot1 = createLot('lot1', 'BTC', '1.0', '40000', new Date('2023-03-07'));

      // Reacquisition 20 days after disposal
      const lot2 = createLot('lot2', 'BTC', '1.0', '35000', new Date('2023-07-05'));

      const isDisallowed = checkLossDisallowance(disposal, lot1, [], [lot1, lot2], usRules);

      expect(isDisallowed).toBe(true);
    });

    it('does not disallow loss when reacquisition before disposal (US does not look back)', () => {
      const disposalDate = new Date('2023-06-15');
      const disposal = createDisposal('d1', 'lot1', 'BTC', disposalDate, '1.0', '30000', '40000', 100);

      const lot1 = createLot('lot1', 'BTC', '1.0', '40000', new Date('2023-03-07'));

      // Reacquisition 15 days before disposal
      const lot2 = createLot('lot2', 'BTC', '1.0', '35000', new Date('2023-05-31'));

      const isDisallowed = checkLossDisallowance(disposal, lot1, [], [lot1, lot2], usRules);

      expect(isDisallowed).toBe(false);
    });
  });

  describe('multiple reacquisitions', () => {
    it('disallows loss when at least one reacquisition is within window', () => {
      const disposalDate = new Date('2023-06-15');
      const disposal = createDisposal('d1', 'lot1', 'BTC', disposalDate, '1.0', '30000', '40000', 100);

      const lot1 = createLot('lot1', 'BTC', '1.0', '40000', new Date('2023-03-07'));
      const lot2 = createLot('lot2', 'BTC', '1.0', '35000', new Date('2023-08-01')); // outside window
      const lot3 = createLot('lot3', 'BTC', '1.0', '32000', new Date('2023-06-20')); // within window

      const isDisallowed = checkLossDisallowance(disposal, lot1, [], [lot1, lot2, lot3], rules);

      expect(isDisallowed).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('excludes the disposed lot itself from reacquisition check', () => {
      const disposalDate = new Date('2023-06-15');
      const disposal = createDisposal('d1', 'lot1', 'BTC', disposalDate, '1.0', '30000', '40000', 100);

      const lot1 = createLot('lot1', 'BTC', '1.0', '40000', new Date('2023-06-10')); // within window but same lot

      const isDisallowed = checkLossDisallowance(disposal, lot1, [], [lot1], rules);

      expect(isDisallowed).toBe(false);
    });
  });
});

describe('aggregateAssetGainLoss', () => {
  it('aggregates single disposal correctly', () => {
    const disposal = {
      disposalId: 'd1',
      assetSymbol: 'BTC' as Currency,
      assetId: 'test:btc',
      disposalDate: new Date('2023-06-15'),
      acquisitionDate: new Date('2023-03-07'),
      holdingPeriodDays: 100,
      capitalGainLoss: parseDecimal('10000'),
      taxableGainLoss: parseDecimal('5000'),
      taxTreatmentCategory: 'short-term',
      lossDisallowed: false,
      quantityDisposed: parseDecimal('1.0'),
      proceedsPerUnit: parseDecimal('50000'),
      costBasisPerUnit: parseDecimal('40000'),
    };

    const result = aggregateAssetGainLoss('BTC', [disposal]);

    const resultValue = assertOk(result);

    const summary = resultValue;
    expect(summary.assetSymbol).toBe('BTC');
    expect(summary.totalProceeds.toFixed()).toBe('50000');
    expect(summary.totalCostBasis.toFixed()).toBe('40000');
    expect(summary.totalCapitalGainLoss.toFixed()).toBe('10000');
    expect(summary.totalTaxableGainLoss.toFixed()).toBe('5000');
    expect(summary.disposalCount).toBe(1);
    expect(summary.byCategory.get('short-term')).toEqual({
      count: 1,
      gainLoss: parseDecimal('10000'),
      taxableGainLoss: parseDecimal('5000'),
    });
  });

  it('aggregates multiple disposals correctly', () => {
    const disposal1 = {
      disposalId: 'd1',
      assetSymbol: 'BTC' as Currency,
      assetId: 'test:btc',
      disposalDate: new Date('2023-06-15'),
      acquisitionDate: new Date('2023-03-07'),
      holdingPeriodDays: 100,
      capitalGainLoss: parseDecimal('10000'),
      taxableGainLoss: parseDecimal('5000'),
      taxTreatmentCategory: 'short-term',
      lossDisallowed: false,
      quantityDisposed: parseDecimal('1.0'),
      proceedsPerUnit: parseDecimal('50000'),
      costBasisPerUnit: parseDecimal('40000'),
    };

    const disposal2 = {
      disposalId: 'd2',
      assetSymbol: 'BTC' as Currency,
      assetId: 'test:btc',
      disposalDate: new Date('2024-01-15'),
      acquisitionDate: new Date('2023-03-07'),
      holdingPeriodDays: 365,
      capitalGainLoss: parseDecimal('15000'),
      taxableGainLoss: parseDecimal('7500'),
      taxTreatmentCategory: 'long-term',
      lossDisallowed: false,
      quantityDisposed: parseDecimal('1.5'),
      proceedsPerUnit: parseDecimal('60000'),
      costBasisPerUnit: parseDecimal('50000'),
    };

    const result = aggregateAssetGainLoss('BTC', [disposal1, disposal2]);

    const resultValue = assertOk(result);

    const summary = resultValue;
    expect(summary.totalProceeds.toFixed()).toBe('140000'); // 50000 + 90000
    expect(summary.totalCostBasis.toFixed()).toBe('115000'); // 40000 + 75000
    expect(summary.totalCapitalGainLoss.toFixed()).toBe('25000'); // 10000 + 15000
    expect(summary.totalTaxableGainLoss.toFixed()).toBe('12500'); // 5000 + 7500
    expect(summary.disposalCount).toBe(2);

    expect(summary.byCategory.get('short-term')).toEqual({
      count: 1,
      gainLoss: parseDecimal('10000'),
      taxableGainLoss: parseDecimal('5000'),
    });

    expect(summary.byCategory.get('long-term')).toEqual({
      count: 1,
      gainLoss: parseDecimal('15000'),
      taxableGainLoss: parseDecimal('7500'),
    });
  });

  it('handles empty disposals array', () => {
    const result = aggregateAssetGainLoss('BTC', []);

    const resultValue = assertOk(result);

    const summary = resultValue;
    expect(summary.assetSymbol).toBe('BTC');
    expect(summary.totalProceeds.toFixed()).toBe('0');
    expect(summary.totalCostBasis.toFixed()).toBe('0');
    expect(summary.totalCapitalGainLoss.toFixed()).toBe('0');
    expect(summary.totalTaxableGainLoss.toFixed()).toBe('0');
    expect(summary.disposalCount).toBe(0);
    expect(summary.byCategory.size).toBe(0);
  });

  it('aggregates disposals with same category correctly', () => {
    const disposal1 = {
      disposalId: 'd1',
      assetSymbol: 'ETH' as Currency,
      assetId: 'test:eth',
      disposalDate: new Date('2023-06-15'),
      acquisitionDate: new Date('2023-05-01'),
      holdingPeriodDays: 45,
      capitalGainLoss: parseDecimal('500'),
      taxableGainLoss: parseDecimal('250'),
      taxTreatmentCategory: 'short-term',
      lossDisallowed: false,
      quantityDisposed: parseDecimal('1.0'),
      proceedsPerUnit: parseDecimal('2000'),
      costBasisPerUnit: parseDecimal('1500'),
    };

    const disposal2 = {
      disposalId: 'd2',
      assetSymbol: 'ETH' as Currency,
      assetId: 'test:eth',
      disposalDate: new Date('2023-07-01'),
      acquisitionDate: new Date('2023-05-15'),
      holdingPeriodDays: 47,
      capitalGainLoss: parseDecimal('300'),
      taxableGainLoss: parseDecimal('150'),
      taxTreatmentCategory: 'short-term',
      lossDisallowed: false,
      quantityDisposed: parseDecimal('1.0'),
      proceedsPerUnit: parseDecimal('2100'),
      costBasisPerUnit: parseDecimal('1800'),
    };

    const result = aggregateAssetGainLoss('ETH', [disposal1, disposal2]);

    const resultValue = assertOk(result);

    const summary = resultValue;
    expect(summary.byCategory.get('short-term')).toEqual({
      count: 2,
      gainLoss: parseDecimal('800'),
      taxableGainLoss: parseDecimal('400'),
    });
  });

  it('handles undefined tax treatment category', () => {
    const disposal = {
      disposalId: 'd1',
      assetSymbol: 'BTC' as Currency,
      assetId: 'test:btc',
      disposalDate: new Date('2023-06-15'),
      acquisitionDate: new Date('2023-03-07'),
      holdingPeriodDays: 100,
      capitalGainLoss: parseDecimal('10000'),
      taxableGainLoss: parseDecimal('5000'),
      taxTreatmentCategory: undefined,
      lossDisallowed: false,
      quantityDisposed: parseDecimal('1.0'),
      proceedsPerUnit: parseDecimal('50000'),
      costBasisPerUnit: parseDecimal('40000'),
    };

    const result = aggregateAssetGainLoss('BTC', [disposal]);

    const resultValue = assertOk(result);

    const summary = resultValue;
    expect(summary.byCategory.get('uncategorized')).toEqual({
      count: 1,
      gainLoss: parseDecimal('10000'),
      taxableGainLoss: parseDecimal('5000'),
    });
  });
});

describe('aggregateOverallGainLoss', () => {
  it('aggregates single asset correctly', () => {
    const btcSummary = {
      assetSymbol: 'BTC' as Currency,
      assetId: 'test:btc',
      totalProceeds: parseDecimal('100000'),
      totalCostBasis: parseDecimal('80000'),
      totalCapitalGainLoss: parseDecimal('20000'),
      totalTaxableGainLoss: parseDecimal('10000'),
      disposalCount: 2,
      byCategory: new Map(),
      disposals: [],
    };

    const assetSummaries = new Map([['BTC', btcSummary]]);

    const result = aggregateOverallGainLoss(assetSummaries, 0);

    const resultValue = assertOk(result);

    const overall = resultValue;
    expect(overall.totalProceeds.toFixed()).toBe('100000');
    expect(overall.totalCostBasis.toFixed()).toBe('80000');
    expect(overall.totalCapitalGainLoss.toFixed()).toBe('20000');
    expect(overall.totalTaxableGainLoss.toFixed()).toBe('10000');
    expect(overall.totalDisposalsProcessed).toBe(2);
    expect(overall.disallowedLossCount).toBe(0);
    expect(overall.byAsset.size).toBe(1);
  });

  it('aggregates multiple assets correctly', () => {
    const btcSummary = {
      assetSymbol: 'BTC' as Currency,
      assetId: 'test:btc',
      totalProceeds: parseDecimal('100000'),
      totalCostBasis: parseDecimal('80000'),
      totalCapitalGainLoss: parseDecimal('20000'),
      totalTaxableGainLoss: parseDecimal('10000'),
      disposalCount: 2,
      byCategory: new Map(),
      disposals: [],
    };

    const ethSummary = {
      assetSymbol: 'ETH' as Currency,
      assetId: 'test:eth',
      totalProceeds: parseDecimal('50000'),
      totalCostBasis: parseDecimal('45000'),
      totalCapitalGainLoss: parseDecimal('5000'),
      totalTaxableGainLoss: parseDecimal('2500'),
      disposalCount: 3,
      byCategory: new Map(),
      disposals: [],
    };

    const assetSummaries = new Map([
      ['BTC', btcSummary],
      ['ETH', ethSummary],
    ]);

    const result = aggregateOverallGainLoss(assetSummaries, 1);

    const resultValue = assertOk(result);

    const overall = resultValue;
    expect(overall.totalProceeds.toFixed()).toBe('150000');
    expect(overall.totalCostBasis.toFixed()).toBe('125000');
    expect(overall.totalCapitalGainLoss.toFixed()).toBe('25000');
    expect(overall.totalTaxableGainLoss.toFixed()).toBe('12500');
    expect(overall.totalDisposalsProcessed).toBe(5);
    expect(overall.disallowedLossCount).toBe(1);
  });

  it('handles empty asset summaries map', () => {
    const result = aggregateOverallGainLoss(new Map(), 0);

    const resultValue = assertOk(result);

    const overall = resultValue;
    expect(overall.totalProceeds.toFixed()).toBe('0');
    expect(overall.totalCostBasis.toFixed()).toBe('0');
    expect(overall.totalCapitalGainLoss.toFixed()).toBe('0');
    expect(overall.totalTaxableGainLoss.toFixed()).toBe('0');
    expect(overall.totalDisposalsProcessed).toBe(0);
    expect(overall.disallowedLossCount).toBe(0);
    expect(overall.byAsset.size).toBe(0);
  });

  it('includes disallowed loss count', () => {
    const btcSummary = {
      assetSymbol: 'BTC' as Currency,
      assetId: 'test:btc',
      totalProceeds: parseDecimal('100000'),
      totalCostBasis: parseDecimal('120000'),
      totalCapitalGainLoss: parseDecimal('-20000'),
      totalTaxableGainLoss: parseDecimal('0'), // losses disallowed
      disposalCount: 2,
      byCategory: new Map(),
      disposals: [],
    };

    const assetSummaries = new Map([['BTC', btcSummary]]);

    const result = aggregateOverallGainLoss(assetSummaries, 2);

    const resultValue = assertOk(result);

    const overall = resultValue;
    expect(overall.disallowedLossCount).toBe(2);
  });
});

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
