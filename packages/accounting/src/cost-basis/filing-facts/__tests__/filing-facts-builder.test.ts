import { parseDecimal, type Currency } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { buildCostBasisFilingFacts } from '../filing-facts-builder.js';

import { createCanadaWorkflowArtifact, createStandardWorkflowArtifact } from './test-utils.js';

describe('buildCostBasisFilingFacts', () => {
  it('builds standard filing facts with shared summaries and tax-treatment breakdowns', () => {
    const result = assertOk(
      buildCostBasisFilingFacts({
        artifact: createStandardWorkflowArtifact(),
        scopeKey: 'scope:us:2024',
        snapshotId: 'snapshot-us-2024',
      })
    );

    expect(result.kind).toBe('standard');
    expect(result.scopeKey).toBe('scope:us:2024');
    expect(result.snapshotId).toBe('snapshot-us-2024');
    expect(result.summary.assetCount).toBe(1);
    expect(result.summary.acquisitionCount).toBe(2);
    expect(result.summary.dispositionCount).toBe(2);
    expect(result.summary.transferCount).toBe(1);
    expect(result.summary.totalProceeds.toFixed(2)).toBe('14925.00');
    expect(result.summary.totalCostBasis.toFixed(2)).toBe('16000.00');
    expect(result.summary.totalGainLoss.toFixed(2)).toBe('-1075.00');
    expect(result.summary.totalTaxableGainLoss.toFixed(2)).toBe('-30.00');
    expect(result.summary.totalDeniedLoss.toFixed(2)).toBe('1045.00');
    expect(
      result.summary.byTaxTreatment.map((item) => ({
        taxTreatmentCategory: item.taxTreatmentCategory,
        dispositionCount: item.dispositionCount,
        totalGainLoss: item.totalGainLoss.toFixed(2),
        totalTaxableGainLoss: item.totalTaxableGainLoss.toFixed(2),
      }))
    ).toEqual([
      {
        taxTreatmentCategory: 'short_term',
        dispositionCount: 1,
        totalGainLoss: '-30.00',
        totalTaxableGainLoss: '-30.00',
      },
      {
        taxTreatmentCategory: 'long_term',
        dispositionCount: 1,
        totalGainLoss: '-1045.00',
        totalTaxableGainLoss: '0.00',
      },
    ]);

    expect(result.assetSummaries).toHaveLength(1);
    expect(result.assetSummaries[0]).toMatchObject({
      assetGroupingKey: 'exchange:kraken:btc',
      assetId: 'exchange:kraken:btc',
      assetSymbol: 'BTC',
      acquisitionCount: 2,
      dispositionCount: 2,
      transferCount: 1,
    });
    expect(result.assetSummaries[0]!.totalDeniedLoss.toFixed(2)).toBe('1045.00');
  });

  it('normalizes US exact-anniversary dispositions to short_term even when the artifact stored long_term', () => {
    const artifact = createStandardWorkflowArtifact({
      summary: {
        ...createStandardWorkflowArtifact().summary,
        lotsCreated: 1,
        disposalsProcessed: 1,
        totalCapitalGainLoss: parseDecimal('500'),
        totalTaxableGainLoss: parseDecimal('500'),
      },
      lots: [
        {
          id: 'lot-boundary',
          calculationId: 'df94bdd2-b8ee-4486-9c83-b0f91ca62514',
          acquisitionTransactionId: 1,
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC' as Currency,
          quantity: parseDecimal('1'),
          costBasisPerUnit: parseDecimal('10000'),
          totalCostBasis: parseDecimal('10000'),
          acquisitionDate: new Date('2023-01-01T12:34:56.000Z'),
          method: 'fifo',
          remainingQuantity: parseDecimal('0'),
          status: 'fully_disposed',
          createdAt: new Date('2026-03-15T12:00:00.000Z'),
          updatedAt: new Date('2026-03-15T12:00:00.000Z'),
        },
      ],
      disposals: [
        {
          id: 'disp-boundary',
          lotId: 'lot-boundary',
          disposalTransactionId: 2,
          quantityDisposed: parseDecimal('1'),
          proceedsPerUnit: parseDecimal('10500'),
          totalProceeds: parseDecimal('10500'),
          grossProceeds: parseDecimal('10500'),
          sellingExpenses: parseDecimal('0'),
          netProceeds: parseDecimal('10500'),
          costBasisPerUnit: parseDecimal('10000'),
          totalCostBasis: parseDecimal('10000'),
          gainLoss: parseDecimal('500'),
          disposalDate: new Date('2024-01-01T01:00:00.000Z'),
          holdingPeriodDays: 365,
          lossDisallowed: false,
          disallowedLossAmount: undefined,
          taxTreatmentCategory: 'long_term',
          createdAt: new Date('2026-03-15T12:00:00.000Z'),
        },
      ],
      lotTransfers: [],
    });

    const result = assertOk(buildCostBasisFilingFacts({ artifact }));
    expect(result.kind).toBe('standard');
    expect(result.dispositions[0]!.taxTreatmentCategory).toBe('short_term');
    expect(result.summary.byTaxTreatment.map((item) => item.taxTreatmentCategory)).toEqual(['short_term']);
  });

  it('normalizes older US artifacts without taxTreatmentCategory from calendar dates', () => {
    const artifact = createStandardWorkflowArtifact({
      lots: [
        {
          ...createStandardWorkflowArtifact().lots[0]!,
          id: 'lot-older',
          acquisitionDate: new Date('2023-01-01T00:00:00.000Z'),
        },
      ],
      disposals: [
        {
          ...createStandardWorkflowArtifact().disposals[0]!,
          id: 'disp-older',
          lotId: 'lot-older',
          disposalDate: new Date('2024-01-02T23:59:59.000Z'),
          holdingPeriodDays: 366,
          taxTreatmentCategory: undefined,
          gainLoss: parseDecimal('100'),
          totalProceeds: parseDecimal('10100'),
          grossProceeds: parseDecimal('10100'),
          netProceeds: parseDecimal('10100'),
          sellingExpenses: parseDecimal('0'),
          totalCostBasis: parseDecimal('10000'),
          proceedsPerUnit: parseDecimal('10100'),
          costBasisPerUnit: parseDecimal('10000'),
          disallowedLossAmount: undefined,
          lossDisallowed: false,
        },
      ],
      lotTransfers: [],
    });

    const result = assertOk(buildCostBasisFilingFacts({ artifact }));
    expect(result.kind).toBe('standard');
    expect(result.dispositions[0]!.taxTreatmentCategory).toBe('long_term');
  });

  it('builds Canada filing facts with tax-report summaries and superficial-loss adjustments', () => {
    const result = assertOk(buildCostBasisFilingFacts({ artifact: createCanadaWorkflowArtifact() }));

    expect(result.kind).toBe('canada');
    if (result.kind !== 'canada') {
      throw new Error('Expected Canada filing facts');
    }
    expect(result.summary.assetCount).toBe(1);
    expect(result.summary.acquisitionCount).toBe(1);
    expect(result.summary.dispositionCount).toBe(1);
    expect(result.summary.transferCount).toBe(1);
    expect(result.summary.totalProceeds.toFixed(2)).toBe('36000.00');
    expect(result.summary.totalCostBasis.toFixed(2)).toBe('30000.00');
    expect(result.summary.totalGainLoss.toFixed(2)).toBe('6000.00');
    expect(result.summary.totalTaxableGainLoss.toFixed(2)).toBe('3050.00');
    expect(result.summary.totalDeniedLoss.toFixed(2)).toBe('100.00');
    expect(result.summary.byTaxTreatment).toEqual([]);
    expect(result.assetSummaries[0]).toMatchObject({
      assetGroupingKey: 'BTC',
      taxPropertyKey: 'BTC',
      assetSymbol: 'BTC',
      acquisitionCount: 1,
      dispositionCount: 1,
      transferCount: 1,
    });
    expect(result.superficialLossAdjustments).toHaveLength(1);
    expect(result.superficialLossAdjustments[0]).toMatchObject({
      id: 'sla-1',
      relatedDispositionId: 'disp-1',
      substitutedPropertyAcquisitionId: 'layer-1',
      taxPropertyKey: 'BTC',
      assetSymbol: 'BTC',
    });
    expect(result.superficialLossAdjustments[0]!.deniedLossAmount.toFixed(2)).toBe('100.00');
  });
});
