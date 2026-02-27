/**
 * @exitbook/accounting
 *
 * Cost basis calculation, acquisition lot tracking, and capital gains/losses reporting.
 * Supports multiple jurisdictions (Canada, US, UK, EU) with pluggable tax rules.
 */

// Configuration
export type { CostBasisConfig, FiatCurrency } from './config/cost-basis-config.js';
export { getDefaultDateRange } from './config/cost-basis-config.js';

// Domain types
export type {
  AcquisitionLot,
  CostBasisCalculation,
  CalculationStatus,
  LotDisposal,
  LotStatus,
  LotTransfer,
} from './domain/types.js';

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
export { calculateCostBasis } from './cost-basis/cost-basis-calculator.js';
export type { CostBasisSummary } from './cost-basis/cost-basis-calculator.js';
export { computeCostBasis } from './cost-basis/cost-basis-compute.js';
export type { CostBasisComputationResult } from './cost-basis/cost-basis-compute.js';

// Strategies
export { FifoStrategy } from './cost-basis/strategies/fifo-strategy.js';
export { LifoStrategy } from './cost-basis/strategies/lifo-strategy.js';
export { AverageCostStrategy } from './cost-basis/strategies/average-cost-strategy.js';
export type { ICostBasisStrategy, DisposalRequest } from './cost-basis/strategies/base-strategy.js';

// Jurisdiction rules
export type { IJurisdictionRules } from './jurisdictions/base-rules.js';
export { CanadaRules } from './jurisdictions/canada-rules.js';
export { USRules } from './jurisdictions/us-rules.js';
export { JURISDICTION_CONFIGS, getJurisdictionConfig } from './jurisdictions/jurisdiction-configs.js';

// Reports
export type {
  CostBasisReport,
  ConvertedAcquisitionLot,
  ConvertedLotDisposal,
  ConvertedLotTransfer,
  FxConversionMetadata,
} from './reports/types.js';
export { CostBasisReportGenerator } from './reports/cost-basis-report-generator.js';
export type { ReportGeneratorConfig } from './reports/cost-basis-report-generator.js';

// Linking orchestrator
export { LinkingOrchestrator } from './linking/linking-orchestrator.js';
export type { LinkingRunParams, LinkingRunResult } from './linking/linking-orchestrator.js';
export type { LinkingEvent } from './linking/linking-events.js';
export {
  resolveUniqueAssetId,
  buildLinkFromOrphanedOverride,
  categorizeFinalLinks,
} from './linking/linking-orchestrator-utils.js';

// Transaction linking
export type {
  LinkType,
  LinkStatus,
  MatchCriteria,
  TransactionLink,
  PotentialMatch,
  TransactionCandidate,
  MatchingConfig,
  LinkingResult,
} from './linking/types.js';
export { TransactionLinkingEngine } from './linking/transaction-linking-engine.js';
export { DEFAULT_MATCHING_CONFIG, createTransactionLink } from './linking/matching-utils.js';
export { LinkIndex } from './linking/link-index.js';
export { createTransactionLinkQueries, type TransactionLinkQueries } from './persistence/transaction-link-queries.js';
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
export type { CostBasisHandlerParams, CostBasisConfigWithDates } from './cost-basis/cost-basis-utils.js';

export { PriceDerivationService as PriceEnrichmentService } from './price-enrichment/price-derivation-service.js';
export type { PriceEvent } from './price-enrichment/price-events.js';
export {
  validateAssetFilter,
  extractAssetsNeedingPrices,
  createPriceQuery,
  initializeStats,
  determineEnrichmentStages,
} from './price-enrichment/price-fetch-utils.js';
export type {
  PricesFetchCommandOptions,
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
export type { IFxRateProvider, FxRateData } from './price-enrichment/fx-rate-provider.interface.js';
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
