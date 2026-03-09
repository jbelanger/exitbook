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

export type CanadaTaxInputEventKind = 'acquisition' | 'disposition' | 'transfer-in' | 'transfer-out' | 'fee-adjustment';
export type CanadaTaxEventProvenanceKind = 'scoped-movement' | 'validated-link' | 'fee-only-carryover';
export type CanadaFeeAdjustmentType = 'add-to-pool-cost' | 'same-asset-transfer-fee-add-to-basis';

export interface CanadaEventProvenance {
  provenanceKind: CanadaTaxEventProvenanceKind;
  linkId?: number | undefined;
  movementFingerprint?: string | undefined;
  sourceMovementFingerprint?: string | undefined;
  sourceTransactionId?: number | undefined;
  targetMovementFingerprint?: string | undefined;
}

export interface CanadaBaseTaxEvent extends CanadaEventProvenance {
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

export type CanadaTaxInputEvent =
  | CanadaAcquisitionEvent
  | CanadaDispositionEvent
  | CanadaTransferInEvent
  | CanadaTransferOutEvent
  | CanadaFeeAdjustmentEvent;

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
  pools: CanadaAcbPoolState[];
  dispositions: CanadaDispositionRecord[];
  totalProceedsCad: Decimal;
  totalCostBasisCad: Decimal;
  totalGainLossCad: Decimal;
}
