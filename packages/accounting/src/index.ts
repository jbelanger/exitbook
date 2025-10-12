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
