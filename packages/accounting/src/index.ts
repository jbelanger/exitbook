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
export { GainLossCalculator } from './services/gain-loss-calculator.js';
export type { GainLossResult, AssetGainLossSummary, DisposalGainLoss } from './services/gain-loss-calculator.js';
export { CostBasisCalculator } from './services/cost-basis-calculator.js';
export type { CostBasisSummary } from './services/cost-basis-calculator.js';

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
export { DEFAULT_MATCHING_CONFIG } from './linking/matching-utils.js';
export { TransactionLinkRepository } from './persistence/transaction-link-repository.js';
export { CostBasisRepository } from './persistence/cost-basis-repository.js';
export { LotTransferRepository } from './persistence/lot-transfer-repository.js';
export { PriceEnrichmentService } from './price-enrichment/price-enrichment-service.ts';
export { PriceNormalizationService } from './price-enrichment/price-normalization-service.ts';
export type { NormalizeResult } from './price-enrichment/price-normalization-service.ts';
export type { IFxRateProvider, FxRateData } from './price-enrichment/fx-rate-provider.interface.ts';
export { StandardFxRateProvider } from './price-enrichment/standard-fx-rate-provider.ts';
export { enrichMovementWithPrice, enrichMovementsWithPrices } from './price-enrichment/movement-enrichment-utils.ts';
export {
  extractMovementsNeedingNormalization,
  validateFxRate,
  createNormalizedPrice,
  movementNeedsNormalization,
  classifyMovementPrice,
} from './price-enrichment/price-normalization-utils.ts';
export type { MovementsNeedingNormalization } from './price-enrichment/price-normalization-utils.ts';
export {
  inferMultiPass,
  propagatePricesAcrossLinks,
  enrichFeePricesFromMovements,
} from './price-enrichment/price-enrichment-utils.ts';
export type { InferMultiPassResult, PropagatePricesResult } from './price-enrichment/price-enrichment-utils.ts';
