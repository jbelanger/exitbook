/**
 * @exitbook/accounting
 *
 * Cost basis calculation, acquisition lot tracking, and capital gains/losses reporting.
 * Supports multiple jurisdictions (Canada, US, UK, EU) with pluggable tax rules.
 */

// Configuration
export type { CostBasisConfig, FiatCurrency } from './config/cost-basis-config.js';

// Domain types
export type {
  AcquisitionLot,
  LotDisposal,
  CostBasisCalculation,
  LotStatus,
  CalculationStatus,
} from './domain/types.js';

// Services
// export { CostBasisCalculator } from './services/cost-basis-calculator.js';

// Repositories
// export { LotRepository } from './repositories/lot-repository.js';
// export { CalculationRepository } from './repositories/calculation-repository.js';

// Jurisdiction rules
export type { IJurisdictionRules } from './jurisdictions/base-rules.js';
export { CanadaRules } from './jurisdictions/canada-rules.js';
export { USRules } from './jurisdictions/us-rules.js';

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
