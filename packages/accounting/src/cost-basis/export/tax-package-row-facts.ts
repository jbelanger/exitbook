import type { Currency } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

export interface TaxPackageGroupingKey {
  groupKey: string;
}

interface TaxPackageRowFactBase extends TaxPackageGroupingKey {
  assetSymbol: Currency;
}

export interface StandardDispositionExportFact extends TaxPackageRowFactBase {
  kind: 'standard-disposition';
  dispositionId: string;
  lotId: string;
  assetId: string;
  acquisitionTransactionId: number;
  acquisitionAccountId: number;
  disposalTransactionId: number;
  disposalAccountId: number;
  quantityDisposed: Decimal;
  grossProceeds: Decimal;
  sellingExpenses: Decimal;
  netProceeds: Decimal;
  totalCostBasis: Decimal;
  gainLoss: Decimal;
  lossDisallowed: boolean;
  disallowedLossAmount?: Decimal | undefined;
}

export interface StandardTransferExportFact extends TaxPackageRowFactBase {
  kind: 'standard-transfer';
  transferId: string;
  sourceLotId: string;
  sourceTransactionId: number;
  sourceAccountId: number;
  targetTransactionId: number;
  targetAccountId: number;
  linkedConfirmedLinkId?: number | undefined;
  quantityTransferred: Decimal;
  costBasisPerUnit: Decimal;
}

export interface CanadaDispositionExportFact extends TaxPackageRowFactBase {
  kind: 'canada-disposition';
  dispositionId: string;
  dispositionEventId: string;
  transactionId: number;
  accountId: number;
  taxPropertyKey: string;
  quantityDisposed: Decimal;
  proceedsCad: Decimal;
  costBasisCad: Decimal;
  gainLossCad: Decimal;
  deniedLossCad: Decimal;
  taxableGainLossCad: Decimal;
}

export interface CanadaTransferExportFact extends TaxPackageRowFactBase {
  kind: 'canada-transfer';
  transferId: string;
  transactionId: number;
  accountId: number;
  taxPropertyKey: string;
  sourceTransactionId?: number | undefined;
  sourceAccountId?: number | undefined;
  targetTransactionId?: number | undefined;
  targetAccountId?: number | undefined;
  linkedConfirmedLinkId?: number | undefined;
  quantity: Decimal;
  carriedAcbCad: Decimal;
  feeAdjustmentCad: Decimal;
}

export type TaxPackageRowFact =
  | StandardDispositionExportFact
  | StandardTransferExportFact
  | CanadaDispositionExportFact
  | CanadaTransferExportFact;
