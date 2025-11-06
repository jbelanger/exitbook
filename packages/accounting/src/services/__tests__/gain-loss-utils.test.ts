/**
 * Tests for gain/loss calculation utility functions
 *
 * These tests verify the pure business logic for gain/loss calculations
 * according to the "Functional Core, Imperative Shell" pattern
 */

import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { AcquisitionLot, LotDisposal } from '../../domain/schemas.js';
import type { IJurisdictionRules } from '../../jurisdictions/base-rules.js';
import { CanadaRules } from '../../jurisdictions/canada-rules.js';
import { USRules } from '../../jurisdictions/us-rules.js';
import {
  aggregateAssetGainLoss,
  aggregateOverallGainLoss,
  calculateGainLoss,
  checkLossDisallowance,
} from '../gain-loss-utils.js';
import type { AssetLotMatchResult } from '../lot-matcher.js';

// Helper to create minimal acquisition lot
function createLot(
  id: string,
  asset: string,
  acquisitionDate: Date,
  quantity: string,
  costBasisPerUnit: string
): AcquisitionLot {
  return {
    id,
    asset,
    acquisitionDate,
    quantity: new Decimal(quantity),
    costBasisPerUnit: new Decimal(costBasisPerUnit),
    totalCostBasis: new Decimal(quantity).times(costBasisPerUnit),
    remainingQuantity: new Decimal(quantity),
    acquisitionTransactionId: 1,
  };
}

// Helper to create minimal lot disposal
function createDisposal(
  id: string,
  lotId: string,
  asset: string,
  disposalDate: Date,
  quantityDisposed: string,
  proceedsPerUnit: string,
  costBasisPerUnit: string,
  holdingPeriodDays: number
): LotDisposal {
  const qty = new Decimal(quantityDisposed);
  const proceeds = new Decimal(proceedsPerUnit);
  const costBasis = new Decimal(costBasisPerUnit);
  const gainLoss = proceeds.minus(costBasis).times(qty);

  return {
    id,
    lotId,
    disposalDate,
    quantityDisposed: qty,
    proceedsPerUnit: proceeds,
    costBasisPerUnit: costBasis,
    totalProceeds: proceeds.times(qty),
    totalCostBasis: costBasis.times(qty),
    gainLoss,
    holdingPeriodDays,
    disposalTransactionId: 1,
  };
}

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

      const lot = createLot('lot1', 'BTC', new Date('2023-03-07'), '1.0', '40000');

      const isDisallowed = checkLossDisallowance(disposal, lot, [], [lot], rules);

      expect(isDisallowed).toBe(false);
    });

    it('does not disallow break-even (zero gainLoss)', () => {
      const disposal = createDisposal('d1', 'lot1', 'BTC', new Date('2023-06-15'), '1.0', '40000', '40000', 100);

      const lot = createLot('lot1', 'BTC', new Date('2023-03-07'), '1.0', '40000');

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

      const lot = createLot('lot1', 'BTC', new Date('2023-03-07'), '1.0', '40000');

      const isDisallowed = checkLossDisallowance(disposal, lot, [], [lot], rules);

      expect(isDisallowed).toBe(false);
    });

    it('does not disallow loss when reacquisition is outside 61-day window', () => {
      const disposalDate = new Date('2023-06-15');
      const disposal = createDisposal('d1', 'lot1', 'BTC', disposalDate, '1.0', '30000', '40000', 100);

      const lot1 = createLot('lot1', 'BTC', new Date('2023-03-07'), '1.0', '40000');

      // Reacquisition 40 days before disposal (> 30 days before)
      const lot2 = createLot('lot2', 'BTC', new Date('2023-05-06'), '1.0', '35000');

      // Reacquisition 40 days after disposal (> 30 days after)
      const lot3 = createLot('lot3', 'BTC', new Date('2023-07-25'), '1.0', '35000');

      const isDisallowed = checkLossDisallowance(disposal, lot1, [], [lot1, lot2, lot3], rules);

      expect(isDisallowed).toBe(false);
    });
  });

  describe('superficial loss detection (Canada rules)', () => {
    it('disallows loss when reacquisition within 30 days after disposal', () => {
      const disposalDate = new Date('2023-06-15');
      const disposal = createDisposal('d1', 'lot1', 'BTC', disposalDate, '1.0', '30000', '40000', 100);

      const lot1 = createLot('lot1', 'BTC', new Date('2023-03-07'), '1.0', '40000');

      // Reacquisition 15 days after disposal
      const lot2 = createLot('lot2', 'BTC', new Date('2023-06-30'), '1.0', '35000');

      const isDisallowed = checkLossDisallowance(disposal, lot1, [], [lot1, lot2], rules);

      expect(isDisallowed).toBe(true);
    });

    it('disallows loss when reacquisition within 30 days before disposal', () => {
      const disposalDate = new Date('2023-06-15');
      const disposal = createDisposal('d1', 'lot1', 'BTC', disposalDate, '1.0', '30000', '40000', 100);

      const lot1 = createLot('lot1', 'BTC', new Date('2023-03-07'), '1.0', '40000');

      // Reacquisition 15 days before disposal
      const lot2 = createLot('lot2', 'BTC', new Date('2023-05-31'), '1.0', '35000');

      const isDisallowed = checkLossDisallowance(disposal, lot1, [], [lot1, lot2], rules);

      expect(isDisallowed).toBe(true);
    });

    it('disallows loss on exact 30-day boundary (after)', () => {
      const disposalDate = new Date('2023-06-15');
      const disposal = createDisposal('d1', 'lot1', 'BTC', disposalDate, '1.0', '30000', '40000', 100);

      const lot1 = createLot('lot1', 'BTC', new Date('2023-03-07'), '1.0', '40000');

      // Exactly 30 days after
      const lot2 = createLot('lot2', 'BTC', new Date('2023-07-15'), '1.0', '35000');

      const isDisallowed = checkLossDisallowance(disposal, lot1, [], [lot1, lot2], rules);

      expect(isDisallowed).toBe(true);
    });
  });

  describe('wash sale detection (US rules)', () => {
    const usRules: IJurisdictionRules = new USRules(); // US: 30 days after only

    it('disallows loss when reacquisition within 30 days after disposal', () => {
      const disposalDate = new Date('2023-06-15');
      const disposal = createDisposal('d1', 'lot1', 'BTC', disposalDate, '1.0', '30000', '40000', 100);

      const lot1 = createLot('lot1', 'BTC', new Date('2023-03-07'), '1.0', '40000');

      // Reacquisition 20 days after disposal
      const lot2 = createLot('lot2', 'BTC', new Date('2023-07-05'), '1.0', '35000');

      const isDisallowed = checkLossDisallowance(disposal, lot1, [], [lot1, lot2], usRules);

      expect(isDisallowed).toBe(true);
    });

    it('does not disallow loss when reacquisition before disposal (US does not look back)', () => {
      const disposalDate = new Date('2023-06-15');
      const disposal = createDisposal('d1', 'lot1', 'BTC', disposalDate, '1.0', '30000', '40000', 100);

      const lot1 = createLot('lot1', 'BTC', new Date('2023-03-07'), '1.0', '40000');

      // Reacquisition 15 days before disposal
      const lot2 = createLot('lot2', 'BTC', new Date('2023-05-31'), '1.0', '35000');

      const isDisallowed = checkLossDisallowance(disposal, lot1, [], [lot1, lot2], usRules);

      expect(isDisallowed).toBe(false);
    });
  });

  describe('multiple reacquisitions', () => {
    it('disallows loss when at least one reacquisition is within window', () => {
      const disposalDate = new Date('2023-06-15');
      const disposal = createDisposal('d1', 'lot1', 'BTC', disposalDate, '1.0', '30000', '40000', 100);

      const lot1 = createLot('lot1', 'BTC', new Date('2023-03-07'), '1.0', '40000');
      const lot2 = createLot('lot2', 'BTC', new Date('2023-08-01'), '1.0', '35000'); // outside window
      const lot3 = createLot('lot3', 'BTC', new Date('2023-06-20'), '1.0', '32000'); // within window

      const isDisallowed = checkLossDisallowance(disposal, lot1, [], [lot1, lot2, lot3], rules);

      expect(isDisallowed).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('excludes the disposed lot itself from reacquisition check', () => {
      const disposalDate = new Date('2023-06-15');
      const disposal = createDisposal('d1', 'lot1', 'BTC', disposalDate, '1.0', '30000', '40000', 100);

      const lot1 = createLot('lot1', 'BTC', new Date('2023-06-10'), '1.0', '40000'); // within window but same lot

      const isDisallowed = checkLossDisallowance(disposal, lot1, [], [lot1], rules);

      expect(isDisallowed).toBe(false);
    });
  });
});

describe('aggregateAssetGainLoss', () => {
  it('aggregates single disposal correctly', () => {
    const disposal = {
      disposalId: 'd1',
      asset: 'BTC',
      disposalDate: new Date('2023-06-15'),
      acquisitionDate: new Date('2023-03-07'),
      holdingPeriodDays: 100,
      capitalGainLoss: new Decimal('10000'),
      taxableGainLoss: new Decimal('5000'),
      taxTreatmentCategory: 'short-term',
      lossDisallowed: false,
      quantityDisposed: new Decimal('1.0'),
      proceedsPerUnit: new Decimal('50000'),
      costBasisPerUnit: new Decimal('40000'),
    };

    const result = aggregateAssetGainLoss('BTC', [disposal]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const summary = result.value;
    expect(summary.asset).toBe('BTC');
    expect(summary.totalProceeds.toFixed()).toBe('50000');
    expect(summary.totalCostBasis.toFixed()).toBe('40000');
    expect(summary.totalCapitalGainLoss.toFixed()).toBe('10000');
    expect(summary.totalTaxableGainLoss.toFixed()).toBe('5000');
    expect(summary.disposalCount).toBe(1);
    expect(summary.byCategory.get('short-term')).toEqual({
      count: 1,
      gainLoss: new Decimal('10000'),
      taxableGainLoss: new Decimal('5000'),
    });
  });

  it('aggregates multiple disposals correctly', () => {
    const disposal1 = {
      disposalId: 'd1',
      asset: 'BTC',
      disposalDate: new Date('2023-06-15'),
      acquisitionDate: new Date('2023-03-07'),
      holdingPeriodDays: 100,
      capitalGainLoss: new Decimal('10000'),
      taxableGainLoss: new Decimal('5000'),
      taxTreatmentCategory: 'short-term',
      lossDisallowed: false,
      quantityDisposed: new Decimal('1.0'),
      proceedsPerUnit: new Decimal('50000'),
      costBasisPerUnit: new Decimal('40000'),
    };

    const disposal2 = {
      disposalId: 'd2',
      asset: 'BTC',
      disposalDate: new Date('2024-01-15'),
      acquisitionDate: new Date('2023-03-07'),
      holdingPeriodDays: 365,
      capitalGainLoss: new Decimal('15000'),
      taxableGainLoss: new Decimal('7500'),
      taxTreatmentCategory: 'long-term',
      lossDisallowed: false,
      quantityDisposed: new Decimal('1.5'),
      proceedsPerUnit: new Decimal('60000'),
      costBasisPerUnit: new Decimal('50000'),
    };

    const result = aggregateAssetGainLoss('BTC', [disposal1, disposal2]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const summary = result.value;
    expect(summary.totalProceeds.toFixed()).toBe('140000'); // 50000 + 90000
    expect(summary.totalCostBasis.toFixed()).toBe('115000'); // 40000 + 75000
    expect(summary.totalCapitalGainLoss.toFixed()).toBe('25000'); // 10000 + 15000
    expect(summary.totalTaxableGainLoss.toFixed()).toBe('12500'); // 5000 + 7500
    expect(summary.disposalCount).toBe(2);

    expect(summary.byCategory.get('short-term')).toEqual({
      count: 1,
      gainLoss: new Decimal('10000'),
      taxableGainLoss: new Decimal('5000'),
    });

    expect(summary.byCategory.get('long-term')).toEqual({
      count: 1,
      gainLoss: new Decimal('15000'),
      taxableGainLoss: new Decimal('7500'),
    });
  });

  it('handles empty disposals array', () => {
    const result = aggregateAssetGainLoss('BTC', []);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const summary = result.value;
    expect(summary.asset).toBe('BTC');
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
      asset: 'ETH',
      disposalDate: new Date('2023-06-15'),
      acquisitionDate: new Date('2023-05-01'),
      holdingPeriodDays: 45,
      capitalGainLoss: new Decimal('500'),
      taxableGainLoss: new Decimal('250'),
      taxTreatmentCategory: 'short-term',
      lossDisallowed: false,
      quantityDisposed: new Decimal('1.0'),
      proceedsPerUnit: new Decimal('2000'),
      costBasisPerUnit: new Decimal('1500'),
    };

    const disposal2 = {
      disposalId: 'd2',
      asset: 'ETH',
      disposalDate: new Date('2023-07-01'),
      acquisitionDate: new Date('2023-05-15'),
      holdingPeriodDays: 47,
      capitalGainLoss: new Decimal('300'),
      taxableGainLoss: new Decimal('150'),
      taxTreatmentCategory: 'short-term',
      lossDisallowed: false,
      quantityDisposed: new Decimal('1.0'),
      proceedsPerUnit: new Decimal('2100'),
      costBasisPerUnit: new Decimal('1800'),
    };

    const result = aggregateAssetGainLoss('ETH', [disposal1, disposal2]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const summary = result.value;
    expect(summary.byCategory.get('short-term')).toEqual({
      count: 2,
      gainLoss: new Decimal('800'),
      taxableGainLoss: new Decimal('400'),
    });
  });

  it('handles undefined tax treatment category', () => {
    const disposal = {
      disposalId: 'd1',
      asset: 'BTC',
      disposalDate: new Date('2023-06-15'),
      acquisitionDate: new Date('2023-03-07'),
      holdingPeriodDays: 100,
      capitalGainLoss: new Decimal('10000'),
      taxableGainLoss: new Decimal('5000'),
      taxTreatmentCategory: undefined,
      lossDisallowed: false,
      quantityDisposed: new Decimal('1.0'),
      proceedsPerUnit: new Decimal('50000'),
      costBasisPerUnit: new Decimal('40000'),
    };

    const result = aggregateAssetGainLoss('BTC', [disposal]);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const summary = result.value;
    expect(summary.byCategory.get('uncategorized')).toEqual({
      count: 1,
      gainLoss: new Decimal('10000'),
      taxableGainLoss: new Decimal('5000'),
    });
  });
});

describe('aggregateOverallGainLoss', () => {
  it('aggregates single asset correctly', () => {
    const btcSummary = {
      asset: 'BTC',
      totalProceeds: new Decimal('100000'),
      totalCostBasis: new Decimal('80000'),
      totalCapitalGainLoss: new Decimal('20000'),
      totalTaxableGainLoss: new Decimal('10000'),
      disposalCount: 2,
      byCategory: new Map(),
      disposals: [],
    };

    const assetSummaries = new Map([['BTC', btcSummary]]);

    const result = aggregateOverallGainLoss(assetSummaries, 0);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const overall = result.value;
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
      asset: 'BTC',
      totalProceeds: new Decimal('100000'),
      totalCostBasis: new Decimal('80000'),
      totalCapitalGainLoss: new Decimal('20000'),
      totalTaxableGainLoss: new Decimal('10000'),
      disposalCount: 2,
      byCategory: new Map(),
      disposals: [],
    };

    const ethSummary = {
      asset: 'ETH',
      totalProceeds: new Decimal('50000'),
      totalCostBasis: new Decimal('45000'),
      totalCapitalGainLoss: new Decimal('5000'),
      totalTaxableGainLoss: new Decimal('2500'),
      disposalCount: 3,
      byCategory: new Map(),
      disposals: [],
    };

    const assetSummaries = new Map([
      ['BTC', btcSummary],
      ['ETH', ethSummary],
    ]);

    const result = aggregateOverallGainLoss(assetSummaries, 1);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const overall = result.value;
    expect(overall.totalProceeds.toFixed()).toBe('150000');
    expect(overall.totalCostBasis.toFixed()).toBe('125000');
    expect(overall.totalCapitalGainLoss.toFixed()).toBe('25000');
    expect(overall.totalTaxableGainLoss.toFixed()).toBe('12500');
    expect(overall.totalDisposalsProcessed).toBe(5);
    expect(overall.disallowedLossCount).toBe(1);
  });

  it('handles empty asset summaries map', () => {
    const result = aggregateOverallGainLoss(new Map(), 0);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const overall = result.value;
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
      asset: 'BTC',
      totalProceeds: new Decimal('100000'),
      totalCostBasis: new Decimal('120000'),
      totalCapitalGainLoss: new Decimal('-20000'),
      totalTaxableGainLoss: new Decimal('0'), // losses disallowed
      disposalCount: 2,
      byCategory: new Map(),
      disposals: [],
    };

    const assetSummaries = new Map([['BTC', btcSummary]]);

    const result = aggregateOverallGainLoss(assetSummaries, 2);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const overall = result.value;
    expect(overall.disallowedLossCount).toBe(2);
  });
});

describe('calculateGainLoss', () => {
  const rules: IJurisdictionRules = new CanadaRules();

  it('calculates gain/loss for single asset with single disposal', () => {
    const lot = createLot('lot1', 'BTC', new Date('2023-03-07'), '1.0', '40000');
    const disposal = createDisposal('d1', 'lot1', 'BTC', new Date('2023-06-15'), '1.0', '50000', '40000', 100);

    const assetResult: AssetLotMatchResult = {
      asset: 'BTC',
      lots: [lot],
      disposals: [disposal],
    };

    const result = calculateGainLoss([assetResult], rules);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const gainLoss = result.value;
    expect(gainLoss.totalProceeds.toFixed()).toBe('50000');
    expect(gainLoss.totalCostBasis.toFixed()).toBe('40000');
    expect(gainLoss.totalCapitalGainLoss.toFixed()).toBe('10000');
    expect(gainLoss.totalDisposalsProcessed).toBe(1);
    expect(gainLoss.disallowedLossCount).toBe(0);
  });

  it('skips assets with no lots and no disposals', () => {
    const assetResult: AssetLotMatchResult = {
      asset: 'USD',
      lots: [],
      disposals: [],
    };

    const result = calculateGainLoss([assetResult], rules);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const gainLoss = result.value;
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
      asset: 'BTC',
      lots: [],
      disposals: [disposal],
    };

    const result = calculateGainLoss([assetResult], rules);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;

    expect(result.error.message).toContain('lot-nonexistent');
    expect(result.error.message).toContain('not found');
  });

  it('applies tax treatment categories', () => {
    // Use US rules which distinguish between short-term and long-term gains
    const usRules: IJurisdictionRules = new USRules();

    const lot = createLot('lot1', 'BTC', new Date('2023-03-07'), '1.0', '40000');
    const disposal = createDisposal('d1', 'lot1', 'BTC', new Date('2023-06-15'), '1.0', '50000', '40000', 100);

    const assetResult: AssetLotMatchResult = {
      asset: 'BTC',
      lots: [lot],
      disposals: [disposal],
    };

    const result = calculateGainLoss([assetResult], usRules);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const gainLoss = result.value;
    const btcSummary = gainLoss.byAsset.get('BTC');

    expect(btcSummary).toBeDefined();
    expect(btcSummary!.disposals[0]!.taxTreatmentCategory).toBe('short_term'); // 100 days < 365 days
  });

  it('detects and counts disallowed losses', () => {
    const disposalDate = new Date('2023-06-15');
    const lot1 = createLot('lot1', 'BTC', new Date('2023-03-07'), '1.0', '40000');
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
    const lot2 = createLot('lot2', 'BTC', new Date('2023-06-20'), '1.0', '35000');

    const assetResult: AssetLotMatchResult = {
      asset: 'BTC',
      lots: [lot1, lot2],
      disposals: [disposal],
    };

    const result = calculateGainLoss([assetResult], rules);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const gainLoss = result.value;
    expect(gainLoss.disallowedLossCount).toBe(1);

    const btcSummary = gainLoss.byAsset.get('BTC');
    expect(btcSummary!.disposals[0]!.lossDisallowed).toBe(true);
    expect(btcSummary!.disposals[0]!.taxableGainLoss.toFixed()).toBe('0'); // Loss disallowed
  });

  it('handles multiple assets', () => {
    const btcLot = createLot('lot1', 'BTC', new Date('2023-03-07'), '1.0', '40000');
    const btcDisposal = createDisposal('d1', 'lot1', 'BTC', new Date('2023-06-15'), '1.0', '50000', '40000', 100);

    const ethLot = createLot('lot2', 'ETH', new Date('2023-04-01'), '10.0', '2000');
    const ethDisposal = createDisposal('d2', 'lot2', 'ETH', new Date('2023-07-01'), '5.0', '2500', '2000', 91);

    const assetResults: AssetLotMatchResult[] = [
      { asset: 'BTC', lots: [btcLot], disposals: [btcDisposal] },
      { asset: 'ETH', lots: [ethLot], disposals: [ethDisposal] },
    ];

    const result = calculateGainLoss(assetResults, rules);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const gainLoss = result.value;
    expect(gainLoss.byAsset.size).toBe(2);
    expect(gainLoss.byAsset.has('BTC')).toBe(true);
    expect(gainLoss.byAsset.has('ETH')).toBe(true);
    expect(gainLoss.totalDisposalsProcessed).toBe(2);
  });

  it('handles fiat-only transactions (no crypto assets)', () => {
    const assetResult: AssetLotMatchResult = {
      asset: 'USD',
      lots: [],
      disposals: [],
    };

    const result = calculateGainLoss([assetResult], rules);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const gainLoss = result.value;
    expect(gainLoss.byAsset.size).toBe(0);
    expect(gainLoss.totalProceeds.toFixed()).toBe('0');
    expect(gainLoss.totalCostBasis.toFixed()).toBe('0');
    expect(gainLoss.totalCapitalGainLoss.toFixed()).toBe('0');
    expect(gainLoss.totalTaxableGainLoss.toFixed()).toBe('0');
  });
});
