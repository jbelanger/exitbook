import type { Currency } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { CostBasisMethod } from '../jurisdictions/jurisdiction-configs.js';
import type { AcquisitionLot, LotTransfer } from '../model/types.js';

export interface CostBasisFilingTaxTreatmentSummary {
  taxTreatmentCategory: string;
  dispositionCount: number;
  totalGainLoss: Decimal;
  totalTaxableGainLoss: Decimal;
}

export interface CostBasisFilingFactsSummary {
  assetCount: number;
  acquisitionCount: number;
  dispositionCount: number;
  transferCount: number;
  totalProceeds: Decimal;
  totalCostBasis: Decimal;
  totalGainLoss: Decimal;
  totalTaxableGainLoss: Decimal;
  totalDeniedLoss: Decimal;
  byTaxTreatment: CostBasisFilingTaxTreatmentSummary[];
}

export interface CostBasisFilingFactAssetIdentity {
  assetSymbol: Currency;
  assetId?: string | undefined;
  taxPropertyKey?: string | undefined;
}

export interface CostBasisFilingAssetSummary extends CostBasisFilingFactAssetIdentity {
  assetGroupingKey: string;
  acquisitionCount: number;
  dispositionCount: number;
  transferCount: number;
  totalProceeds: Decimal;
  totalCostBasis: Decimal;
  totalGainLoss: Decimal;
  totalTaxableGainLoss: Decimal;
  totalDeniedLoss: Decimal;
  byTaxTreatment: CostBasisFilingTaxTreatmentSummary[];
}

interface CostBasisFilingAcquisitionFactBase extends CostBasisFilingFactAssetIdentity {
  id: string;
  acquiredAt: Date;
  quantity: Decimal;
  remainingQuantity: Decimal;
  totalCostBasis: Decimal;
  costBasisPerUnit: Decimal;
  transactionId: number;
}

export interface StandardCostBasisAcquisitionFilingFact extends CostBasisFilingAcquisitionFactBase {
  kind: 'standard-acquisition';
  assetId: string;
  status: AcquisitionLot['status'];
}

export interface CanadaCostBasisAcquisitionFilingFact extends CostBasisFilingAcquisitionFactBase {
  kind: 'canada-acquisition';
  acquisitionEventId: string;
  taxPropertyKey: string;
  remainingAllocatedCostBasis: Decimal;
}

interface CostBasisFilingDispositionFactBase extends CostBasisFilingFactAssetIdentity {
  id: string;
  disposedAt: Date;
  quantity: Decimal;
  proceedsPerUnit: Decimal;
  totalProceeds: Decimal;
  totalCostBasis: Decimal;
  costBasisPerUnit: Decimal;
  gainLoss: Decimal;
  taxableGainLoss: Decimal;
  deniedLossAmount: Decimal;
  taxTreatmentCategory?: string | undefined;
}

export interface StandardCostBasisDispositionFilingFact extends CostBasisFilingDispositionFactBase {
  kind: 'standard-disposition';
  assetId: string;
  lotId: string;
  acquiredAt: Date;
  holdingPeriodDays: number;
  acquisitionTransactionId: number;
  disposalTransactionId: number;
  grossProceeds: Decimal;
  sellingExpenses: Decimal;
  netProceeds: Decimal;
  lossDisallowed: boolean;
}

export interface CanadaCostBasisDispositionFilingFact extends CostBasisFilingDispositionFactBase {
  kind: 'canada-disposition';
  dispositionEventId: string;
  taxPropertyKey: string;
  transactionId: number;
}

interface CostBasisFilingTransferFactBase extends CostBasisFilingFactAssetIdentity {
  id: string;
  transferredAt: Date;
  quantity: Decimal;
  totalCostBasis: Decimal;
  costBasisPerUnit: Decimal;
}

export interface StandardCostBasisTransferFilingFact extends CostBasisFilingTransferFactBase {
  kind: 'standard-transfer';
  assetId: string;
  sourceLotId: string;
  sourceTransactionId: number;
  targetTransactionId: number;
  provenanceKind: LotTransfer['provenance']['kind'];
  linkedConfirmedLinkId?: number | undefined;
  sourceAcquiredAt?: Date | undefined;
  sameAssetFeeAmount?: Decimal | undefined;
}

export interface CanadaCostBasisTransferFilingFact extends CostBasisFilingTransferFactBase {
  kind: 'canada-transfer';
  direction: 'in' | 'internal' | 'out';
  taxPropertyKey: string;
  transactionId: number;
  sourceTransferEventId?: string | undefined;
  targetTransferEventId?: string | undefined;
  sourceTransactionId?: number | undefined;
  targetTransactionId?: number | undefined;
  linkedConfirmedLinkId?: number | undefined;
  feeAdjustment: Decimal;
}

export interface CanadaSuperficialLossAdjustmentFilingFact extends CostBasisFilingFactAssetIdentity {
  kind: 'canada-superficial-loss-adjustment';
  id: string;
  adjustedAt: Date;
  taxPropertyKey: string;
  deniedLossAmount: Decimal;
  deniedQuantity: Decimal;
  relatedDispositionId: string;
  substitutedPropertyAcquisitionId: string;
}

export type CostBasisFilingAcquisitionFact =
  | StandardCostBasisAcquisitionFilingFact
  | CanadaCostBasisAcquisitionFilingFact;

export type CostBasisFilingDispositionFact =
  | StandardCostBasisDispositionFilingFact
  | CanadaCostBasisDispositionFilingFact;

export type CostBasisFilingTransferFact = StandardCostBasisTransferFilingFact | CanadaCostBasisTransferFilingFact;

interface CostBasisFilingFactsBase {
  calculationId: string;
  jurisdiction: string;
  method: CostBasisMethod;
  taxYear: number;
  taxCurrency: string;
  scopeKey?: string | undefined;
  snapshotId?: string | undefined;
  summary: CostBasisFilingFactsSummary;
  assetSummaries: CostBasisFilingAssetSummary[];
}

export interface StandardCostBasisFilingFacts extends CostBasisFilingFactsBase {
  kind: 'standard';
  acquisitions: StandardCostBasisAcquisitionFilingFact[];
  dispositions: StandardCostBasisDispositionFilingFact[];
  transfers: StandardCostBasisTransferFilingFact[];
}

export interface CanadaCostBasisFilingFacts extends CostBasisFilingFactsBase {
  kind: 'canada';
  acquisitions: CanadaCostBasisAcquisitionFilingFact[];
  dispositions: CanadaCostBasisDispositionFilingFact[];
  transfers: CanadaCostBasisTransferFilingFact[];
  superficialLossAdjustments: CanadaSuperficialLossAdjustmentFilingFact[];
}

export type CostBasisFilingFacts = StandardCostBasisFilingFacts | CanadaCostBasisFilingFacts;
