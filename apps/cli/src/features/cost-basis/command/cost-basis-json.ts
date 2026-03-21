import { outputSuccess } from '../../shared/json-output.js';
import type { CostBasisPresentationModel } from '../view/cost-basis-view-utils.js';

interface CostBasisCommandResult {
  calculationId: string;
  method: string;
  jurisdiction: string;
  taxYear: number;
  currency: string;
  dateRange: {
    endDate: string;
    startDate: string;
  };
  summary: CostBasisPresentationModel['summary'];
  assets: {
    asset: string;
    avgHoldingDays?: number | undefined;
    disposalCount: number;
    disposals: {
      acquisitionDate?: string | undefined;
      acquisitionTransactionId?: number | undefined;
      asset: string;
      costBasisPerUnit: string;
      date: string;
      disposalTransactionId: number;
      fxConversion?: { fxRate: string; fxSource: string } | undefined;
      gainLoss: string;
      holdingPeriodDays?: number | undefined;
      id: string;
      isGain: boolean;
      proceedsPerUnit: string;
      quantityDisposed: string;
      sortTimestamp: string;
      taxableGainLoss?: string | undefined;
      taxTreatmentCategory?: string | undefined;
      totalCostBasis: string;
      totalProceeds: string;
      type: 'disposal';
    }[];
    isGain: boolean;
    longestHoldingDays?: number | undefined;
    longTermCount?: number | undefined;
    longTermGainLoss?: string | undefined;
    lotCount: number;
    lots: {
      asset: string;
      costBasisPerUnit: string;
      date: string;
      fxConversion?: { fxRate: string; fxSource: string } | undefined;
      fxUnavailable?: true | undefined;
      id: string;
      lotId: string;
      originalCurrency?: string | undefined;
      quantity: string;
      remainingQuantity: string;
      sortTimestamp: string;
      status: string;
      totalCostBasis: string;
      transactionId: number;
      type: 'acquisition';
    }[];
    shortestHoldingDays?: number | undefined;
    shortTermCount?: number | undefined;
    shortTermGainLoss?: string | undefined;
    totalCostBasis: string;
    totalGainLoss: string;
    totalProceeds: string;
    totalTaxableGainLoss: string;
    transferCount: number;
    transfers: {
      asset: string;
      costBasisPerUnit: string;
      date: string;
      direction: 'in' | 'internal' | 'out';
      feeAmount?: string | undefined;
      feeCurrency?: string | undefined;
      fxConversion?: { fxRate: string; fxSource: string } | undefined;
      fxUnavailable?: true | undefined;
      id: string;
      marketValue?: string | undefined;
      originalCurrency?: string | undefined;
      quantity: string;
      sortTimestamp: string;
      sourceAcquisitionDate?: string | undefined;
      sourceLotId?: string | undefined;
      sourceTransactionId?: number | undefined;
      targetTransactionId?: number | undefined;
      totalCostBasis: string;
      type: 'transfer';
    }[];
  }[];
}

export function outputCostBasisJSON(presentation: CostBasisPresentationModel): void {
  const resultData: CostBasisCommandResult = {
    calculationId: presentation.context.calculationId,
    method: presentation.context.method,
    jurisdiction: presentation.context.jurisdiction,
    taxYear: presentation.context.taxYear,
    currency: presentation.context.currency,
    dateRange: presentation.context.dateRange,
    summary: presentation.summary,
    assets: presentation.assetItems,
  };

  outputSuccess('cost-basis', resultData);
}
