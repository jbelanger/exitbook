/**
 * @exitbook/accounting
 *
 * Cost basis calculation, acquisition lot tracking, and capital gains/losses reporting.
 * Supports multiple jurisdictions (Canada, US, UK, EU) with pluggable tax rules.
 */

// Configuration
export type { CostBasisConfig, FiatCurrency } from './cost-basis/cost-basis-config.js';
export { getDefaultDateRange } from './cost-basis/cost-basis-config.js';

// Domain types
export type {
  AcquisitionLot,
  CostBasisCalculation,
  CalculationStatus,
  LotDisposal,
  LotStatus,
  LotTransfer,
} from './cost-basis/types.js';

// Cost basis calculation
export { LotMatcher } from './cost-basis/lot-matcher.js';
export type {
  LotMatcherConfig,
  LotMatchResult,
  AssetLotMatchResult,
  AssetMatchError,
} from './cost-basis/lot-matcher.js';
export type { GainLossResult, AssetGainLossSummary, DisposalGainLoss } from './cost-basis/gain-loss-utils.js';
export {
  calculateGainLoss,
  checkLossDisallowance,
  aggregateAssetGainLoss,
  aggregateOverallGainLoss,
} from './cost-basis/gain-loss-utils.js';
export { calculateCostBasisFromValidatedTransactions } from './cost-basis/cost-basis-calculator.js';
export type { CostBasisSummary } from './cost-basis/cost-basis-calculator.js';
export { runCostBasisPipeline } from './cost-basis/cost-basis-pipeline.js';
export type { CostBasisPipelineResult } from './cost-basis/cost-basis-pipeline.js';

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
} from './cost-basis/report-types.js';
export { CostBasisReportGenerator } from './cost-basis/cost-basis-report-generator.js';
export type { CostBasisReportInput } from './cost-basis/cost-basis-report-generator.js';

// Ports
export type { LinkingStore } from './ports/index.js';
export type { PricingStore } from './ports/index.js';

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
  PotentialMatch,
  MatchingConfig,
} from './linking/types.js';
export { DEFAULT_MATCHING_CONFIG } from './linking/matching-config.js';
export { createTransactionLink } from './linking/link-construction.js';
export { LinkIndex } from './linking/link-index.js';

// Pre-linking & strategy-based matching
export { materializeLinkableMovements } from './linking/pre-linking/index.js';
export type { LinkableMovement, NewLinkableMovement, MaterializationResult } from './linking/pre-linking/index.js';
export { StrategyRunner } from './linking/strategy-runner.js';
export type { StrategyRunnerResult, StrategyStats } from './linking/strategy-runner.js';
export { defaultStrategies } from './linking/strategies/index.js';
export type { ILinkingStrategy, StrategyResult } from './linking/strategies/types.js';
// Cost basis utilities
export {
  buildCostBasisParams,
  validateCostBasisParams,
  validateTransactionPrices,
  filterTransactionsByDateRange,
  transactionHasAllPrices,
  getJurisdictionRules,
  formatCurrency,
} from './cost-basis/cost-basis-utils.js';
export type { CostBasisInput, ValidatedCostBasisConfig } from './cost-basis/cost-basis-utils.js';

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
