import type { AssetReviewSummary } from '@exitbook/core';

import type { AccountingExclusionPolicy } from '../../accounting-model/accounting-exclusion-policy.js';
import type {
  CanadaCostBasisCalculation,
  CanadaDisplayCostBasisReport,
  CanadaTaxInputContext,
  CanadaTaxReport,
} from '../jurisdictions/canada/tax/canada-tax-types.js';
import type { CostBasisReport } from '../model/report-types.js';
import type { AcquisitionLot, LotDisposal, LotTransfer } from '../model/types.js';
import type { CostBasisSummary } from '../standard/calculation/standard-calculator.js';

export interface CostBasisExecutionMeta {
  missingPricesCount: number;
  retainedTransactionIds: number[];
}

export interface CostBasisWorkflowExecutionOptions {
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary> | undefined;
  missingPricePolicy: 'error' | 'exclude';
}

export interface StandardCostBasisWorkflowResult {
  kind: 'standard-workflow';
  summary: CostBasisSummary;
  report?: CostBasisReport | undefined;
  lots: AcquisitionLot[];
  disposals: LotDisposal[];
  lotTransfers: LotTransfer[];
  executionMeta: CostBasisExecutionMeta;
}

export interface CanadaCostBasisWorkflowResult {
  kind: 'canada-workflow';
  calculation: CanadaCostBasisCalculation;
  taxReport: CanadaTaxReport;
  displayReport?: CanadaDisplayCostBasisReport | undefined;
  inputContext?: CanadaTaxInputContext | undefined;
  executionMeta: CostBasisExecutionMeta;
}

export type CostBasisWorkflowResult = StandardCostBasisWorkflowResult | CanadaCostBasisWorkflowResult;
