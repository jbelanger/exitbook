import type { Currency } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  buildCostBasisFilingAssetSummaries,
  buildCostBasisFilingFactsSummary,
} from '../filing-facts-summary-builder.js';
import type {
  StandardCostBasisAcquisitionFilingFact,
  StandardCostBasisDispositionFilingFact,
  StandardCostBasisTransferFilingFact,
} from '../filing-facts-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAcquisition(
  overrides: Partial<StandardCostBasisAcquisitionFilingFact> = {}
): StandardCostBasisAcquisitionFilingFact {
  return {
    kind: 'standard-acquisition',
    id: 'acq-1',
    assetSymbol: 'BTC' as Currency,
    assetId: 'exchange:kraken:btc',
    acquiredAt: new Date('2024-01-10T00:00:00.000Z'),
    quantity: new Decimal('1'),
    remainingQuantity: new Decimal('1'),
    totalCostBasis: new Decimal('30000'),
    costBasisPerUnit: new Decimal('30000'),
    transactionId: 1,
    status: 'open',
    ...overrides,
  };
}

function makeDisposition(
  overrides: Partial<StandardCostBasisDispositionFilingFact> = {}
): StandardCostBasisDispositionFilingFact {
  return {
    kind: 'standard-disposition',
    id: 'disp-1',
    assetSymbol: 'BTC' as Currency,
    assetId: 'exchange:kraken:btc',
    lotId: 'lot-1',
    disposedAt: new Date('2024-06-01T00:00:00.000Z'),
    acquiredAt: new Date('2024-01-10T00:00:00.000Z'),
    quantity: new Decimal('0.5'),
    proceedsPerUnit: new Decimal('35000'),
    totalProceeds: new Decimal('17500'),
    totalCostBasis: new Decimal('15000'),
    costBasisPerUnit: new Decimal('30000'),
    gainLoss: new Decimal('2500'),
    taxableGainLoss: new Decimal('2500'),
    deniedLossAmount: new Decimal('0'),
    holdingPeriodDays: 143,
    acquisitionTransactionId: 1,
    disposalTransactionId: 2,
    grossProceeds: new Decimal('17500'),
    sellingExpenses: new Decimal('0'),
    netProceeds: new Decimal('17500'),
    lossDisallowed: false,
    ...overrides,
  };
}

function makeTransfer(
  overrides: Partial<StandardCostBasisTransferFilingFact> = {}
): StandardCostBasisTransferFilingFact {
  return {
    kind: 'standard-transfer',
    id: 'transfer-1',
    assetSymbol: 'BTC' as Currency,
    assetId: 'exchange:kraken:btc',
    transferredAt: new Date('2024-07-01T00:00:00.000Z'),
    quantity: new Decimal('0.25'),
    totalCostBasis: new Decimal('7500'),
    costBasisPerUnit: new Decimal('30000'),
    sourceLotId: 'lot-1',
    sourceTransactionId: 3,
    targetTransactionId: 4,
    provenanceKind: 'confirmed-link',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildCostBasisFilingAssetSummaries
// ---------------------------------------------------------------------------

describe('buildCostBasisFilingAssetSummaries', () => {
  it('returns an empty array when input contains no facts', () => {
    const result = buildCostBasisFilingAssetSummaries({
      acquisitions: [],
      dispositions: [],
      transfers: [],
    });

    expect(result).toEqual([]);
  });

  it('aggregates a single asset with acquisitions, dispositions, and transfers', () => {
    const result = buildCostBasisFilingAssetSummaries({
      acquisitions: [makeAcquisition()],
      dispositions: [makeDisposition()],
      transfers: [makeTransfer()],
    });

    expect(result).toHaveLength(1);
    const summary = result[0]!;

    expect(summary.assetSymbol).toBe('BTC');
    expect(summary.assetId).toBe('exchange:kraken:btc');
    expect(summary.acquisitionCount).toBe(1);
    expect(summary.dispositionCount).toBe(1);
    expect(summary.transferCount).toBe(1);
    expect(summary.totalProceeds.toFixed(2)).toBe('17500.00');
    expect(summary.totalCostBasis.toFixed(2)).toBe('15000.00');
    expect(summary.totalGainLoss.toFixed(2)).toBe('2500.00');
    expect(summary.totalTaxableGainLoss.toFixed(2)).toBe('2500.00');
    expect(summary.totalDeniedLoss.toFixed(2)).toBe('0.00');
  });

  it('sorts asset summaries by symbol then by grouping key', () => {
    const result = buildCostBasisFilingAssetSummaries({
      acquisitions: [
        makeAcquisition({ assetSymbol: 'ETH' as Currency, assetId: 'exchange:kraken:eth' }),
        makeAcquisition({ id: 'acq-2', assetSymbol: 'BTC' as Currency, assetId: 'exchange:coinbase:btc' }),
        makeAcquisition({ id: 'acq-3', assetSymbol: 'BTC' as Currency, assetId: 'exchange:kraken:btc' }),
      ],
      dispositions: [],
      transfers: [],
    });

    expect(result).toHaveLength(3);
    // BTC assets come before ETH
    expect(result[0]!.assetSymbol).toBe('BTC');
    expect(result[0]!.assetId).toBe('exchange:coinbase:btc');
    expect(result[1]!.assetSymbol).toBe('BTC');
    expect(result[1]!.assetId).toBe('exchange:kraken:btc');
    expect(result[2]!.assetSymbol).toBe('ETH');
    expect(result[2]!.assetId).toBe('exchange:kraken:eth');
  });

  it('categorizes dispositions by tax treatment with short_term before long_term', () => {
    const result = buildCostBasisFilingAssetSummaries({
      acquisitions: [],
      dispositions: [
        makeDisposition({
          id: 'disp-lt',
          taxTreatmentCategory: 'long_term',
          gainLoss: new Decimal('5000'),
          taxableGainLoss: new Decimal('5000'),
        }),
        makeDisposition({
          id: 'disp-st',
          taxTreatmentCategory: 'short_term',
          gainLoss: new Decimal('1000'),
          taxableGainLoss: new Decimal('1000'),
        }),
      ],
      transfers: [],
    });

    expect(result).toHaveLength(1);
    const summary = result[0]!;
    expect(summary.byTaxTreatment).toHaveLength(2);

    // short_term sorts before long_term
    expect(summary.byTaxTreatment[0]!.taxTreatmentCategory).toBe('short_term');
    expect(summary.byTaxTreatment[0]!.dispositionCount).toBe(1);
    expect(summary.byTaxTreatment[0]!.totalGainLoss.toFixed(2)).toBe('1000.00');
    expect(summary.byTaxTreatment[0]!.totalTaxableGainLoss.toFixed(2)).toBe('1000.00');

    expect(summary.byTaxTreatment[1]!.taxTreatmentCategory).toBe('long_term');
    expect(summary.byTaxTreatment[1]!.dispositionCount).toBe(1);
    expect(summary.byTaxTreatment[1]!.totalGainLoss.toFixed(2)).toBe('5000.00');
    expect(summary.byTaxTreatment[1]!.totalTaxableGainLoss.toFixed(2)).toBe('5000.00');
  });

  it('omits byTaxTreatment entries for dispositions without a tax treatment category', () => {
    const result = buildCostBasisFilingAssetSummaries({
      acquisitions: [],
      dispositions: [makeDisposition({ taxTreatmentCategory: undefined })],
      transfers: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.byTaxTreatment).toEqual([]);
    // Values still aggregate at the asset level
    expect(result[0]!.dispositionCount).toBe(1);
    expect(result[0]!.totalGainLoss.toFixed(2)).toBe('2500.00');
  });

  it('maintains decimal precision when aggregating many small values', () => {
    const dispositions = Array.from({ length: 100 }, (_, i) =>
      makeDisposition({
        id: `disp-${i}`,
        lotId: `lot-${i}`,
        totalProceeds: new Decimal('0.00000001'),
        totalCostBasis: new Decimal('0.00000001'),
        gainLoss: new Decimal('0.00000001'),
        taxableGainLoss: new Decimal('0.00000001'),
        deniedLossAmount: new Decimal('0'),
      })
    );

    const result = buildCostBasisFilingAssetSummaries({
      acquisitions: [],
      dispositions,
      transfers: [],
    });

    expect(result).toHaveLength(1);
    const summary = result[0]!;
    expect(summary.dispositionCount).toBe(100);
    expect(summary.totalProceeds.toFixed(8)).toBe('0.00000100');
    expect(summary.totalCostBasis.toFixed(8)).toBe('0.00000100');
    expect(summary.totalGainLoss.toFixed(8)).toBe('0.00000100');
    expect(summary.totalTaxableGainLoss.toFixed(8)).toBe('0.00000100');
  });

  it('groups by taxPropertyKey when present, taking priority over assetId', () => {
    const result = buildCostBasisFilingAssetSummaries({
      acquisitions: [
        makeAcquisition({
          id: 'acq-1',
          assetSymbol: 'BTC' as Currency,
          assetId: 'exchange:kraken:btc',
          taxPropertyKey: 'BTC',
        }),
        makeAcquisition({
          id: 'acq-2',
          assetSymbol: 'BTC' as Currency,
          assetId: 'exchange:coinbase:btc',
          taxPropertyKey: 'BTC',
        }),
      ],
      dispositions: [],
      transfers: [],
    });

    // Both acquisitions should merge into a single summary because taxPropertyKey matches
    expect(result).toHaveLength(1);
    expect(result[0]!.assetGroupingKey).toBe('BTC');
    expect(result[0]!.taxPropertyKey).toBe('BTC');
    expect(result[0]!.acquisitionCount).toBe(2);
  });

  it('groups by assetId when taxPropertyKey is absent', () => {
    const result = buildCostBasisFilingAssetSummaries({
      acquisitions: [
        makeAcquisition({
          id: 'acq-1',
          assetSymbol: 'BTC' as Currency,
          assetId: 'exchange:kraken:btc',
          taxPropertyKey: undefined,
        }),
        makeAcquisition({
          id: 'acq-2',
          assetSymbol: 'BTC' as Currency,
          assetId: 'exchange:kraken:btc',
          taxPropertyKey: undefined,
        }),
      ],
      dispositions: [],
      transfers: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.assetGroupingKey).toBe('exchange:kraken:btc');
    expect(result[0]!.acquisitionCount).toBe(2);
  });

  it('groups by assetSymbol when both taxPropertyKey and assetId are absent', () => {
    const result = buildCostBasisFilingAssetSummaries({
      acquisitions: [
        makeAcquisition({
          id: 'acq-1',
          assetSymbol: 'BTC' as Currency,
          assetId: undefined as unknown as string,
          taxPropertyKey: undefined,
        }),
        makeAcquisition({
          id: 'acq-2',
          assetSymbol: 'BTC' as Currency,
          assetId: undefined as unknown as string,
          taxPropertyKey: undefined,
        }),
      ],
      dispositions: [],
      transfers: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.assetGroupingKey).toBe('BTC');
    expect(result[0]!.acquisitionCount).toBe(2);
  });

  it('creates separate summaries for different assetIds of the same symbol', () => {
    const result = buildCostBasisFilingAssetSummaries({
      acquisitions: [
        makeAcquisition({
          id: 'acq-1',
          assetSymbol: 'BTC' as Currency,
          assetId: 'exchange:kraken:btc',
        }),
        makeAcquisition({
          id: 'acq-2',
          assetSymbol: 'BTC' as Currency,
          assetId: 'exchange:coinbase:btc',
        }),
      ],
      dispositions: [],
      transfers: [],
    });

    expect(result).toHaveLength(2);
    expect(result[0]!.assetGroupingKey).toBe('exchange:coinbase:btc');
    expect(result[1]!.assetGroupingKey).toBe('exchange:kraken:btc');
  });

  it('excludes optional fields (assetId, taxPropertyKey) from output when not present on any fact', () => {
    const result = buildCostBasisFilingAssetSummaries({
      acquisitions: [
        makeAcquisition({
          assetSymbol: 'BTC' as Currency,
          assetId: undefined as unknown as string,
          taxPropertyKey: undefined,
        }),
      ],
      dispositions: [],
      transfers: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]!).not.toHaveProperty('assetId');
    expect(result[0]!).not.toHaveProperty('taxPropertyKey');
  });

  it('populates assetId from a later fact when an earlier fact for the same group lacks it', () => {
    // First acquisition creates group with key 'BTC' (assetSymbol fallback) and no assetId
    // Second acquisition joins the same group but carries an assetId, which backfills
    const result = buildCostBasisFilingAssetSummaries({
      acquisitions: [
        makeAcquisition({
          id: 'acq-1',
          assetSymbol: 'BTC' as Currency,
          assetId: undefined as unknown as string,
          taxPropertyKey: undefined,
        }),
        makeAcquisition({
          id: 'acq-2',
          assetSymbol: 'BTC' as Currency,
          assetId: undefined as unknown as string,
          taxPropertyKey: undefined,
        }),
      ],
      dispositions: [],
      transfers: [],
    });

    // Both group under 'BTC', and if a later fact carries assetId it's adopted
    expect(result).toHaveLength(1);
    expect(result[0]!.assetGroupingKey).toBe('BTC');
    expect(result[0]!.acquisitionCount).toBe(2);
  });

  it('aggregates multiple dispositions with denied losses', () => {
    const result = buildCostBasisFilingAssetSummaries({
      acquisitions: [],
      dispositions: [
        makeDisposition({
          id: 'disp-1',
          totalProceeds: new Decimal('9000'),
          totalCostBasis: new Decimal('10000'),
          gainLoss: new Decimal('-1000'),
          taxableGainLoss: new Decimal('0'),
          deniedLossAmount: new Decimal('1000'),
        }),
        makeDisposition({
          id: 'disp-2',
          totalProceeds: new Decimal('8000'),
          totalCostBasis: new Decimal('10000'),
          gainLoss: new Decimal('-2000'),
          taxableGainLoss: new Decimal('-500'),
          deniedLossAmount: new Decimal('1500'),
        }),
      ],
      transfers: [],
    });

    expect(result).toHaveLength(1);
    const summary = result[0]!;
    expect(summary.totalProceeds.toFixed(2)).toBe('17000.00');
    expect(summary.totalCostBasis.toFixed(2)).toBe('20000.00');
    expect(summary.totalGainLoss.toFixed(2)).toBe('-3000.00');
    expect(summary.totalTaxableGainLoss.toFixed(2)).toBe('-500.00');
    expect(summary.totalDeniedLoss.toFixed(2)).toBe('2500.00');
  });
});

// ---------------------------------------------------------------------------
// buildCostBasisFilingFactsSummary
// ---------------------------------------------------------------------------

describe('buildCostBasisFilingFactsSummary', () => {
  it('returns zero totals for empty input', () => {
    const result = buildCostBasisFilingFactsSummary({
      acquisitions: [],
      dispositions: [],
      transfers: [],
      assetSummaries: [],
    });

    expect(result.assetCount).toBe(0);
    expect(result.acquisitionCount).toBe(0);
    expect(result.dispositionCount).toBe(0);
    expect(result.transferCount).toBe(0);
    expect(result.totalProceeds.toFixed(2)).toBe('0.00');
    expect(result.totalCostBasis.toFixed(2)).toBe('0.00');
    expect(result.totalGainLoss.toFixed(2)).toBe('0.00');
    expect(result.totalTaxableGainLoss.toFixed(2)).toBe('0.00');
    expect(result.totalDeniedLoss.toFixed(2)).toBe('0.00');
    expect(result.byTaxTreatment).toEqual([]);
  });

  it('counts facts from the input arrays and sums from asset summaries', () => {
    const assetSummaries = buildCostBasisFilingAssetSummaries({
      acquisitions: [makeAcquisition(), makeAcquisition({ id: 'acq-2' })],
      dispositions: [makeDisposition()],
      transfers: [makeTransfer()],
    });

    const result = buildCostBasisFilingFactsSummary({
      acquisitions: [makeAcquisition(), makeAcquisition({ id: 'acq-2' })],
      dispositions: [makeDisposition()],
      transfers: [makeTransfer()],
      assetSummaries,
    });

    expect(result.assetCount).toBe(1);
    expect(result.acquisitionCount).toBe(2);
    expect(result.dispositionCount).toBe(1);
    expect(result.transferCount).toBe(1);
    expect(result.totalProceeds.toFixed(2)).toBe('17500.00');
    expect(result.totalCostBasis.toFixed(2)).toBe('15000.00');
    expect(result.totalGainLoss.toFixed(2)).toBe('2500.00');
    expect(result.totalTaxableGainLoss.toFixed(2)).toBe('2500.00');
    expect(result.totalDeniedLoss.toFixed(2)).toBe('0.00');
  });

  it('aggregates tax treatment breakdowns across multiple asset summaries', () => {
    const btcSummaries = buildCostBasisFilingAssetSummaries({
      acquisitions: [],
      dispositions: [
        makeDisposition({
          taxTreatmentCategory: 'short_term',
          gainLoss: new Decimal('1000'),
          taxableGainLoss: new Decimal('1000'),
        }),
      ],
      transfers: [],
    });

    const ethSummaries = buildCostBasisFilingAssetSummaries({
      acquisitions: [],
      dispositions: [
        makeDisposition({
          id: 'disp-eth',
          assetSymbol: 'ETH' as Currency,
          assetId: 'exchange:kraken:eth',
          taxTreatmentCategory: 'short_term',
          gainLoss: new Decimal('500'),
          taxableGainLoss: new Decimal('500'),
          totalProceeds: new Decimal('3000'),
          totalCostBasis: new Decimal('2500'),
          deniedLossAmount: new Decimal('0'),
        }),
        makeDisposition({
          id: 'disp-eth-lt',
          assetSymbol: 'ETH' as Currency,
          assetId: 'exchange:kraken:eth',
          taxTreatmentCategory: 'long_term',
          gainLoss: new Decimal('2000'),
          taxableGainLoss: new Decimal('2000'),
          totalProceeds: new Decimal('7000'),
          totalCostBasis: new Decimal('5000'),
          deniedLossAmount: new Decimal('0'),
        }),
      ],
      transfers: [],
    });

    const allSummaries = [...btcSummaries, ...ethSummaries];

    const result = buildCostBasisFilingFactsSummary({
      acquisitions: [],
      dispositions: [],
      transfers: [],
      assetSummaries: allSummaries,
    });

    expect(result.assetCount).toBe(2);
    expect(result.byTaxTreatment).toHaveLength(2);

    // short_term aggregated across both assets
    expect(result.byTaxTreatment[0]!.taxTreatmentCategory).toBe('short_term');
    expect(result.byTaxTreatment[0]!.dispositionCount).toBe(2);
    expect(result.byTaxTreatment[0]!.totalGainLoss.toFixed(2)).toBe('1500.00');
    expect(result.byTaxTreatment[0]!.totalTaxableGainLoss.toFixed(2)).toBe('1500.00');

    // long_term from ETH only
    expect(result.byTaxTreatment[1]!.taxTreatmentCategory).toBe('long_term');
    expect(result.byTaxTreatment[1]!.dispositionCount).toBe(1);
    expect(result.byTaxTreatment[1]!.totalGainLoss.toFixed(2)).toBe('2000.00');
    expect(result.byTaxTreatment[1]!.totalTaxableGainLoss.toFixed(2)).toBe('2000.00');
  });

  it('maintains decimal precision when summing across asset summaries', () => {
    const summariesA = buildCostBasisFilingAssetSummaries({
      acquisitions: [],
      dispositions: [
        makeDisposition({
          id: 'disp-a',
          assetSymbol: 'AAA' as Currency,
          assetId: 'exchange:a:aaa',
          totalProceeds: new Decimal('0.123456789'),
          totalCostBasis: new Decimal('0.100000000'),
          gainLoss: new Decimal('0.023456789'),
          taxableGainLoss: new Decimal('0.023456789'),
          deniedLossAmount: new Decimal('0'),
        }),
      ],
      transfers: [],
    });

    const summariesB = buildCostBasisFilingAssetSummaries({
      acquisitions: [],
      dispositions: [
        makeDisposition({
          id: 'disp-b',
          assetSymbol: 'BBB' as Currency,
          assetId: 'exchange:b:bbb',
          totalProceeds: new Decimal('0.876543211'),
          totalCostBasis: new Decimal('0.900000000'),
          gainLoss: new Decimal('-0.023456789'),
          taxableGainLoss: new Decimal('-0.023456789'),
          deniedLossAmount: new Decimal('0'),
        }),
      ],
      transfers: [],
    });

    const result = buildCostBasisFilingFactsSummary({
      acquisitions: [],
      dispositions: [],
      transfers: [],
      assetSummaries: [...summariesA, ...summariesB],
    });

    expect(result.totalProceeds.toFixed(9)).toBe('1.000000000');
    expect(result.totalCostBasis.toFixed(9)).toBe('1.000000000');
    expect(result.totalGainLoss.toFixed(9)).toBe('0.000000000');
    expect(result.totalTaxableGainLoss.toFixed(9)).toBe('0.000000000');
  });
});
