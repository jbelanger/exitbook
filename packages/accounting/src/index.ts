/**
 * @exitbook/accounting
 *
 * Cost basis calculation, acquisition lot tracking, and capital gains/losses reporting.
 * Supports multiple jurisdictions (Canada, US, UK, EU) with pluggable tax rules.
 */

// Configuration
export type { CostBasisConfig, FiatCurrency } from './cost-basis/shared/cost-basis-config.js';
export { getDefaultDateRange } from './cost-basis/shared/cost-basis-config.js';

// Domain types
export type {
  AcquisitionLot,
  CostBasisCalculation,
  CalculationStatus,
  LotDisposal,
  LotStatus,
  LotTransfer,
  LotTransferProvenance,
} from './cost-basis/shared/types.js';

// Cost basis calculation
export { LotMatcher } from './cost-basis/matching/lot-matcher.js';
export type { LotMatcherConfig, LotMatchResult, AssetLotMatchResult } from './cost-basis/matching/lot-matcher.js';
export type { GainLossResult, AssetGainLossSummary, DisposalGainLoss } from './cost-basis/shared/gain-loss-utils.js';
export {
  calculateGainLoss,
  checkLossDisallowance,
  aggregateAssetGainLoss,
  aggregateOverallGainLoss,
} from './cost-basis/shared/gain-loss-utils.js';
export { calculateCostBasisFromValidatedTransactions } from './cost-basis/orchestration/cost-basis-calculator.js';
export type { CostBasisSummary } from './cost-basis/orchestration/cost-basis-calculator.js';
export { runCostBasisPipeline } from './cost-basis/orchestration/cost-basis-pipeline.js';
export type {
  CostBasisPipelineOptions,
  CostBasisPipelineResult,
  MissingPricePolicy,
} from './cost-basis/orchestration/cost-basis-pipeline.js';
export { CostBasisWorkflow } from './cost-basis/orchestration/cost-basis-workflow.js';
export type { CostBasisWorkflowResult } from './cost-basis/orchestration/cost-basis-workflow.js';
export { buildAccountingScopedTransactions } from './cost-basis/matching/build-accounting-scoped-transactions.js';
export type {
  AccountingScopedBuildResult,
  AccountingScopedTransaction,
  FeeOnlyInternalCarryover,
  ScopedAssetMovement,
  ScopedFeeMovement,
} from './cost-basis/matching/build-accounting-scoped-transactions.js';
export { validateScopedTransferLinks } from './cost-basis/matching/validated-scoped-transfer-links.js';
export type {
  ValidatedScopedTransferLink,
  ValidatedScopedTransferSet,
} from './cost-basis/matching/validated-scoped-transfer-links.js';

// Strategies
export { FifoStrategy } from './cost-basis/strategies/fifo-strategy.js';
export { LifoStrategy } from './cost-basis/strategies/lifo-strategy.js';
export { AverageCostStrategy } from './cost-basis/strategies/average-cost-strategy.js';
export type { ICostBasisStrategy, DisposalRequest } from './cost-basis/strategies/base-strategy.js';

// Jurisdiction rules
export type { IJurisdictionRules } from './cost-basis/jurisdictions/base-rules.js';
export { CanadaRules } from './cost-basis/jurisdictions/canada-rules.js';
export { USRules } from './cost-basis/jurisdictions/us-rules.js';
export { JURISDICTION_CONFIGS, getJurisdictionConfig } from './cost-basis/jurisdictions/jurisdiction-configs.js';

// Reports
export type {
  CostBasisReport,
  ConvertedAcquisitionLot,
  ConvertedLotDisposal,
  ConvertedLotTransfer,
  FxConversionMetadata,
} from './cost-basis/shared/report-types.js';
export { CostBasisReportGenerator } from './cost-basis/orchestration/cost-basis-report-generator.js';
export type { CostBasisReportInput } from './cost-basis/orchestration/cost-basis-report-generator.js';

// Ports
export type { ICostBasisPersistence, CostBasisContext } from './ports/index.js';
export type { ILinkingPersistence, LinksSaveResult } from './ports/index.js';
export type { IPricingPersistence, PricingContext } from './ports/index.js';

// Linking orchestrator
export { LinkingOrchestrator } from './linking/linking-orchestrator.js';
export type { LinkingRunParams, LinkingRunResult } from './linking/linking-orchestrator.js';
export type { LinkingEvent } from './linking/linking-events.js';
export { buildLinkFromOrphanedOverride, categorizeFinalLinks } from './linking/linking-orchestrator-utils.js';
export { applyLinkOverrides, buildFingerprintMap, resolveTxId } from './linking/override-replay.js';
export type { OrphanedLinkOverride } from './linking/override-replay.js';

// Transaction linking
export type {
  LinkType,
  LinkStatus,
  MatchCriteria,
  TransactionLink,
  TransactionLinkMetadata,
  TransactionLinkScoreBreakdownEntry,
  SameHashExternalSourceAllocation,
  PotentialMatch,
  MatchingConfig,
} from './linking/types.js';
export { DEFAULT_MATCHING_CONFIG } from './linking/matching-config.js';
export { createTransactionLink } from './linking/link-construction.js';
export { LinkIndex } from './linking/link-index.js';
export { hasImpliedFeeLinkMetadata, isPartialMatchLinkMetadata, isSameHashExternalLinkMetadata } from '@exitbook/core';

// Pre-linking & strategy-based matching
export { buildLinkCandidates } from './linking/pre-linking/index.js';
export type { LinkCandidate, LinkCandidateBuildResult } from './linking/pre-linking/index.js';
export { StrategyRunner } from './linking/strategy-runner.js';
export type { StrategyRunnerResult, StrategyStats } from './linking/strategy-runner.js';
export { defaultStrategies } from './linking/strategies/index.js';
export type { ILinkingStrategy, StrategyResult } from './linking/strategies/types.js';
// Cost basis utilities
export {
  buildCostBasisParams,
  validateCostBasisParams,
  validateTransactionPrices,
  validateScopedTransactionPrices,
  filterTransactionsByDateRange,
  transactionHasAllPrices,
  scopedTransactionHasAllPrices,
  getJurisdictionRules,
  formatCurrency,
} from './cost-basis/shared/cost-basis-utils.js';
export type { CostBasisInput, ValidatedCostBasisConfig } from './cost-basis/shared/cost-basis-utils.js';

// Transaction price coverage
export { checkTransactionPriceCoverage } from './cost-basis/orchestration/transaction-price-coverage-utils.js';
export type {
  PriceCoverageResult,
  PriceCoverageInput,
} from './cost-basis/orchestration/transaction-price-coverage-utils.js';

export { PriceDerivationService } from './price-enrichment/price-derivation-service.js';
export type { PriceEvent } from './price-enrichment/price-events.js';
export {
  validateAssetFilter,
  extractAssetsNeedingPrices,
  createPriceQuery,
  initializeStats,
  determineEnrichmentStages,
} from './price-enrichment/price-fetch-utils.js';
export type {
  PriceFetchOptions,
  PriceFetchStats,
  PricesFetchResult,
  EnrichmentStageOptions,
  EnrichmentStages,
} from './price-enrichment/price-fetch-utils.js';
export { PriceFetchService, PriceFetchAbortError } from './price-enrichment/price-fetch-service.js';
export { PriceEnrichmentPipeline, NormalizeAbortError } from './price-enrichment/price-enrichment-pipeline.js';
export type { PricesEnrichOptions, PricesEnrichResult } from './price-enrichment/price-enrichment-pipeline.js';
export { PriceNormalizationService } from './price-enrichment/price-normalization-service.js';
export type { NormalizeResult } from './price-enrichment/price-normalization-service.js';
export type { IFxRateProvider, FxRateData } from './price-enrichment/types.js';
export { StandardFxRateProvider } from './price-enrichment/standard-fx-rate-provider.js';
export {
  enrichWithPrice,
  enrichMovementWithPrice,
  enrichMovementsWithPrices,
} from './price-enrichment/movement-enrichment-utils.js';
export {
  extractMovementsNeedingNormalization,
  validateFxRate,
  createNormalizedPrice,
  movementNeedsNormalization,
  classifyMovementPrice,
} from './price-enrichment/price-normalization-utils.js';
export type { MovementsNeedingNormalization } from './price-enrichment/price-normalization-utils.js';
export {
  inferMultiPass,
  propagatePricesAcrossLinks,
  enrichFeePricesFromMovements,
} from './price-enrichment/price-enrichment-utils.js';
export type { InferMultiPassResult, PropagatePricesResult } from './price-enrichment/price-enrichment-utils.js';
