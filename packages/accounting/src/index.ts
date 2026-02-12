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

// Services
export { LotMatcher } from './services/lot-matcher.js';
export type { LotMatcherConfig, LotMatchResult, AssetLotMatchResult } from './services/lot-matcher.js';
export type { GainLossResult, AssetGainLossSummary, DisposalGainLoss } from './services/gain-loss-calculator.js';
export {
  calculateGainLoss,
  checkLossDisallowance,
  aggregateAssetGainLoss,
  aggregateOverallGainLoss,
} from './services/gain-loss-utils.js';
export { CostBasisCalculator } from './services/cost-basis-calculator.js';
export type { CostBasisSummary } from './services/cost-basis-calculator.js';

// Strategies
export { FifoStrategy } from './services/strategies/fifo-strategy.js';
export { LifoStrategy } from './services/strategies/lifo-strategy.js';
export { AverageCostStrategy } from './services/strategies/average-cost-strategy.js';
export type { ICostBasisStrategy, DisposalRequest } from './services/strategies/base-strategy.js';

// Repositories
// export { LotRepository } from './repositories/lot-repository.js';
// export { CalculationRepository } from './repositories/calculation-repository.js';

// Jurisdiction rules
export type { IJurisdictionRules } from './jurisdictions/base-rules.js';
export { CanadaRules } from './jurisdictions/canada-rules.js';
export { USRules } from './jurisdictions/us-rules.js';
export { JURISDICTION_CONFIGS, getJurisdictionConfig } from './jurisdictions/jurisdiction-configs.js';

// Reports
export type { CostBasisReport, ConvertedLotDisposal, FxConversionMetadata } from './reports/types.js';
export { CostBasisReportGenerator } from './reports/cost-basis-report-generator.js';
export type { ReportGeneratorConfig } from './reports/cost-basis-report-generator.js';

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
export { TransactionLinkingService } from './linking/transaction-linking-service.js';
export { DEFAULT_MATCHING_CONFIG, createTransactionLink } from './linking/matching-utils.js';
export { LinkIndex } from './linking/link-index.js';
export { TransactionLinkRepository } from './persistence/transaction-link-repository.js';
export { PriceEnrichmentService } from './price-enrichment/price-enrichment-service.js';
export { PriceNormalizationService } from './price-enrichment/price-normalization-service.js';
export type { NormalizeResult } from './price-enrichment/price-normalization-service.js';
export type { IFxRateProvider, FxRateData } from './price-enrichment/fx-rate-provider.interface.js';
export { StandardFxRateProvider } from './price-enrichment/standard-fx-rate-provider.js';
export { enrichMovementWithPrice, enrichMovementsWithPrices } from './price-enrichment/movement-enrichment-utils.js';
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
