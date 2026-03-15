import type {
  CanadaCostBasisFilingFacts,
  CanadaDisplayCostBasisReport,
  ConvertedLotDisposal,
  StandardCostBasisFilingFacts,
} from '@exitbook/accounting';
import { parseDecimal, type Currency } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import {
  buildCanadaAssetCostBasisItems,
  buildStandardAssetCostBasisItems,
  buildSummaryTotalsFromAssetItems,
} from './cost-basis-view-utils.js';

function createStandardFilingFacts(): StandardCostBasisFilingFacts {
  return {
    kind: 'standard',
    calculationId: 'calc-1',
    jurisdiction: 'US',
    method: 'fifo',
    taxYear: 2024,
    taxCurrency: 'USD',
    summary: {
      assetCount: 1,
      acquisitionCount: 1,
      dispositionCount: 1,
      transferCount: 1,
      totalProceeds: parseDecimal('60'),
      totalCostBasis: parseDecimal('50'),
      totalGainLoss: parseDecimal('10'),
      totalTaxableGainLoss: parseDecimal('10'),
      totalDeniedLoss: parseDecimal('0'),
      byTaxTreatment: [
        {
          taxTreatmentCategory: 'short_term',
          dispositionCount: 1,
          totalGainLoss: parseDecimal('10'),
          totalTaxableGainLoss: parseDecimal('10'),
        },
      ],
    },
    assetSummaries: [
      {
        assetGroupingKey: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC' as Currency,
        assetId: 'blockchain:bitcoin:native',
        acquisitionCount: 1,
        dispositionCount: 1,
        transferCount: 1,
        totalProceeds: parseDecimal('60'),
        totalCostBasis: parseDecimal('50'),
        totalGainLoss: parseDecimal('10'),
        totalTaxableGainLoss: parseDecimal('10'),
        totalDeniedLoss: parseDecimal('0'),
        byTaxTreatment: [
          {
            taxTreatmentCategory: 'short_term',
            dispositionCount: 1,
            totalGainLoss: parseDecimal('10'),
            totalTaxableGainLoss: parseDecimal('10'),
          },
        ],
      },
    ],
    acquisitions: [
      {
        kind: 'standard-acquisition',
        id: 'lot-1',
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC' as Currency,
        acquiredAt: new Date('2024-01-01T00:00:00Z'),
        quantity: parseDecimal('1'),
        remainingQuantity: parseDecimal('0.75'),
        totalCostBasis: parseDecimal('100'),
        costBasisPerUnit: parseDecimal('100'),
        transactionId: 1,
        status: 'open',
      },
    ],
    dispositions: [
      {
        kind: 'standard-disposition',
        id: 'disp-1',
        lotId: 'lot-1',
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC' as Currency,
        acquiredAt: new Date('2024-01-01T00:00:00Z'),
        disposedAt: new Date('2024-02-01T00:00:00Z'),
        quantity: parseDecimal('0.5'),
        proceedsPerUnit: parseDecimal('120'),
        totalProceeds: parseDecimal('60'),
        totalCostBasis: parseDecimal('50'),
        costBasisPerUnit: parseDecimal('100'),
        gainLoss: parseDecimal('10'),
        taxableGainLoss: parseDecimal('10'),
        deniedLossAmount: parseDecimal('0'),
        taxTreatmentCategory: 'short_term',
        holdingPeriodDays: 31,
        acquisitionTransactionId: 1,
        disposalTransactionId: 2,
        grossProceeds: parseDecimal('60'),
        sellingExpenses: parseDecimal('0'),
        netProceeds: parseDecimal('60'),
        lossDisallowed: false,
      },
    ],
    transfers: [
      {
        kind: 'standard-transfer',
        id: 'xfer-1',
        sourceLotId: 'lot-1',
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC' as Currency,
        transferredAt: new Date('2024-03-01T00:00:00Z'),
        quantity: parseDecimal('0.25'),
        totalCostBasis: parseDecimal('25'),
        costBasisPerUnit: parseDecimal('100'),
        sourceTransactionId: 3,
        targetTransactionId: 4,
        provenanceKind: 'confirmed-link',
        linkedConfirmedLinkId: 1,
        sourceAcquiredAt: new Date('2024-01-01T00:00:00Z'),
        sameAssetFeeAmount: parseDecimal('2.50'),
      },
    ],
  };
}

describe('cost-basis-view-utils', () => {
  it('builds a US asset item from filing facts', () => {
    const assetItems = buildStandardAssetCostBasisItems(createStandardFilingFacts());
    const summaryTotals = buildSummaryTotalsFromAssetItems(assetItems, { includeTaxTreatmentSplit: true });

    expect(assetItems).toHaveLength(1);
    expect(assetItems[0]).toMatchObject({
      asset: 'BTC',
      lotCount: 1,
      disposalCount: 1,
      transferCount: 1,
      totalProceeds: '60.00',
      totalCostBasis: '50.00',
      totalGainLoss: '10.00',
      totalTaxableGainLoss: '10.00',
      shortTermGainLoss: '10.00',
      longTermGainLoss: '0.00',
      shortTermCount: 1,
      longTermCount: 0,
    });
    expect(summaryTotals).toMatchObject({
      totalProceeds: '60.00',
      totalCostBasis: '50.00',
      totalGainLoss: '10.00',
      totalTaxableGainLoss: '10.00',
      shortTermGainLoss: '10.00',
      longTermGainLoss: '0.00',
    });
  });

  it('uses standard filing-facts taxable amounts instead of recomputing them from converted gain/loss', () => {
    const filingFacts = createStandardFilingFacts();
    filingFacts.summary.totalProceeds = parseDecimal('90');
    filingFacts.summary.totalCostBasis = parseDecimal('100');
    filingFacts.summary.totalGainLoss = parseDecimal('-10');
    filingFacts.summary.totalTaxableGainLoss = parseDecimal('0');
    filingFacts.summary.totalDeniedLoss = parseDecimal('10');
    filingFacts.summary.byTaxTreatment = [
      {
        taxTreatmentCategory: 'short_term',
        dispositionCount: 1,
        totalGainLoss: parseDecimal('-10'),
        totalTaxableGainLoss: parseDecimal('0'),
      },
    ];
    filingFacts.assetSummaries[0]!.totalProceeds = parseDecimal('90');
    filingFacts.assetSummaries[0]!.totalCostBasis = parseDecimal('100');
    filingFacts.assetSummaries[0]!.totalGainLoss = parseDecimal('-10');
    filingFacts.assetSummaries[0]!.totalTaxableGainLoss = parseDecimal('0');
    filingFacts.assetSummaries[0]!.totalDeniedLoss = parseDecimal('10');
    filingFacts.assetSummaries[0]!.byTaxTreatment = [
      {
        taxTreatmentCategory: 'short_term',
        dispositionCount: 1,
        totalGainLoss: parseDecimal('-10'),
        totalTaxableGainLoss: parseDecimal('0'),
      },
    ];
    filingFacts.dispositions[0] = {
      ...filingFacts.dispositions[0]!,
      proceedsPerUnit: parseDecimal('180'),
      totalProceeds: parseDecimal('90'),
      gainLoss: parseDecimal('-10'),
      taxableGainLoss: parseDecimal('0'),
      deniedLossAmount: parseDecimal('10'),
      grossProceeds: parseDecimal('90'),
      netProceeds: parseDecimal('90'),
      lossDisallowed: true,
    };

    const report = {
      disposals: [
        {
          id: 'disp-1',
          displayProceedsPerUnit: parseDecimal('135'),
          displayTotalProceeds: parseDecimal('67.50'),
          displayCostBasisPerUnit: parseDecimal('150'),
          displayTotalCostBasis: parseDecimal('75.00'),
          displayGainLoss: parseDecimal('-7.50'),
          fxConversion: {
            originalCurrency: 'USD',
            displayCurrency: 'CAD',
            fxRate: parseDecimal('0.75'),
            fxSource: 'test',
            fxFetchedAt: new Date('2024-02-01T00:00:00Z'),
          },
        } as ConvertedLotDisposal,
      ],
      lots: [],
      lotTransfers: [],
    };

    const assetItems = buildStandardAssetCostBasisItems(filingFacts, report);
    const summaryTotals = buildSummaryTotalsFromAssetItems(assetItems, { includeTaxTreatmentSplit: true });

    expect(assetItems[0]?.disposals[0]?.gainLoss).toBe('-7.50');
    expect(assetItems[0]?.disposals[0]?.taxableGainLoss).toBe('0.00');
    expect(assetItems[0]?.totalTaxableGainLoss).toBe('0.00');
    expect(summaryTotals.totalTaxableGainLoss).toBe('0.00');
    expect(summaryTotals.shortTermGainLoss).toBe('-7.50');
  });

  it('uses Canada filing-facts taxable amounts and display overrides', () => {
    const filingFacts = {
      kind: 'canada',
      calculationId: 'calc-1',
      jurisdiction: 'CA',
      method: 'average-cost',
      taxYear: 2024,
      taxCurrency: 'CAD',
      summary: {
        assetCount: 1,
        acquisitionCount: 1,
        dispositionCount: 1,
        transferCount: 0,
        totalProceeds: parseDecimal('80'),
        totalCostBasis: parseDecimal('100'),
        totalGainLoss: parseDecimal('-20'),
        totalTaxableGainLoss: parseDecimal('0'),
        totalDeniedLoss: parseDecimal('10'),
        byTaxTreatment: [],
      },
      assetSummaries: [
        {
          assetGroupingKey: 'ca:btc',
          assetSymbol: 'BTC' as Currency,
          taxPropertyKey: 'ca:btc',
          acquisitionCount: 1,
          dispositionCount: 1,
          transferCount: 0,
          totalProceeds: parseDecimal('80'),
          totalCostBasis: parseDecimal('100'),
          totalGainLoss: parseDecimal('-20'),
          totalTaxableGainLoss: parseDecimal('0'),
          totalDeniedLoss: parseDecimal('10'),
          byTaxTreatment: [],
        },
      ],
      acquisitions: [
        {
          kind: 'canada-acquisition',
          id: 'layer-1',
          acquisitionEventId: 'acq-1',
          transactionId: 1,
          taxPropertyKey: 'ca:btc',
          assetSymbol: 'BTC' as Currency,
          acquiredAt: new Date('2024-01-01T00:00:00Z'),
          quantity: parseDecimal('1'),
          remainingQuantity: parseDecimal('0'),
          totalCostBasis: parseDecimal('100'),
          remainingAllocatedCostBasis: parseDecimal('0'),
          costBasisPerUnit: parseDecimal('100'),
        },
      ],
      dispositions: [
        {
          kind: 'canada-disposition',
          id: 'disp-1',
          dispositionEventId: 'disp-1',
          transactionId: 2,
          taxPropertyKey: 'ca:btc',
          assetSymbol: 'BTC' as Currency,
          disposedAt: new Date('2024-02-01T00:00:00Z'),
          quantity: parseDecimal('1'),
          proceedsPerUnit: parseDecimal('80'),
          totalProceeds: parseDecimal('80'),
          totalCostBasis: parseDecimal('100'),
          gainLoss: parseDecimal('-20'),
          taxableGainLoss: parseDecimal('0'),
          deniedLossAmount: parseDecimal('10'),
          costBasisPerUnit: parseDecimal('100'),
        },
      ],
      transfers: [],
      superficialLossAdjustments: [],
    } as CanadaCostBasisFilingFacts;

    const displayReport = {
      calculationId: 'calc-1',
      sourceTaxCurrency: 'CAD',
      displayCurrency: 'USD' as Currency,
      acquisitions: [
        {
          id: 'layer-1',
          displayCostBasisPerUnit: parseDecimal('75'),
          displayTotalCost: parseDecimal('75'),
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
          id: 'disp-1',
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
    } as unknown as CanadaDisplayCostBasisReport;

    const assetItems = buildCanadaAssetCostBasisItems(filingFacts, displayReport);
    const summaryTotals = buildSummaryTotalsFromAssetItems(assetItems);

    expect(assetItems).toHaveLength(1);
    expect(assetItems[0]?.totalGainLoss).toBe('-15.00');
    expect(assetItems[0]?.totalTaxableGainLoss).toBe('0.00');
    expect(assetItems[0]?.disposals[0]?.taxableGainLoss).toBe('0.00');
    expect(summaryTotals.totalGainLoss).toBe('-15.00');
    expect(summaryTotals.totalTaxableGainLoss).toBe('0.00');
  });

  it('keeps distinct Canada tax properties separate even when they share a symbol', () => {
    const filingFacts = {
      kind: 'canada',
      calculationId: 'calc-2',
      jurisdiction: 'CA',
      method: 'average-cost',
      taxYear: 2024,
      taxCurrency: 'CAD',
      summary: {
        assetCount: 2,
        acquisitionCount: 2,
        dispositionCount: 2,
        transferCount: 0,
        totalProceeds: parseDecimal('155'),
        totalCostBasis: parseDecimal('150'),
        totalGainLoss: parseDecimal('5'),
        totalTaxableGainLoss: parseDecimal('2.5'),
        totalDeniedLoss: parseDecimal('0'),
        byTaxTreatment: [],
      },
      assetSummaries: [
        {
          assetGroupingKey: 'ca:erc20:ethereum:0xa0b8',
          assetSymbol: 'USDC' as Currency,
          taxPropertyKey: 'ca:erc20:ethereum:0xa0b8',
          acquisitionCount: 1,
          dispositionCount: 1,
          transferCount: 0,
          totalProceeds: parseDecimal('110'),
          totalCostBasis: parseDecimal('100'),
          totalGainLoss: parseDecimal('10'),
          totalTaxableGainLoss: parseDecimal('5'),
          totalDeniedLoss: parseDecimal('0'),
          byTaxTreatment: [],
        },
        {
          assetGroupingKey: 'ca:spl:solana:EPjFWdd5',
          assetSymbol: 'USDC' as Currency,
          taxPropertyKey: 'ca:spl:solana:EPjFWdd5',
          acquisitionCount: 1,
          dispositionCount: 1,
          transferCount: 0,
          totalProceeds: parseDecimal('45'),
          totalCostBasis: parseDecimal('50'),
          totalGainLoss: parseDecimal('-5'),
          totalTaxableGainLoss: parseDecimal('-2.5'),
          totalDeniedLoss: parseDecimal('0'),
          byTaxTreatment: [],
        },
      ],
      acquisitions: [
        {
          kind: 'canada-acquisition',
          id: 'layer-eth-usdc',
          acquisitionEventId: 'acq-eth-usdc',
          transactionId: 10,
          taxPropertyKey: 'ca:erc20:ethereum:0xa0b8',
          assetSymbol: 'USDC' as Currency,
          acquiredAt: new Date('2024-01-01T00:00:00Z'),
          quantity: parseDecimal('100'),
          remainingQuantity: parseDecimal('0'),
          totalCostBasis: parseDecimal('100'),
          remainingAllocatedCostBasis: parseDecimal('0'),
          costBasisPerUnit: parseDecimal('1'),
        },
        {
          kind: 'canada-acquisition',
          id: 'layer-sol-usdc',
          acquisitionEventId: 'acq-sol-usdc',
          transactionId: 11,
          taxPropertyKey: 'ca:spl:solana:EPjFWdd5',
          assetSymbol: 'USDC' as Currency,
          acquiredAt: new Date('2024-01-02T00:00:00Z'),
          quantity: parseDecimal('50'),
          remainingQuantity: parseDecimal('0'),
          totalCostBasis: parseDecimal('50'),
          remainingAllocatedCostBasis: parseDecimal('0'),
          costBasisPerUnit: parseDecimal('1'),
        },
      ],
      dispositions: [
        {
          kind: 'canada-disposition',
          id: 'disp-eth-usdc',
          dispositionEventId: 'disp-eth-usdc',
          transactionId: 20,
          taxPropertyKey: 'ca:erc20:ethereum:0xa0b8',
          assetSymbol: 'USDC' as Currency,
          disposedAt: new Date('2024-02-01T00:00:00Z'),
          quantity: parseDecimal('100'),
          proceedsPerUnit: parseDecimal('1.1'),
          totalProceeds: parseDecimal('110'),
          totalCostBasis: parseDecimal('100'),
          gainLoss: parseDecimal('10'),
          taxableGainLoss: parseDecimal('5'),
          deniedLossAmount: parseDecimal('0'),
          costBasisPerUnit: parseDecimal('1'),
        },
        {
          kind: 'canada-disposition',
          id: 'disp-sol-usdc',
          dispositionEventId: 'disp-sol-usdc',
          transactionId: 21,
          taxPropertyKey: 'ca:spl:solana:EPjFWdd5',
          assetSymbol: 'USDC' as Currency,
          disposedAt: new Date('2024-02-02T00:00:00Z'),
          quantity: parseDecimal('50'),
          proceedsPerUnit: parseDecimal('0.9'),
          totalProceeds: parseDecimal('45'),
          totalCostBasis: parseDecimal('50'),
          gainLoss: parseDecimal('-5'),
          taxableGainLoss: parseDecimal('-2.5'),
          deniedLossAmount: parseDecimal('0'),
          costBasisPerUnit: parseDecimal('1'),
        },
      ],
      transfers: [],
      superficialLossAdjustments: [],
    } as CanadaCostBasisFilingFacts;

    const assetItems = buildCanadaAssetCostBasisItems(filingFacts);
    const assetLabels = assetItems.map((item) => item.asset).sort();

    expect(assetItems).toHaveLength(2);
    expect(assetLabels).toEqual(['USDC (ca:erc20:ethereum:0xa0b8)', 'USDC (ca:spl:solana:EPjFWdd5)']);
    expect(assetItems.every((item) => item.disposalCount === 1)).toBe(true);
  });

  it('builds Canada transfer timeline rows from filing facts instead of dropping them', () => {
    const filingFacts = {
      kind: 'canada',
      calculationId: 'calc-3',
      jurisdiction: 'CA',
      method: 'average-cost',
      taxYear: 2024,
      taxCurrency: 'CAD',
      summary: {
        assetCount: 1,
        acquisitionCount: 0,
        dispositionCount: 0,
        transferCount: 1,
        totalProceeds: parseDecimal('0'),
        totalCostBasis: parseDecimal('0'),
        totalGainLoss: parseDecimal('0'),
        totalTaxableGainLoss: parseDecimal('0'),
        totalDeniedLoss: parseDecimal('0'),
        byTaxTreatment: [],
      },
      assetSummaries: [
        {
          assetGroupingKey: 'ca:btc',
          assetSymbol: 'BTC' as Currency,
          taxPropertyKey: 'ca:btc',
          acquisitionCount: 0,
          dispositionCount: 0,
          transferCount: 1,
          totalProceeds: parseDecimal('0'),
          totalCostBasis: parseDecimal('0'),
          totalGainLoss: parseDecimal('0'),
          totalTaxableGainLoss: parseDecimal('0'),
          totalDeniedLoss: parseDecimal('0'),
          byTaxTreatment: [],
        },
      ],
      acquisitions: [],
      dispositions: [],
      transfers: [
        {
          kind: 'canada-transfer',
          id: 'link:10:transfer',
          direction: 'internal',
          sourceTransferEventId: 'link:10:transfer-out',
          targetTransferEventId: 'link:10:transfer-in',
          sourceTransactionId: 2,
          targetTransactionId: 3,
          linkedConfirmedLinkId: 10,
          transactionId: 3,
          taxPropertyKey: 'ca:btc',
          assetSymbol: 'BTC' as Currency,
          transferredAt: new Date('2024-01-10T00:00:00Z'),
          quantity: parseDecimal('1'),
          totalCostBasis: parseDecimal('10025'),
          costBasisPerUnit: parseDecimal('10025'),
          feeAdjustment: parseDecimal('25'),
        },
      ],
      superficialLossAdjustments: [],
    } as CanadaCostBasisFilingFacts;

    const displayReport = {
      calculationId: 'calc-3',
      sourceTaxCurrency: 'CAD',
      displayCurrency: 'USD' as Currency,
      acquisitions: [],
      dispositions: [],
      transfers: [
        {
          id: 'link:10:transfer',
          displayCarriedAcb: parseDecimal('7518.75'),
          displayCarriedAcbPerUnit: parseDecimal('7518.75'),
          displayMarketValue: parseDecimal('9000'),
          displayFeeAdjustment: parseDecimal('18.75'),
          fxConversion: {
            sourceTaxCurrency: 'CAD',
            displayCurrency: 'USD' as Currency,
            fxRate: parseDecimal('0.75'),
            fxSource: 'test',
            fxFetchedAt: new Date('2024-01-10T00:00:00Z'),
          },
        },
      ],
      summary: {
        totalProceeds: parseDecimal('0'),
        totalCostBasis: parseDecimal('0'),
        totalGainLoss: parseDecimal('0'),
        totalTaxableGainLoss: parseDecimal('0'),
        totalDeniedLoss: parseDecimal('0'),
      },
    } as unknown as CanadaDisplayCostBasisReport;

    const assetItems = buildCanadaAssetCostBasisItems(filingFacts, displayReport);

    expect(assetItems).toHaveLength(1);
    expect(assetItems[0]?.transferCount).toBe(1);
    expect(assetItems[0]?.transfers[0]).toMatchObject({
      direction: 'internal',
      sourceTransactionId: 2,
      targetTransactionId: 3,
      totalCostBasis: '7518.75',
      costBasisPerUnit: '7518.75',
      marketValue: '9000.00',
      feeAmount: '18.75',
      feeCurrency: 'USD',
    });
  });
});
