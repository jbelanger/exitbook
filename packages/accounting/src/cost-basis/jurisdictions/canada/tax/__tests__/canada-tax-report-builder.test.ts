import { type Currency } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import {
  createCanadaFeeAdjustmentEvent,
  createCanadaFxProvider,
  createCanadaAcquisitionEvent,
  createCanadaDispositionEvent,
  createCanadaInputContext,
  createCanadaTransferInEvent,
  createCanadaTransferOutEvent,
} from '../../__tests__/test-utils.js';
import { runCanadaAcbEngine } from '../../workflow/canada-acb-engine.js';
import { buildCanadaDisplayCostBasisReport, buildCanadaTaxReport } from '../canada-tax-report-builder.js';

function createCalculation() {
  return {
    id: 'calc-1',
    calculationDate: new Date('2024-12-31T23:59:59Z'),
    method: 'average-cost' as const,
    jurisdiction: 'CA' as const,
    taxYear: 2024,
    displayCurrency: 'CAD' as Currency,
    taxCurrency: 'CAD' as const,
    startDate: new Date('2024-01-01T00:00:00Z'),
    endDate: new Date('2024-12-31T23:59:59Z'),
    transactionsProcessed: 3,
    assetsProcessed: ['BTC' as Currency],
  };
}

describe('canada-tax-report-builder', () => {
  it('builds one logical internal-transfer row per validated link with settled pooled ACB', async () => {
    const inputContext = createCanadaInputContext({
      validatedTransferLinkIds: [10],
      inputEvents: [
        createCanadaAcquisitionEvent({
          eventId: 'tx:1:acquisition',
          transactionId: 1,
          timestamp: '2024-01-01T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '10000',
        }),
        createCanadaTransferOutEvent({
          eventId: 'link:10:transfer-out',
          transactionId: 2,
          timestamp: '2024-01-10T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '12000',
          provenanceKind: 'validated-link',
          linkId: 10,
        }),
        createCanadaTransferInEvent({
          eventId: 'link:10:transfer-in',
          transactionId: 3,
          timestamp: '2024-01-10T00:05:00Z',
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '12000',
          provenanceKind: 'validated-link',
          linkId: 10,
        }),
        createCanadaFeeAdjustmentEvent({
          eventId: 'link:10:fee-adjustment:add-to-pool-cost:0',
          transactionId: 3,
          timestamp: '2024-01-10T00:05:00Z',
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          adjustmentType: 'add-to-pool-cost',
          totalValueCad: '25',
          feeAssetId: 'fiat:cad',
          feeAssetSymbol: 'CAD',
          feeQuantity: '25',
          relatedEventId: 'link:10:transfer-in',
          provenanceKind: 'validated-link',
        }),
      ],
    });
    const acbEngineResult = assertOk(runCanadaAcbEngine(inputContext));

    const taxReport = assertOk(
      buildCanadaTaxReport({
        calculation: createCalculation(),
        inputContext,
        acbEngineResult,
        poolStateEngineResult: acbEngineResult,
      })
    );

    expect(taxReport.transfers).toHaveLength(1);
    expect(taxReport.transfers[0]).toMatchObject({
      id: 'link:10:transfer',
      direction: 'internal',
      sourceTransactionId: 2,
      targetTransactionId: 3,
      sourceTransferEventId: 'link:10:transfer-out',
      targetTransferEventId: 'link:10:transfer-in',
      linkId: 10,
    });
    expect(taxReport.transfers[0]?.quantity.toFixed()).toBe('1');
    expect(taxReport.transfers[0]?.carriedAcbCad.toFixed()).toBe('10025');
    expect(taxReport.transfers[0]?.carriedAcbPerUnitCad.toFixed()).toBe('10025');
    expect(taxReport.transfers[0]?.feeAdjustmentCad.toFixed()).toBe('25');

    const displayReport = assertOk(
      await buildCanadaDisplayCostBasisReport({
        taxReport,
        displayCurrency: 'USD' as Currency,
        fxProvider: createCanadaFxProvider({ fiatToUsd: { CAD: '0.75' } }),
      })
    );

    expect(displayReport.transfers[0]?.marketValueCad.toFixed()).toBe('12000');
    expect(displayReport.transfers[0]?.displayCarriedAcb.toFixed()).toBe('7518.75');
    expect(displayReport.transfers[0]?.displayCarriedAcbPerUnit.toFixed()).toBe('7518.75');
    expect(displayReport.transfers[0]?.displayMarketValue.toFixed()).toBe('9000');
    expect(displayReport.transfers[0]?.displayFeeAdjustment.toFixed()).toBe('18.75');
  });

  it('emits standalone carryover-style inbound transfer rows when no validated-link pair exists', () => {
    const inputContext = createCanadaInputContext({
      inputEvents: [
        createCanadaAcquisitionEvent({
          eventId: 'tx:1:acquisition',
          transactionId: 1,
          timestamp: '2024-01-01T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '10000',
        }),
        createCanadaTransferInEvent({
          eventId: 'carryover:2:deposit:transfer-in',
          transactionId: 3,
          timestamp: '2024-01-11T00:00:00Z',
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '11000',
          provenanceKind: 'fee-only-carryover',
          sourceTransactionId: 2,
        }),
      ],
    });
    const acbEngineResult = assertOk(runCanadaAcbEngine(inputContext));

    const taxReport = assertOk(
      buildCanadaTaxReport({
        calculation: createCalculation(),
        inputContext,
        acbEngineResult,
        poolStateEngineResult: acbEngineResult,
      })
    );

    expect(taxReport.transfers).toHaveLength(1);
    expect(taxReport.transfers[0]).toMatchObject({
      id: 'carryover:2:deposit:transfer-in',
      direction: 'in',
      sourceTransactionId: 2,
      targetTransactionId: 3,
    });
    expect(taxReport.transfers[0]?.carriedAcbCad.toFixed()).toBe('10000');
    expect(taxReport.transfers[0]?.feeAdjustmentCad.toFixed()).toBe('0');
  });

  it('applies the Canada inclusion-rate seam when building taxable gain rows and summary totals', () => {
    const inputContext = createCanadaInputContext({
      inputEvents: [
        createCanadaAcquisitionEvent({
          eventId: 'tx:1:acquisition',
          transactionId: 1,
          timestamp: '2024-01-01T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '10000',
        }),
        createCanadaDispositionEvent({
          eventId: 'tx:2:disposition',
          transactionId: 2,
          timestamp: '2024-02-01T00:00:00Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          quantity: '1',
          unitValueCad: '14000',
        }),
      ],
    });
    const acbEngineResult = assertOk(runCanadaAcbEngine(inputContext));

    const taxReport = assertOk(
      buildCanadaTaxReport({
        calculation: createCalculation(),
        inputContext,
        acbEngineResult,
        poolStateEngineResult: acbEngineResult,
      })
    );

    expect(taxReport.dispositions).toHaveLength(1);
    expect(taxReport.dispositions[0]?.gainLossCad.toFixed()).toBe('4000');
    expect(taxReport.dispositions[0]?.taxableGainLossCad.toFixed()).toBe('2000');
    expect(taxReport.summary.totalGainLossCad.toFixed()).toBe('4000');
    expect(taxReport.summary.totalTaxableGainLossCad.toFixed()).toBe('2000');
  });
});
