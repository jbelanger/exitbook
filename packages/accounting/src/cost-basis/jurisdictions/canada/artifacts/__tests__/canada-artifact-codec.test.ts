import type { Currency } from '@exitbook/foundation';
import { parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import {
  createCanadaAcquisitionEvent,
  createCanadaDispositionEvent,
  createCanadaFeeAdjustmentEvent,
  createCanadaInputContext,
  createCanadaTransferInEvent,
  createCanadaTransferOutEvent,
} from '../../__tests__/test-utils.js';
import type { CanadaCostBasisWorkflowResult } from '../../../../workflow/workflow-result-types.js';
import type {
  CanadaCostBasisCalculation,
  CanadaDisplayCostBasisReport,
  CanadaDisplayFxConversion,
  CanadaDisplayReportAcquisition,
  CanadaDisplayReportDisposition,
  CanadaDisplayReportTransfer,
  CanadaSuperficialLossAdjustment,
  CanadaTaxInputContext,
  CanadaTaxReport,
  CanadaTaxReportAcquisition,
  CanadaTaxReportDisposition,
  CanadaTaxReportTransfer,
} from '../../tax/canada-tax-types.js';
import {
  buildCanadaArtifactSnapshotParts,
  fromStoredCanadaArtifact,
  fromStoredCanadaDebug,
  StoredCanadaCostBasisArtifactSchema,
  StoredCanadaDebugSchema,
} from '../canada-artifact-codec.js';

const BTC = 'BTC' as Currency;
const CAD = 'CAD' as Currency;
const USD = 'USD' as Currency;

const CALC_ID = '11111111-1111-4111-a111-111111111111';
const CALC_DATE = new Date('2024-12-31T23:59:59.000Z');
const START_DATE = new Date('2024-01-01T00:00:00.000Z');
const END_DATE = new Date('2024-12-31T23:59:59.000Z');
const TX_DATE_1 = new Date('2024-01-15T12:00:00.000Z');
const TX_DATE_2 = new Date('2024-06-15T12:00:00.000Z');
const FX_FETCHED_AT = new Date('2024-01-15T00:00:00.000Z');

function createCalculation(overrides?: Partial<CanadaCostBasisCalculation>): CanadaCostBasisCalculation {
  return {
    id: CALC_ID,
    calculationDate: CALC_DATE,
    method: 'average-cost',
    jurisdiction: 'CA',
    taxYear: 2024,
    displayCurrency: CAD,
    taxCurrency: 'CAD',
    startDate: START_DATE,
    endDate: END_DATE,
    transactionsProcessed: 2,
    assetsProcessed: ['btc'],
    ...overrides,
  };
}

function createTaxReportAcquisition(overrides?: Partial<CanadaTaxReportAcquisition>): CanadaTaxReportAcquisition {
  return {
    id: 'acq-1',
    acquisitionEventId: 'evt-acq-1',
    transactionId: 1,
    taxPropertyKey: 'ca:btc',
    assetSymbol: BTC,
    acquiredAt: TX_DATE_1,
    quantityAcquired: parseDecimal('1.5'),
    remainingQuantity: parseDecimal('0.5'),
    totalCostCad: parseDecimal('15000'),
    remainingAllocatedAcbCad: parseDecimal('5000'),
    costBasisPerUnitCad: parseDecimal('10000'),
    ...overrides,
  };
}

function createTaxReportDisposition(overrides?: Partial<CanadaTaxReportDisposition>): CanadaTaxReportDisposition {
  return {
    id: 'disp-1',
    dispositionEventId: 'evt-disp-1',
    transactionId: 2,
    taxPropertyKey: 'ca:btc',
    assetSymbol: BTC,
    disposedAt: TX_DATE_2,
    quantityDisposed: parseDecimal('1'),
    proceedsCad: parseDecimal('12000'),
    costBasisCad: parseDecimal('10000'),
    gainLossCad: parseDecimal('2000'),
    deniedLossCad: parseDecimal('0'),
    taxableGainLossCad: parseDecimal('2000'),
    acbPerUnitCad: parseDecimal('10000'),
    ...overrides,
  };
}

function createTaxReportTransfer(overrides?: Partial<CanadaTaxReportTransfer>): CanadaTaxReportTransfer {
  return {
    id: 'xfer-1',
    direction: 'out',
    sourceTransferEventId: 'evt-xfer-out-1',
    targetTransferEventId: 'evt-xfer-in-1',
    sourceTransactionId: 3,
    targetTransactionId: 4,
    linkId: 10,
    transactionId: 3,
    taxPropertyKey: 'ca:btc',
    assetSymbol: BTC,
    transferredAt: TX_DATE_1,
    quantity: parseDecimal('0.25'),
    carriedAcbCad: parseDecimal('2500'),
    carriedAcbPerUnitCad: parseDecimal('10000'),
    feeAdjustmentCad: parseDecimal('5'),
    ...overrides,
  };
}

function createSuperficialLossAdjustment(
  overrides?: Partial<CanadaSuperficialLossAdjustment>
): CanadaSuperficialLossAdjustment {
  return {
    id: 'sla-1',
    adjustedAt: TX_DATE_2,
    assetSymbol: BTC,
    deniedLossCad: parseDecimal('500'),
    deniedQuantity: parseDecimal('0.5'),
    relatedDispositionId: 'disp-1',
    taxPropertyKey: 'ca:btc',
    substitutedPropertyAcquisitionId: 'acq-1',
    ...overrides,
  };
}

function createFxConversion(overrides?: Partial<CanadaDisplayFxConversion>): CanadaDisplayFxConversion {
  return {
    sourceTaxCurrency: 'CAD',
    displayCurrency: USD,
    fxRate: parseDecimal('0.74'),
    fxSource: 'test-fx-source',
    fxFetchedAt: FX_FETCHED_AT,
    ...overrides,
  };
}

function createTaxReport(overrides?: Partial<CanadaTaxReport>): CanadaTaxReport {
  return {
    calculationId: CALC_ID,
    taxCurrency: 'CAD',
    acquisitions: [createTaxReportAcquisition()],
    dispositions: [createTaxReportDisposition()],
    transfers: [createTaxReportTransfer()],
    superficialLossAdjustments: [createSuperficialLossAdjustment()],
    summary: {
      totalProceedsCad: parseDecimal('12000'),
      totalCostBasisCad: parseDecimal('10000'),
      totalGainLossCad: parseDecimal('2000'),
      totalTaxableGainLossCad: parseDecimal('1500'),
      totalDeniedLossCad: parseDecimal('500'),
    },
    displayContext: {
      transferMarketValueCadByTransferId: new Map([['xfer-1', parseDecimal('2600')]]),
    },
    ...overrides,
  };
}

function createDisplayReport(overrides?: Partial<CanadaDisplayCostBasisReport>): CanadaDisplayCostBasisReport {
  const fxConversion = createFxConversion();
  const baseAcq = createTaxReportAcquisition();
  const baseDisp = createTaxReportDisposition();
  const baseXfer = createTaxReportTransfer();

  const displayAcq: CanadaDisplayReportAcquisition = {
    ...baseAcq,
    displayCostBasisPerUnit: parseDecimal('7400'),
    displayTotalCost: parseDecimal('11100'),
    displayRemainingAllocatedCost: parseDecimal('3700'),
    fxConversion,
  };

  const displayDisp: CanadaDisplayReportDisposition = {
    ...baseDisp,
    displayProceeds: parseDecimal('8880'),
    displayCostBasis: parseDecimal('7400'),
    displayGainLoss: parseDecimal('1480'),
    displayDeniedLoss: parseDecimal('0'),
    displayTaxableGainLoss: parseDecimal('1480'),
    displayAcbPerUnit: parseDecimal('7400'),
    fxConversion,
  };

  const displayXfer: CanadaDisplayReportTransfer = {
    ...baseXfer,
    marketValueCad: parseDecimal('2600'),
    displayCarriedAcb: parseDecimal('1850'),
    displayCarriedAcbPerUnit: parseDecimal('7400'),
    displayMarketValue: parseDecimal('1924'),
    displayFeeAdjustment: parseDecimal('3.7'),
    fxConversion,
  };

  return {
    calculationId: CALC_ID,
    sourceTaxCurrency: 'CAD',
    displayCurrency: USD,
    acquisitions: [displayAcq],
    dispositions: [displayDisp],
    transfers: [displayXfer],
    summary: {
      totalProceeds: parseDecimal('8880'),
      totalCostBasis: parseDecimal('7400'),
      totalGainLoss: parseDecimal('1480'),
      totalTaxableGainLoss: parseDecimal('1110'),
      totalDeniedLoss: parseDecimal('370'),
    },
    ...overrides,
  };
}

function createInputContext(): CanadaTaxInputContext {
  return createCanadaInputContext({
    inputTransactionIds: [1, 2],
    validatedTransferLinkIds: [10],
    internalTransferCarryoverSourceTransactionIds: [],
    inputEvents: [
      createCanadaAcquisitionEvent({
        eventId: 'evt-acq-1',
        transactionId: 1,
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC',
        timestamp: TX_DATE_1,
        quantity: '1.5',
        unitValueCad: '10000',
      }),
      createCanadaDispositionEvent({
        eventId: 'evt-disp-1',
        transactionId: 2,
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC',
        timestamp: TX_DATE_2,
        quantity: '1',
        unitValueCad: '12000',
      }),
    ],
  });
}

function createWorkflowResult(overrides?: Partial<CanadaCostBasisWorkflowResult>): CanadaCostBasisWorkflowResult {
  return {
    kind: 'canada-workflow',
    calculation: createCalculation(),
    taxReport: createTaxReport(),
    inputContext: createInputContext(),
    displayReport: createDisplayReport(),
    executionMeta: {
      missingPricesCount: 0,
      retainedTransactionIds: [1, 2],
    },
    ...overrides,
  };
}

describe('canada-artifact-codec', () => {
  describe('buildCanadaArtifactSnapshotParts + fromStoredCanadaArtifact round-trip', () => {
    it('round-trips a full workflow result with display report', () => {
      const original = createWorkflowResult({
        taxReport: createTaxReport({
          acquisitions: [createTaxReportAcquisition({ incomeCategory: 'staking_reward' })],
        }),
      });
      const partsResult = buildCanadaArtifactSnapshotParts(original);
      const parts = assertOk(partsResult);

      // Stored artifact validates against schema
      const parsed = StoredCanadaCostBasisArtifactSchema.safeParse(parts.artifact);
      if (!parsed.success) {
        throw new Error(`Schema validation failed: ${JSON.stringify(parsed.error.issues, undefined, 2)}`);
      }

      // Round-trip: decode
      const decoded = fromStoredCanadaArtifact(parts.artifact);

      // Calculation
      expect(decoded.kind).toBe('canada-workflow');
      expect(decoded.calculation.id).toBe(CALC_ID);
      expect(decoded.calculation.calculationDate.toISOString()).toBe(CALC_DATE.toISOString());
      expect(decoded.calculation.method).toBe('average-cost');
      expect(decoded.calculation.jurisdiction).toBe('CA');
      expect(decoded.calculation.taxYear).toBe(2024);
      expect(decoded.calculation.displayCurrency).toBe('CAD');
      expect(decoded.calculation.taxCurrency).toBe('CAD');
      expect(decoded.calculation.startDate.toISOString()).toBe(START_DATE.toISOString());
      expect(decoded.calculation.endDate.toISOString()).toBe(END_DATE.toISOString());
      expect(decoded.calculation.transactionsProcessed).toBe(2);
      expect(decoded.calculation.assetsProcessed).toEqual(['btc']);

      // Tax report acquisitions
      expect(decoded.taxReport.acquisitions).toHaveLength(1);
      const acq = decoded.taxReport.acquisitions[0]!;
      expect(acq.id).toBe('acq-1');
      expect(acq.quantityAcquired.toFixed()).toBe('1.5');
      expect(acq.remainingQuantity.toFixed()).toBe('0.5');
      expect(acq.totalCostCad.toFixed()).toBe('15000');
      expect(acq.costBasisPerUnitCad.toFixed()).toBe('10000');
      expect(acq.acquiredAt.toISOString()).toBe(TX_DATE_1.toISOString());
      expect(acq.incomeCategory).toBe('staking_reward');

      // Tax report dispositions
      expect(decoded.taxReport.dispositions).toHaveLength(1);
      const disp = decoded.taxReport.dispositions[0]!;
      expect(disp.gainLossCad.toFixed()).toBe('2000');
      expect(disp.deniedLossCad.toFixed()).toBe('0');
      expect(disp.taxableGainLossCad.toFixed()).toBe('2000');

      // Tax report transfers
      expect(decoded.taxReport.transfers).toHaveLength(1);
      const xfer = decoded.taxReport.transfers[0]!;
      expect(xfer.direction).toBe('out');
      expect(xfer.linkId).toBe(10);
      expect(xfer.sourceTransferEventId).toBe('evt-xfer-out-1');
      expect(xfer.carriedAcbCad.toFixed()).toBe('2500');
      expect(xfer.feeAdjustmentCad.toFixed()).toBe('5');

      // Superficial loss adjustments
      expect(decoded.taxReport.superficialLossAdjustments).toHaveLength(1);
      const sla = decoded.taxReport.superficialLossAdjustments[0]!;
      expect(sla.deniedLossCad.toFixed()).toBe('500');
      expect(sla.deniedQuantity.toFixed()).toBe('0.5');
      expect(sla.adjustedAt.toISOString()).toBe(TX_DATE_2.toISOString());

      // Summary
      expect(decoded.taxReport.summary.totalProceedsCad.toFixed()).toBe('12000');
      expect(decoded.taxReport.summary.totalTaxableGainLossCad.toFixed()).toBe('1500');
      expect(decoded.taxReport.summary.totalDeniedLossCad.toFixed()).toBe('500');

      // Display context (Map round-trip)
      expect(decoded.taxReport.displayContext.transferMarketValueCadByTransferId).toBeInstanceOf(Map);
      expect(decoded.taxReport.displayContext.transferMarketValueCadByTransferId.get('xfer-1')?.toFixed()).toBe('2600');

      // Execution meta
      expect(decoded.executionMeta.missingPricesCount).toBe(0);
      expect(decoded.executionMeta.retainedTransactionIds).toEqual([1, 2]);
    });

    it('round-trips input context with all event kinds', () => {
      const inputContext = createCanadaInputContext({
        inputTransactionIds: [1, 2, 3, 4, 5],
        validatedTransferLinkIds: [10],
        internalTransferCarryoverSourceTransactionIds: [5],
        inputEvents: [
          createCanadaAcquisitionEvent({
            eventId: 'evt-acq-1',
            transactionId: 1,
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC',
            timestamp: TX_DATE_1,
            quantity: '2',
            unitValueCad: '10000',
            costBasisAdjustmentCad: '50',
            incomeCategory: 'staking_reward',
          }),
          createCanadaDispositionEvent({
            eventId: 'evt-disp-1',
            transactionId: 2,
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC',
            timestamp: TX_DATE_2,
            quantity: '1',
            unitValueCad: '12000',
            proceedsReductionCad: '25',
          }),
          createCanadaTransferOutEvent({
            eventId: 'evt-xfer-out-1',
            transactionId: 3,
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC',
            timestamp: TX_DATE_1,
            quantity: '0.5',
            unitValueCad: '10000',
            linkId: 10,
            sourceMovementFingerprint: 'src-fp-1',
            targetMovementFingerprint: 'tgt-fp-1',
          }),
          createCanadaTransferInEvent({
            eventId: 'evt-xfer-in-1',
            transactionId: 4,
            assetId: 'blockchain:bitcoin:btc',
            assetSymbol: 'BTC',
            timestamp: TX_DATE_1,
            quantity: '0.5',
            unitValueCad: '10000',
            linkId: 10,
            sourceMovementFingerprint: 'src-fp-1',
            sourceTransactionId: 3,
            targetMovementFingerprint: 'tgt-fp-1',
          }),
          createCanadaFeeAdjustmentEvent({
            eventId: 'evt-fee-1',
            transactionId: 5,
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC',
            timestamp: TX_DATE_1,
            adjustmentType: 'add-to-pool-cost',
            feeAssetId: 'exchange:kraken:btc',
            feeAssetIdentityKey: 'btc',
            feeAssetSymbol: 'BTC',
            feeQuantity: '0.001',
            totalValueCad: '10',
            quantityReduced: '0.001',
            relatedEventId: 'evt-acq-1',
            provenanceKind: 'internal-transfer-carryover',
          }),
        ],
      });

      const original = createWorkflowResult({ inputContext });
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));
      const decoded = fromStoredCanadaArtifact(parts.artifact);

      expect(decoded.inputContext).toBeDefined();
      const ctx = decoded.inputContext!;
      expect(ctx.taxCurrency).toBe('CAD');
      expect(ctx.inputTransactionIds).toEqual([1, 2, 3, 4, 5]);
      expect(ctx.validatedTransferLinkIds).toEqual([10]);
      expect(ctx.internalTransferCarryoverSourceTransactionIds).toEqual([5]);
      expect(ctx.inputEvents).toHaveLength(5);

      // Acquisition with costBasisAdjustmentCad
      const acqEvt = ctx.inputEvents[0]!;
      expect(acqEvt.kind).toBe('acquisition');
      if (acqEvt.kind === 'acquisition') {
        expect(acqEvt.quantity.toFixed()).toBe('2');
        expect(acqEvt.costBasisAdjustmentCad?.toFixed()).toBe('50');
        expect(acqEvt.incomeCategory).toBe('staking_reward');
      }

      // Disposition with proceedsReductionCad
      const dispEvt = ctx.inputEvents[1]!;
      expect(dispEvt.kind).toBe('disposition');
      if (dispEvt.kind === 'disposition') {
        expect(dispEvt.quantity.toFixed()).toBe('1');
        expect(dispEvt.proceedsReductionCad?.toFixed()).toBe('25');
      }

      // Transfer-out with link/fingerprint fields
      const xferOut = ctx.inputEvents[2]!;
      expect(xferOut.kind).toBe('transfer-out');
      expect(xferOut.linkId).toBe(10);
      expect(xferOut.sourceMovementFingerprint).toBe('src-fp-1');
      expect(xferOut.targetMovementFingerprint).toBe('tgt-fp-1');

      // Transfer-in with sourceTransactionId
      const xferIn = ctx.inputEvents[3]!;
      expect(xferIn.kind).toBe('transfer-in');
      expect(xferIn.sourceTransactionId).toBe(3);

      // Fee adjustment with all optional fields
      const feeEvt = ctx.inputEvents[4]!;
      expect(feeEvt.kind).toBe('fee-adjustment');
      if (feeEvt.kind === 'fee-adjustment') {
        expect(feeEvt.adjustmentType).toBe('add-to-pool-cost');
        expect(feeEvt.feeAssetId).toBe('exchange:kraken:btc');
        expect(feeEvt.feeAssetIdentityKey).toBe('btc');
        expect(feeEvt.feeQuantity.toFixed()).toBe('0.001');
        expect(feeEvt.quantityReduced?.toFixed()).toBe('0.001');
        expect(feeEvt.relatedEventId).toBe('evt-acq-1');
      }
    });

    it('round-trips valuation with FX fields', () => {
      const inputContext = createCanadaInputContext({
        inputEvents: [
          createCanadaAcquisitionEvent({
            eventId: 'evt-acq-fx',
            transactionId: 1,
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC',
            timestamp: TX_DATE_1,
            quantity: '1',
            unitValueCad: '13500',
          }),
        ],
      });

      // Manually attach FX fields to the valuation
      const event = inputContext.inputEvents[0]!;
      event.valuation.fxRateToCad = parseDecimal('1.35');
      event.valuation.fxSource = 'ecb';
      event.valuation.fxTimestamp = FX_FETCHED_AT;
      event.valuation.valuationSource = 'usd-to-cad-fx';
      event.valuation.storagePriceCurrency = USD;
      event.valuation.storagePriceAmount = parseDecimal('10000');

      const original = createWorkflowResult({ inputContext });
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));
      const decoded = fromStoredCanadaArtifact(parts.artifact);

      const val = decoded.inputContext!.inputEvents[0]!.valuation;
      expect(val.fxRateToCad?.toFixed()).toBe('1.35');
      expect(val.fxSource).toBe('ecb');
      expect(val.fxTimestamp?.toISOString()).toBe(FX_FETCHED_AT.toISOString());
      expect(val.valuationSource).toBe('usd-to-cad-fx');
      expect(val.storagePriceCurrency).toBe('USD');
      expect(val.storagePriceAmount.toFixed()).toBe('10000');
    });

    it('round-trips without display report', () => {
      const original = createWorkflowResult({ displayReport: undefined });
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));
      const decoded = fromStoredCanadaArtifact(parts.artifact);

      expect(decoded.displayReport).toBeUndefined();
      expect(decoded.taxReport.acquisitions).toHaveLength(1);
    });

    it('round-trips display report with FX conversion', () => {
      const original = createWorkflowResult();
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));
      const decoded = fromStoredCanadaArtifact(parts.artifact);

      expect(decoded.displayReport).toBeDefined();
      const report = decoded.displayReport!;

      expect(report.calculationId).toBe(CALC_ID);
      expect(report.sourceTaxCurrency).toBe('CAD');
      expect(report.displayCurrency).toBe('USD');

      // Acquisition display fields
      const acq = report.acquisitions[0]!;
      expect(acq.displayCostBasisPerUnit.toFixed()).toBe('7400');
      expect(acq.displayTotalCost.toFixed()).toBe('11100');
      expect(acq.displayRemainingAllocatedCost.toFixed()).toBe('3700');
      expect(acq.fxConversion.fxRate.toFixed()).toBe('0.74');
      expect(acq.fxConversion.fxFetchedAt.toISOString()).toBe(FX_FETCHED_AT.toISOString());

      // Disposition display fields
      const disp = report.dispositions[0]!;
      expect(disp.displayProceeds.toFixed()).toBe('8880');
      expect(disp.displayCostBasis.toFixed()).toBe('7400');
      expect(disp.displayTaxableGainLoss.toFixed()).toBe('1480');

      // Transfer display fields
      const xfer = report.transfers[0]!;
      expect(xfer.marketValueCad.toFixed()).toBe('2600');
      expect(xfer.displayCarriedAcb.toFixed()).toBe('1850');
      expect(xfer.displayFeeAdjustment.toFixed()).toBe('3.7');

      // Summary
      expect(report.summary.totalProceeds.toFixed()).toBe('8880');
      expect(report.summary.totalTaxableGainLoss.toFixed()).toBe('1110');
    });

    it('round-trips transfer with minimal optional fields', () => {
      const minimalTransfer = createTaxReportTransfer({
        direction: 'in',
        sourceTransferEventId: undefined,
        targetTransferEventId: undefined,
        sourceTransactionId: undefined,
        targetTransactionId: undefined,
        linkId: undefined,
      });

      const taxReport = createTaxReport({ transfers: [minimalTransfer] });
      const original = createWorkflowResult({ taxReport, displayReport: undefined });
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));
      const decoded = fromStoredCanadaArtifact(parts.artifact);

      const xfer = decoded.taxReport.transfers[0]!;
      expect(xfer.direction).toBe('in');
      expect(xfer.sourceTransferEventId).toBeUndefined();
      expect(xfer.targetTransferEventId).toBeUndefined();
      expect(xfer.sourceTransactionId).toBeUndefined();
      expect(xfer.targetTransactionId).toBeUndefined();
      expect(xfer.linkId).toBeUndefined();
    });
  });

  describe('Decimal precision', () => {
    it('preserves high-precision Decimal values through round-trip', () => {
      const acquisition = createTaxReportAcquisition({
        quantityAcquired: parseDecimal('0.00000001'),
        costBasisPerUnitCad: parseDecimal('99999999.99999999'),
        totalCostCad: parseDecimal('0.99999999'),
        remainingQuantity: parseDecimal('0.00000001'),
        remainingAllocatedAcbCad: parseDecimal('0.99999999'),
      });

      const taxReport = createTaxReport({
        acquisitions: [acquisition],
        dispositions: [],
        transfers: [],
        superficialLossAdjustments: [],
        summary: {
          totalProceedsCad: parseDecimal('0'),
          totalCostBasisCad: parseDecimal('0.99999999'),
          totalGainLossCad: parseDecimal('-0.99999999'),
          totalTaxableGainLossCad: parseDecimal('-0.99999999'),
          totalDeniedLossCad: parseDecimal('0'),
        },
      });

      const original = createWorkflowResult({ taxReport, displayReport: undefined });
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));
      const decoded = fromStoredCanadaArtifact(parts.artifact);

      const acq = decoded.taxReport.acquisitions[0]!;
      expect(acq.quantityAcquired.toFixed()).toBe('0.00000001');
      expect(acq.costBasisPerUnitCad.toFixed()).toBe('99999999.99999999');
      expect(decoded.taxReport.summary.totalGainLossCad.toFixed()).toBe('-0.99999999');
    });

    it('preserves negative Decimal values', () => {
      const disposition = createTaxReportDisposition({
        gainLossCad: parseDecimal('-500.25'),
        taxableGainLossCad: parseDecimal('-200.10'),
      });

      const taxReport = createTaxReport({ dispositions: [disposition] });
      const original = createWorkflowResult({ taxReport, displayReport: undefined });
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));
      const decoded = fromStoredCanadaArtifact(parts.artifact);

      expect(decoded.taxReport.dispositions[0]!.gainLossCad.toFixed()).toBe('-500.25');
      expect(decoded.taxReport.dispositions[0]!.taxableGainLossCad.toFixed(2)).toBe('-200.10');
    });
  });

  describe('Date serialization', () => {
    it('preserves Date objects as ISO strings and reconstructs them', () => {
      const specificDate = new Date('2024-07-04T18:30:45.123Z');
      const acq = createTaxReportAcquisition({ acquiredAt: specificDate });
      const taxReport = createTaxReport({ acquisitions: [acq] });
      const original = createWorkflowResult({ taxReport, displayReport: undefined });
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));
      const decoded = fromStoredCanadaArtifact(parts.artifact);

      expect(decoded.taxReport.acquisitions[0]!.acquiredAt).toBeInstanceOf(Date);
      expect(decoded.taxReport.acquisitions[0]!.acquiredAt.toISOString()).toBe(specificDate.toISOString());
    });
  });

  describe('debug codec', () => {
    it('round-trips debug payload via StoredCanadaDebugSchema', () => {
      const original = createWorkflowResult();
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));

      const parsedDebug = StoredCanadaDebugSchema.safeParse(parts.debug);
      expect(parsedDebug.success).toBe(true);

      const decoded = fromStoredCanadaDebug(parts.debug);
      expect(decoded.kind).toBe('canada-workflow');
      expect(decoded.acquisitionEventIds).toEqual(['evt-acq-1']);
      expect(decoded.dispositionEventIds).toEqual(['evt-disp-1']);
      expect(decoded.transferIds).toEqual(['xfer-1']);
      expect(decoded.superficialLossAdjustmentIds).toEqual(['sla-1']);
    });

    it('populates scoped transaction IDs from report items (deduplicated and sorted)', () => {
      const taxReport = createTaxReport({
        acquisitions: [
          createTaxReportAcquisition({ transactionId: 3 }),
          createTaxReportAcquisition({ id: 'acq-2', acquisitionEventId: 'evt-acq-2', transactionId: 1 }),
        ],
        dispositions: [createTaxReportDisposition({ transactionId: 3 })],
        transfers: [createTaxReportTransfer({ transactionId: 5 })],
      });
      const original = createWorkflowResult({ taxReport, displayReport: undefined });
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));

      expect(parts.debugPayload.inputTransactionIds).toEqual([1, 3, 5]);
    });

    it('extracts applied confirmed link IDs from transfers (deduplicated and sorted)', () => {
      const taxReport = createTaxReport({
        transfers: [
          createTaxReportTransfer({ id: 'xfer-1', linkId: 20 }),
          createTaxReportTransfer({ id: 'xfer-2', linkId: 10 }),
          createTaxReportTransfer({ id: 'xfer-3', linkId: 20 }),
          createTaxReportTransfer({ id: 'xfer-4', linkId: undefined }),
        ],
      });
      const original = createWorkflowResult({ taxReport, displayReport: undefined });
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));

      expect(parts.debugPayload.appliedConfirmedLinkIds).toEqual([10, 20]);
    });
  });

  describe('metadata', () => {
    it('produces correct metadata from the calculation', () => {
      const original = createWorkflowResult();
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));

      expect(parts.metadata.calculationId).toBe(CALC_ID);
      expect(parts.metadata.jurisdiction).toBe('CA');
      expect(parts.metadata.method).toBe('average-cost');
      expect(parts.metadata.taxYear).toBe(2024);
      expect(parts.metadata.startDate).toBe(START_DATE.toISOString());
      expect(parts.metadata.endDate).toBe(END_DATE.toISOString());
    });

    it('uses display report displayCurrency when present', () => {
      const original = createWorkflowResult();
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));

      // displayReport has displayCurrency = USD, calculation has CAD
      expect(parts.metadata.displayCurrency).toBe('USD');
    });

    it('falls back to calculation displayCurrency when no display report', () => {
      const original = createWorkflowResult({ displayReport: undefined });
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));

      expect(parts.metadata.displayCurrency).toBe('CAD');
    });
  });

  describe('error handling', () => {
    it('returns Err when inputContext is missing', () => {
      const original = createWorkflowResult({ inputContext: undefined });
      const result = buildCanadaArtifactSnapshotParts(original);
      const error = assertErr(result);

      expect(error.message).toContain('Cannot persist Canada cost-basis snapshot without input context');
      expect(error.message).toContain(CALC_ID);
    });
  });

  describe('schema validation', () => {
    it('rejects artifact JSON with invalid Decimal string', () => {
      const original = createWorkflowResult();
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));

      // Corrupt a Decimal field to a non-numeric string
      const corrupted = structuredClone(parts.artifact) as Record<string, unknown>;
      const taxReport = corrupted['taxReport'] as Record<string, unknown>;
      const summary = taxReport['summary'] as Record<string, string>;
      summary['totalProceedsCad'] = 'not-a-number';

      const parseResult = StoredCanadaCostBasisArtifactSchema.safeParse(corrupted);
      expect(parseResult.success).toBe(false);
    });

    it('rejects artifact JSON with invalid ISO date string', () => {
      const original = createWorkflowResult();
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));

      const corrupted = structuredClone(parts.artifact) as Record<string, unknown>;
      const calculation = corrupted['calculation'] as Record<string, string>;
      calculation['calculationDate'] = '2024/01/01';

      const parseResult = StoredCanadaCostBasisArtifactSchema.safeParse(corrupted);
      expect(parseResult.success).toBe(false);
    });

    it('rejects debug JSON with missing required arrays', () => {
      const parseResult = StoredCanadaDebugSchema.safeParse({
        kind: 'canada-workflow',
        inputTransactionIds: [1],
        // missing other required arrays
      });
      expect(parseResult.success).toBe(false);
    });
  });

  describe('priceAtTxTime round-trip', () => {
    it('round-trips input events with priceAtTxTime including optional FX fields', () => {
      const inputContext = createCanadaInputContext({
        inputEvents: [
          createCanadaAcquisitionEvent({
            eventId: 'evt-acq-price',
            transactionId: 1,
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC',
            timestamp: TX_DATE_1,
            quantity: '1',
            unitValueCad: '13500',
          }),
        ],
      });

      // Attach priceAtTxTime manually with all optional FX fields
      inputContext.inputEvents[0]!.priceAtTxTime = {
        price: { amount: parseDecimal('10000'), currency: USD },
        quotedPrice: { amount: parseDecimal('65000'), currency: CAD },
        source: 'exchange-execution',
        fetchedAt: TX_DATE_1,
        granularity: 'exact',
        fxRateToUSD: parseDecimal('0.74'),
        fxSource: 'ecb',
        fxTimestamp: FX_FETCHED_AT,
      };

      const original = createWorkflowResult({ inputContext, displayReport: undefined });
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));
      const decoded = fromStoredCanadaArtifact(parts.artifact);

      const price = decoded.inputContext!.inputEvents[0]!.priceAtTxTime;
      expect(price).toBeDefined();
      expect(price!.price.amount.toFixed()).toBe('10000');
      expect(price!.price.currency).toBe('USD');
      expect(price!.quotedPrice?.amount.toFixed()).toBe('65000');
      expect(price!.quotedPrice?.currency).toBe('CAD');
      expect(price!.source).toBe('exchange-execution');
      expect(price!.fetchedAt.toISOString()).toBe(TX_DATE_1.toISOString());
      expect(price!.granularity).toBe('exact');
      expect(price!.fxRateToUSD?.toFixed()).toBe('0.74');
      expect(price!.fxSource).toBe('ecb');
      expect(price!.fxTimestamp?.toISOString()).toBe(FX_FETCHED_AT.toISOString());
    });

    it('round-trips input events with priceAtTxTime without optional fields', () => {
      const inputContext = createCanadaInputContext({
        inputEvents: [
          createCanadaAcquisitionEvent({
            eventId: 'evt-acq-minimal-price',
            transactionId: 1,
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC',
            timestamp: TX_DATE_1,
            quantity: '1',
            unitValueCad: '10000',
          }),
        ],
      });

      // Minimal priceAtTxTime - no optional fields
      inputContext.inputEvents[0]!.priceAtTxTime = {
        price: { amount: parseDecimal('10000'), currency: CAD },
        source: 'manual',
        fetchedAt: TX_DATE_1,
      };

      const original = createWorkflowResult({ inputContext, displayReport: undefined });
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));
      const decoded = fromStoredCanadaArtifact(parts.artifact);

      const price = decoded.inputContext!.inputEvents[0]!.priceAtTxTime;
      expect(price).toBeDefined();
      expect(price!.price.amount.toFixed()).toBe('10000');
      expect(price!.quotedPrice).toBeUndefined();
      expect(price!.granularity).toBeUndefined();
      expect(price!.fxRateToUSD).toBeUndefined();
      expect(price!.fxSource).toBeUndefined();
      expect(price!.fxTimestamp).toBeUndefined();
    });

    it('round-trips input events without priceAtTxTime', () => {
      const inputContext = createCanadaInputContext({
        inputEvents: [
          createCanadaAcquisitionEvent({
            eventId: 'evt-no-price',
            transactionId: 1,
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC',
            timestamp: TX_DATE_1,
            quantity: '1',
            unitValueCad: '10000',
          }),
        ],
      });

      const original = createWorkflowResult({ inputContext, displayReport: undefined });
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));
      const decoded = fromStoredCanadaArtifact(parts.artifact);

      expect(decoded.inputContext!.inputEvents[0]!.priceAtTxTime).toBeUndefined();
    });
  });

  describe('superficial-loss-adjustment input event round-trip', () => {
    it('round-trips superficial-loss-adjustment events', () => {
      const inputContext = createCanadaInputContext({
        inputEvents: [
          {
            kind: 'superficial-loss-adjustment',
            eventId: 'evt-sla-1',
            transactionId: 1,
            timestamp: TX_DATE_2,
            assetId: 'exchange:kraken:btc',
            assetIdentityKey: 'btc',
            taxPropertyKey: 'ca:btc',
            assetSymbol: BTC,
            valuation: {
              taxCurrency: 'CAD',
              storagePriceAmount: parseDecimal('500'),
              storagePriceCurrency: CAD,
              quotedPriceAmount: parseDecimal('500'),
              quotedPriceCurrency: CAD,
              unitValueCad: parseDecimal('500'),
              totalValueCad: parseDecimal('500'),
              valuationSource: 'stored-price',
            },
            provenanceKind: 'superficial-loss-engine',
            deniedLossCad: parseDecimal('250'),
            deniedQuantity: parseDecimal('0.5'),
            relatedDispositionEventId: 'evt-disp-1',
          },
        ],
      });

      const original = createWorkflowResult({ inputContext, displayReport: undefined });
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));
      const decoded = fromStoredCanadaArtifact(parts.artifact);

      const slaEvent = decoded.inputContext!.inputEvents[0]!;
      expect(slaEvent.kind).toBe('superficial-loss-adjustment');
      if (slaEvent.kind === 'superficial-loss-adjustment') {
        expect(slaEvent.deniedLossCad.toFixed()).toBe('250');
        expect(slaEvent.deniedQuantity.toFixed()).toBe('0.5');
        expect(slaEvent.relatedDispositionEventId).toBe('evt-disp-1');
        expect(slaEvent.provenanceKind).toBe('superficial-loss-engine');
      }
    });
  });

  describe('empty collections', () => {
    it('round-trips with empty acquisitions, dispositions, transfers, and adjustments', () => {
      const taxReport = createTaxReport({
        acquisitions: [],
        dispositions: [],
        transfers: [],
        superficialLossAdjustments: [],
        summary: {
          totalProceedsCad: parseDecimal('0'),
          totalCostBasisCad: parseDecimal('0'),
          totalGainLossCad: parseDecimal('0'),
          totalTaxableGainLossCad: parseDecimal('0'),
          totalDeniedLossCad: parseDecimal('0'),
        },
        displayContext: { transferMarketValueCadByTransferId: new Map() },
      });

      const inputContext = createCanadaInputContext({ inputEvents: [], inputTransactionIds: [] });
      const original = createWorkflowResult({ taxReport, inputContext, displayReport: undefined });
      const parts = assertOk(buildCanadaArtifactSnapshotParts(original));
      const decoded = fromStoredCanadaArtifact(parts.artifact);

      expect(decoded.taxReport.acquisitions).toEqual([]);
      expect(decoded.taxReport.dispositions).toEqual([]);
      expect(decoded.taxReport.transfers).toEqual([]);
      expect(decoded.taxReport.superficialLossAdjustments).toEqual([]);
      expect(decoded.inputContext!.inputEvents).toEqual([]);
      expect(decoded.taxReport.displayContext.transferMarketValueCadByTransferId.size).toBe(0);
    });
  });
});
