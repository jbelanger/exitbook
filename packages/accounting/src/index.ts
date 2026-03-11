/**
 * @exitbook/accounting
 *
 * Cost basis calculation, acquisition lot tracking, and capital gains/losses reporting.
 * Supports multiple jurisdictions (Canada, US, UK, EU) with pluggable tax rules.
 */

// Configuration
export type { FiatCurrency } from './cost-basis/shared/cost-basis-config.js';
export { getDefaultDateRange } from './cost-basis/shared/cost-basis-config.js';

// Domain types
export type { AcquisitionLot, LotDisposal, LotTransfer, TaxAssetIdentityPolicy } from './cost-basis/shared/types.js';
export type {
  AccountingExclusionApplyResult,
  AccountingExclusionPolicy,
} from './cost-basis/shared/accounting-exclusion-policy.js';
export {
  applyAccountingExclusionPolicy,
  createAccountingExclusionPolicy,
  hasAccountingExclusions,
  isExcludedAsset,
} from './cost-basis/shared/accounting-exclusion-policy.js';

// Cost basis calculation
export { runCostBasisPipeline } from './cost-basis/orchestration/cost-basis-pipeline.js';
export { CostBasisWorkflow } from './cost-basis/orchestration/cost-basis-workflow.js';
export { buildCostBasisScopedTransactions } from './cost-basis/matching/build-cost-basis-scoped-transactions.js';
export {
  filterConfirmableTransferProposals,
  validateTransferProposalConfirmability,
} from './cost-basis/matching/transfer-proposal-confirmability.js';
export { validateScopedTransferLinks } from './cost-basis/matching/validated-scoped-transfer-links.js';
export type {
  CanadaCostBasisWorkflowResult,
  CostBasisWorkflowResult,
  GenericCostBasisWorkflowResult,
} from './cost-basis/orchestration/cost-basis-workflow.js';

// Reports
export type {
  ConvertedAcquisitionLot,
  ConvertedLotDisposal,
  ConvertedLotTransfer,
} from './cost-basis/shared/report-types.js';

// Ports
export type { ICostBasisPersistence } from './ports/index.js';

// Linking orchestrator
export { LinkingOrchestrator } from './linking/orchestration/linking-orchestrator.js';
export type { LinkingRunParams, LinkingRunResult } from './linking/orchestration/linking-orchestrator.js';
export type { LinkingEvent } from './linking/orchestration/linking-events.js';

// Transaction linking
export type { LinkStatus, MatchCriteria, TransactionLink } from './linking/shared/types.js';
export {
  deriveTransferProposalStatus,
  getExplicitTransferProposalKey,
  getTransferProposalGroupKey,
  groupLinksByTransferProposal,
} from './linking/shared/transfer-proposals.js';
export { hasImpliedFeeAmount, isPartialMatchLinkMetadata, isSameHashExternalLinkMetadata } from '@exitbook/core';

// Cost basis utilities
export {
  buildCostBasisInput,
  getCostBasisRebuildTransactions,
  validateCostBasisInput,
} from './cost-basis/shared/cost-basis-utils.js';
export type { CostBasisInput, ValidatedCostBasisConfig } from './cost-basis/shared/cost-basis-utils.js';

// Transaction price coverage
export { checkTransactionPriceCoverage } from './cost-basis/orchestration/transaction-price-coverage-utils.js';

export type { PriceEvent } from './price-enrichment/shared/price-events.js';
export {
  validateAssetFilter,
  extractAssetsNeedingPrices,
  createPriceQuery,
  initializeStats,
  determineEnrichmentStages,
} from './price-enrichment/enrichment/price-fetch-utils.js';
export { PriceEnrichmentPipeline } from './price-enrichment/orchestration/price-enrichment-pipeline.js';
export type {
  PricesEnrichOptions,
  PricesEnrichResult,
} from './price-enrichment/orchestration/price-enrichment-pipeline.js';
export { StandardFxRateProvider } from './price-enrichment/fx/standard-fx-rate-provider.js';
export { buildCanadaTaxInputContext } from './cost-basis/canada/canada-tax-context-builder.js';
export { runCanadaAcbWorkflow } from './cost-basis/canada/canada-acb-workflow.js';
export type { CanadaAcbWorkflowOptions, CanadaAcbWorkflowResult } from './cost-basis/canada/canada-acb-workflow.js';
export type {
  CanadaTaxInputEvent,
  CanadaTaxInputEventKind,
  CanadaTaxInputContext,
  CanadaTaxValuation,
} from './cost-basis/canada/canada-tax-types.js';
export { runCanadaAcbEngine } from './cost-basis/canada/canada-acb-engine.js';
export { runCanadaSuperficialLossEngine } from './cost-basis/canada/canada-superficial-loss-engine.js';
export {
  buildCanadaDisplayCostBasisReport,
  buildCanadaTaxReport,
} from './cost-basis/canada/canada-tax-report-builder.js';
export type {
  CanadaAcbEngineResult,
  CanadaAcbPoolState,
  CanadaAcquisitionLayer,
  CanadaCostBasisCalculation,
  CanadaDisplayCostBasisReport,
  CanadaDisplayFxConversion,
  CanadaDisplayReportAcquisition,
  CanadaDisplayReportDisposition,
  CanadaDisplayReportSummary,
  CanadaDisplayReportTransfer,
  CanadaDispositionRecord,
  CanadaSuperficialLossAdjustmentEvent,
  CanadaSuperficialLossAdjustment,
  CanadaTaxReport,
  CanadaTaxReportAcquisition,
  CanadaTaxReportDisposition,
  CanadaTaxReportSummary,
  CanadaTaxReportTransfer,
} from './cost-basis/canada/canada-tax-types.js';
export type {
  CanadaSuperficialLossDispositionAdjustment,
  CanadaSuperficialLossEngineResult,
} from './cost-basis/canada/canada-superficial-loss-types.js';
