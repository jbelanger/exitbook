import type { CanadaTaxReport } from '@exitbook/accounting';
import type { CanadaDisplayCostBasisReport } from '@exitbook/accounting';
import { parseDecimal, type Currency } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { buildCanadaAssetCostBasisItems, computeSummaryTotals } from './cost-basis-view-utils.js';

describe('cost-basis-view-utils', () => {
  it('uses Canada report taxable amounts instead of recomputing them from gain/loss', () => {
    const taxReport: CanadaTaxReport = {
      calculationId: 'calc-1',
      taxCurrency: 'CAD',
      acquisitions: [
        {
          id: 'layer-1',
          acquisitionEventId: 'acq-1',
          transactionId: 1,
          taxPropertyKey: 'ca:btc',
          assetSymbol: 'BTC' as Currency,
          acquiredAt: new Date('2024-01-01T00:00:00Z'),
          quantityAcquired: parseDecimal('1'),
          remainingQuantity: parseDecimal('0'),
          totalCostCad: parseDecimal('100'),
          remainingAllocatedAcbCad: parseDecimal('0'),
          costBasisPerUnitCad: parseDecimal('100'),
        },
      ],
      dispositions: [
        {
          id: 'disp-1',
          dispositionEventId: 'disp-1',
          transactionId: 2,
          taxPropertyKey: 'ca:btc',
          assetSymbol: 'BTC' as Currency,
          disposedAt: new Date('2024-02-01T00:00:00Z'),
          quantityDisposed: parseDecimal('1'),
          proceedsCad: parseDecimal('80'),
          costBasisCad: parseDecimal('100'),
          gainLossCad: parseDecimal('-20'),
          taxableGainLossCad: parseDecimal('0'),
          acbPerUnitCad: parseDecimal('100'),
        },
      ],
      transfers: [],
      superficialLossAdjustments: [],
      summary: {
        totalProceedsCad: parseDecimal('80'),
        totalCostBasisCad: parseDecimal('100'),
        totalGainLossCad: parseDecimal('-20'),
        totalTaxableGainLossCad: parseDecimal('0'),
        totalDeniedLossCad: parseDecimal('10'),
      },
    };

    const displayReport: CanadaDisplayCostBasisReport = {
      calculationId: 'calc-1',
      sourceTaxCurrency: 'CAD',
      displayCurrency: 'USD' as Currency,
      acquisitions: [
        {
          ...taxReport.acquisitions[0]!,
          displayCostBasisPerUnit: parseDecimal('75'),
          displayTotalCost: parseDecimal('75'),
          displayRemainingAllocatedCost: parseDecimal('0'),
          fxConversion: {
            sourceTaxCurrency: 'CAD',
            displayCurrency: 'USD' as Currency,
            fxRate: parseDecimal('0.75'),
            fxSource: 'test',
            fxFetchedAt: new Date('2024-01-01T00:00:00Z'),
          },
        },
      ],
      dispositions: [
        {
          ...taxReport.dispositions[0]!,
          displayProceeds: parseDecimal('60'),
          displayCostBasis: parseDecimal('75'),
          displayGainLoss: parseDecimal('-15'),
          displayTaxableGainLoss: parseDecimal('0'),
          displayAcbPerUnit: parseDecimal('75'),
          fxConversion: {
            sourceTaxCurrency: 'CAD',
            displayCurrency: 'USD' as Currency,
            fxRate: parseDecimal('0.75'),
            fxSource: 'test',
            fxFetchedAt: new Date('2024-02-01T00:00:00Z'),
          },
        },
      ],
      transfers: [],
      summary: {
        totalProceeds: parseDecimal('60'),
        totalCostBasis: parseDecimal('75'),
        totalGainLoss: parseDecimal('-15'),
        totalTaxableGainLoss: parseDecimal('0'),
        totalDeniedLoss: parseDecimal('7.5'),
      },
    };

    const assetItems = buildCanadaAssetCostBasisItems(taxReport, displayReport);
    const summaryTotals = computeSummaryTotals(assetItems, 'CA');

    expect(assetItems).toHaveLength(1);
    expect(assetItems[0]?.totalGainLoss).toBe('-15.00');
    expect(assetItems[0]?.totalTaxableGainLoss).toBe('0.00');
    expect(assetItems[0]?.disposals[0]?.taxableGainLoss).toBe('0.00');
    expect(summaryTotals.totalGainLoss).toBe('-15.00');
    expect(summaryTotals.totalTaxableGainLoss).toBe('0.00');
  });

  it('keeps distinct Canada tax properties separate even when they share a symbol', () => {
    const taxReport: CanadaTaxReport = {
      calculationId: 'calc-2',
      taxCurrency: 'CAD',
      acquisitions: [
        {
          id: 'layer-eth-usdc',
          acquisitionEventId: 'acq-eth-usdc',
          transactionId: 10,
          taxPropertyKey: 'ca:erc20:ethereum:0xa0b8',
          assetSymbol: 'USDC' as Currency,
          acquiredAt: new Date('2024-01-01T00:00:00Z'),
          quantityAcquired: parseDecimal('100'),
          remainingQuantity: parseDecimal('0'),
          totalCostCad: parseDecimal('100'),
          remainingAllocatedAcbCad: parseDecimal('0'),
          costBasisPerUnitCad: parseDecimal('1'),
        },
        {
          id: 'layer-sol-usdc',
          acquisitionEventId: 'acq-sol-usdc',
          transactionId: 11,
          taxPropertyKey: 'ca:spl:solana:EPjFWdd5',
          assetSymbol: 'USDC' as Currency,
          acquiredAt: new Date('2024-01-02T00:00:00Z'),
          quantityAcquired: parseDecimal('50'),
          remainingQuantity: parseDecimal('0'),
          totalCostCad: parseDecimal('50'),
          remainingAllocatedAcbCad: parseDecimal('0'),
          costBasisPerUnitCad: parseDecimal('1'),
        },
      ],
      dispositions: [
        {
          id: 'disp-eth-usdc',
          dispositionEventId: 'disp-eth-usdc',
          transactionId: 20,
          taxPropertyKey: 'ca:erc20:ethereum:0xa0b8',
          assetSymbol: 'USDC' as Currency,
          disposedAt: new Date('2024-02-01T00:00:00Z'),
          quantityDisposed: parseDecimal('100'),
          proceedsCad: parseDecimal('110'),
          costBasisCad: parseDecimal('100'),
          gainLossCad: parseDecimal('10'),
          taxableGainLossCad: parseDecimal('5'),
          acbPerUnitCad: parseDecimal('1'),
        },
        {
          id: 'disp-sol-usdc',
          dispositionEventId: 'disp-sol-usdc',
          transactionId: 21,
          taxPropertyKey: 'ca:spl:solana:EPjFWdd5',
          assetSymbol: 'USDC' as Currency,
          disposedAt: new Date('2024-02-02T00:00:00Z'),
          quantityDisposed: parseDecimal('50'),
          proceedsCad: parseDecimal('45'),
          costBasisCad: parseDecimal('50'),
          gainLossCad: parseDecimal('-5'),
          taxableGainLossCad: parseDecimal('-2.5'),
          acbPerUnitCad: parseDecimal('1'),
        },
      ],
      transfers: [],
      superficialLossAdjustments: [],
      summary: {
        totalProceedsCad: parseDecimal('155'),
        totalCostBasisCad: parseDecimal('150'),
        totalGainLossCad: parseDecimal('5'),
        totalTaxableGainLossCad: parseDecimal('2.5'),
        totalDeniedLossCad: parseDecimal('0'),
      },
    };

    const assetItems = buildCanadaAssetCostBasisItems(taxReport);
    const assetLabels = assetItems.map((item) => item.asset).sort();

    expect(assetItems).toHaveLength(2);
    expect(assetLabels).toEqual(['USDC (ca:erc20:ethereum:0xa0b8)', 'USDC (ca:spl:solana:EPjFWdd5)']);
    expect(assetItems.every((item) => item.disposalCount === 1)).toBe(true);
  });
});
