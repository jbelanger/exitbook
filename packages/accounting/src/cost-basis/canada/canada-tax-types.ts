import type { Currency, PriceAtTxTime } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

export interface CanadaTaxValuation {
  taxCurrency: 'CAD';
  storagePriceAmount: Decimal;
  storagePriceCurrency: Currency;
  quotedPriceAmount: Decimal;
  quotedPriceCurrency: Currency;
  unitValueCad: Decimal;
  totalValueCad: Decimal;
  valuationSource: 'quoted-price' | 'stored-price' | 'usd-to-cad-fx' | 'fiat-to-cad-fx';
  fxRateToCad?: Decimal | undefined;
  fxSource?: string | undefined;
  fxTimestamp?: Date | undefined;
}

export type CanadaTaxInputEventKind =
  | 'acquisition'
  | 'disposition'
  | 'transfer-in'
  | 'transfer-out'
  | 'fee-adjustment'
  | 'superficial-loss-adjustment';
export type CanadaTaxEventProvenanceKind =
  | 'scoped-movement'
  | 'validated-link'
  | 'fee-only-carryover'
  | 'superficial-loss-engine';
export type CanadaFeeAdjustmentType = 'add-to-pool-cost' | 'same-asset-transfer-fee-add-to-basis';

interface CanadaEventProvenance {
  provenanceKind: CanadaTaxEventProvenanceKind;
  linkId?: number | undefined;
  movementFingerprint?: string | undefined;
  sourceMovementFingerprint?: string | undefined;
  sourceTransactionId?: number | undefined;
  targetMovementFingerprint?: string | undefined;
}

interface CanadaBaseTaxEvent extends CanadaEventProvenance {
  eventId: string;
  transactionId: number;
  timestamp: Date;
  assetId: string;
  assetIdentityKey: string;
  taxPropertyKey: string;
  assetSymbol: Currency;
  valuation: CanadaTaxValuation;
  priceAtTxTime?: PriceAtTxTime | undefined;
}

export interface CanadaAcquisitionEvent extends CanadaBaseTaxEvent {
  kind: 'acquisition';
  quantity: Decimal;
  costBasisAdjustmentCad?: Decimal | undefined;
}

export interface CanadaDispositionEvent extends CanadaBaseTaxEvent {
  kind: 'disposition';
  quantity: Decimal;
  proceedsReductionCad?: Decimal | undefined;
}

export interface CanadaTransferInEvent extends CanadaBaseTaxEvent {
  kind: 'transfer-in';
  quantity: Decimal;
}

export interface CanadaTransferOutEvent extends CanadaBaseTaxEvent {
  kind: 'transfer-out';
  quantity: Decimal;
}

export interface CanadaFeeAdjustmentEvent extends CanadaBaseTaxEvent {
  kind: 'fee-adjustment';
  adjustmentType: CanadaFeeAdjustmentType;
  feeAssetId: string;
  feeAssetIdentityKey?: string | undefined;
  feeAssetSymbol: Currency;
  feeQuantity: Decimal;
  quantityReduced?: Decimal | undefined;
  relatedEventId?: string | undefined;
}

export interface CanadaSuperficialLossAdjustmentEvent extends CanadaBaseTaxEvent {
  kind: 'superficial-loss-adjustment';
  deniedLossCad: Decimal;
  deniedQuantity: Decimal;
  relatedDispositionEventId: string;
}

export type CanadaTaxInputEvent =
  | CanadaAcquisitionEvent
  | CanadaDispositionEvent
  | CanadaTransferInEvent
  | CanadaTransferOutEvent
  | CanadaFeeAdjustmentEvent
  | CanadaSuperficialLossAdjustmentEvent;

export interface CanadaTaxInputContext {
  taxCurrency: 'CAD';
  scopedTransactionIds: number[];
  validatedTransferLinkIds: number[];
  feeOnlyInternalCarryoverSourceTransactionIds: number[];
  inputEvents: CanadaTaxInputEvent[];
}

export interface CanadaAcquisitionLayer {
  layerId: string;
  taxPropertyKey: string;
  assetSymbol: Currency;
  acquisitionEventId: string;
  acquisitionTransactionId: number;
  acquiredAt: Date;
  quantityAcquired: Decimal;
  remainingQuantity: Decimal;
  totalCostCad: Decimal;
  remainingAllocatedAcbCad: Decimal;
}

export interface CanadaLayerDepletion {
  layerId: string;
  quantityDisposed: Decimal;
}

export interface CanadaDispositionRecord {
  dispositionEventId: string;
  transactionId: number;
  taxPropertyKey: string;
  assetSymbol: Currency;
  disposedAt: Date;
  quantityDisposed: Decimal;
  proceedsCad: Decimal;
  costBasisCad: Decimal;
  gainLossCad: Decimal;
  acbPerUnitCad: Decimal;
  layerDepletions: CanadaLayerDepletion[];
}

export interface CanadaAcbPoolState {
  taxPropertyKey: string;
  assetSymbol: Currency;
  quantityHeld: Decimal;
  totalAcbCad: Decimal;
  acbPerUnitCad: Decimal;
  acquisitionLayers: CanadaAcquisitionLayer[];
}

export interface CanadaAcbEngineResult {
  eventPoolSnapshots: CanadaEventPoolSnapshot[];
  pools: CanadaAcbPoolState[];
  dispositions: CanadaDispositionRecord[];
  totalProceedsCad: Decimal;
  totalCostBasisCad: Decimal;
  totalGainLossCad: Decimal;
}

export interface CanadaEventPoolSnapshot {
  eventId: string;
  eventKind: CanadaTaxInputEventKind;
  transactionId: number;
  timestamp: Date;
  taxPropertyKey: string;
  assetSymbol: Currency;
  quantityHeld: Decimal;
  totalAcbCad: Decimal;
  acbPerUnitCad: Decimal;
}

export interface CanadaCostBasisCalculation {
  id: string;
  calculationDate: Date;
  method: 'average-cost';
  jurisdiction: 'CA';
  taxYear: number;
  displayCurrency: Currency;
  taxCurrency: 'CAD';
  startDate: Date;
  endDate: Date;
  transactionsProcessed: number;
  assetsProcessed: string[];
}

export interface CanadaTaxReportAcquisition {
  id: string;
  acquisitionEventId: string;
  transactionId: number;
  taxPropertyKey: string;
  assetSymbol: Currency;
  acquiredAt: Date;
  quantityAcquired: Decimal;
  remainingQuantity: Decimal;
  totalCostCad: Decimal;
  remainingAllocatedAcbCad: Decimal;
  costBasisPerUnitCad: Decimal;
}

export interface CanadaTaxReportDisposition {
  id: string;
  dispositionEventId: string;
  transactionId: number;
  taxPropertyKey: string;
  assetSymbol: Currency;
  disposedAt: Date;
  quantityDisposed: Decimal;
  proceedsCad: Decimal;
  costBasisCad: Decimal;
  gainLossCad: Decimal;
  deniedLossCad: Decimal;
  taxableGainLossCad: Decimal;
  acbPerUnitCad: Decimal;
}

export interface CanadaTaxReportTransfer {
  id: string;
  direction: 'in' | 'internal' | 'out';
  sourceTransferEventId?: string | undefined;
  targetTransferEventId?: string | undefined;
  sourceTransactionId?: number | undefined;
  targetTransactionId?: number | undefined;
  linkId?: number | undefined;
  transactionId: number;
  taxPropertyKey: string;
  assetSymbol: Currency;
  transferredAt: Date;
  quantity: Decimal;
  carriedAcbCad: Decimal;
  carriedAcbPerUnitCad: Decimal;
  feeAdjustmentCad: Decimal;
}

export interface CanadaSuperficialLossAdjustment {
  id: string;
  adjustedAt: Date;
  assetSymbol: Currency;
  deniedLossCad: Decimal;
  deniedQuantity: Decimal;
  relatedDispositionId: string;
  taxPropertyKey: string;
  substitutedPropertyAcquisitionId: string;
}

export interface CanadaTaxReportSummary {
  totalProceedsCad: Decimal;
  totalCostBasisCad: Decimal;
  totalGainLossCad: Decimal;
  totalTaxableGainLossCad: Decimal;
  totalDeniedLossCad: Decimal;
}

export interface CanadaTaxReportDisplayContext {
  transferMarketValueCadByTransferId: Map<string, Decimal>;
}

export interface CanadaTaxReport {
  calculationId: string;
  taxCurrency: 'CAD';
  acquisitions: CanadaTaxReportAcquisition[];
  dispositions: CanadaTaxReportDisposition[];
  transfers: CanadaTaxReportTransfer[];
  superficialLossAdjustments: CanadaSuperficialLossAdjustment[];
  summary: CanadaTaxReportSummary;
  displayContext: CanadaTaxReportDisplayContext;
}

export interface CanadaDisplayFxConversion {
  sourceTaxCurrency: 'CAD';
  displayCurrency: Currency;
  fxRate: Decimal;
  fxSource: string;
  fxFetchedAt: Date;
}

export interface CanadaDisplayReportAcquisition extends CanadaTaxReportAcquisition {
  displayCostBasisPerUnit: Decimal;
  displayTotalCost: Decimal;
  displayRemainingAllocatedCost: Decimal;
  fxConversion: CanadaDisplayFxConversion;
}

export interface CanadaDisplayReportDisposition extends CanadaTaxReportDisposition {
  displayProceeds: Decimal;
  displayCostBasis: Decimal;
  displayGainLoss: Decimal;
  displayDeniedLoss: Decimal;
  displayTaxableGainLoss: Decimal;
  displayAcbPerUnit: Decimal;
  fxConversion: CanadaDisplayFxConversion;
}

export interface CanadaDisplayReportTransfer extends CanadaTaxReportTransfer {
  marketValueCad: Decimal;
  displayCarriedAcb: Decimal;
  displayCarriedAcbPerUnit: Decimal;
  displayMarketValue: Decimal;
  displayFeeAdjustment: Decimal;
  fxConversion: CanadaDisplayFxConversion;
}

export interface CanadaDisplayReportSummary {
  totalProceeds: Decimal;
  totalCostBasis: Decimal;
  totalGainLoss: Decimal;
  totalTaxableGainLoss: Decimal;
  totalDeniedLoss: Decimal;
}

export interface CanadaDisplayCostBasisReport {
  calculationId: string;
  sourceTaxCurrency: 'CAD';
  displayCurrency: Currency;
  acquisitions: CanadaDisplayReportAcquisition[];
  dispositions: CanadaDisplayReportDisposition[];
  transfers: CanadaDisplayReportTransfer[];
  summary: CanadaDisplayReportSummary;
}
