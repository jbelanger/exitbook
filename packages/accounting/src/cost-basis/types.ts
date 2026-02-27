/**
 * Domain types - exported from schemas for single source of truth
 */
export type {
  AcquisitionLot,
  CalculationStatus,
  CostBasisCalculation,
  JurisdictionConfig,
  LotDisposal,
  LotStatus,
  LotTransfer,
  LotTransferMetadata,
  SameAssetTransferFeePolicy,
  VarianceTolerance,
} from './schemas.js';

import type { AcquisitionLot, CostBasisCalculation, LotDisposal } from './schemas.js';

/**
 * Result of a cost basis calculation
 */
export interface CalculationResult {
  calculation: CostBasisCalculation;
  lots: AcquisitionLot[];
  disposals: LotDisposal[];
}
