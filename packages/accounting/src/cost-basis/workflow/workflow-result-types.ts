import type { AssetReviewSummary } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { AccountingExclusionPolicy } from '../../accounting-model/accounting-exclusion-policy.js';
import type {
  CanadaCostBasisCalculation,
  CanadaDisplayCostBasisReport,
  CanadaTaxInputContext,
  CanadaTaxReport,
} from '../jurisdictions/canada/tax/canada-tax-types.js';
import type {
  LedgerCostBasisExcludedPosting,
  LedgerCostBasisProjectionBlocker,
} from '../ledger/ledger-cost-basis-event-projection.js';
import type { LedgerCostBasisOperationBlocker } from '../ledger/ledger-cost-basis-operation-projection.js';
import type { CostBasisReport } from '../model/report-types.js';
import type { AcquisitionLot, LotDisposal, LotTransfer } from '../model/types.js';
import type { CostBasisSummary } from '../standard/calculation/standard-calculator.js';
import type { StandardLedgerOperationEngineResult } from '../standard/operation-engine/standard-ledger-operation-engine.js';

import type { ValidatedCostBasisConfig } from './cost-basis-input.js';

export interface CostBasisExecutionMeta {
  missingPricesCount: number;
  missingPriceTransactionIds: number[];
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

export interface StandardLedgerCostBasisCalculation {
  id: string;
  calculationDate: Date;
  config: ValidatedCostBasisConfig;
  startDate: Date;
  endDate: Date;
  totalProceeds: Decimal;
  totalCostBasis: Decimal;
  totalGainLoss: Decimal;
  totalTaxableGainLoss: Decimal;
  assetsProcessed: string[];
  eventsProjected: number;
  operationsProcessed: number;
  lotsCreated: number;
  disposalsProcessed: number;
  blockersProduced: number;
  status: 'completed' | 'failed';
  errorMessage?: string | undefined;
  createdAt: Date;
  completedAt?: Date | undefined;
}

export interface StandardLedgerCostBasisExecutionMeta {
  calculationBlockerIds: string[];
  eventIds: string[];
  excludedPostingFingerprints: string[];
  exclusionFingerprint: string;
  operationBlockerIds: string[];
  operationIds: string[];
  projectionBlockerMessages: string[];
}

export interface StandardLedgerCostBasisProjectionAudit {
  eventIds: string[];
  operationIds: string[];
  projectionBlockers: readonly LedgerCostBasisProjectionBlocker[];
  operationBlockers: readonly LedgerCostBasisOperationBlocker[];
  excludedPostings: readonly LedgerCostBasisExcludedPosting[];
  exclusionFingerprint: string;
}

export interface StandardLedgerCostBasisWorkflowResult {
  kind: 'standard-ledger-workflow';
  calculation: StandardLedgerCostBasisCalculation;
  projection: StandardLedgerCostBasisProjectionAudit;
  engineResult: StandardLedgerOperationEngineResult;
  executionMeta: StandardLedgerCostBasisExecutionMeta;
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
