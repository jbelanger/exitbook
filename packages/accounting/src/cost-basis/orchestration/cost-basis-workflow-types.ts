import type { AssetReviewSummary } from '@exitbook/core';

import type {
  CanadaCostBasisCalculation,
  CanadaDisplayCostBasisReport,
  CanadaTaxInputContext,
  CanadaTaxReport,
} from '../canada/canada-tax-types.js';
import type { AccountingExclusionPolicy } from '../shared/accounting-exclusion-policy.js';
import type { CostBasisReport } from '../shared/report-types.js';
import type { AcquisitionLot, LotDisposal, LotTransfer } from '../shared/types.js';

import type { CostBasisSummary } from './cost-basis-calculator.js';

export interface CostBasisExecutionMeta {
  missingPricesCount: number;
  retainedTransactionIds: number[];
}

export interface CostBasisWorkflowExecutionOptions {
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary> | undefined;
  missingPricePolicy: 'error' | 'exclude';
}

export interface GenericCostBasisWorkflowResult {
  kind: 'generic-pipeline';
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

export type CostBasisWorkflowResult = GenericCostBasisWorkflowResult | CanadaCostBasisWorkflowResult;
