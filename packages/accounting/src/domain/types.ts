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
} from './schemas.ts';

import type { AcquisitionLot, CostBasisCalculation, LotDisposal } from './schemas.ts';

/**
 * Result of a cost basis calculation
 */
export interface CalculationResult {
  calculation: CostBasisCalculation;
  lots: AcquisitionLot[];
  disposals: LotDisposal[];
}
