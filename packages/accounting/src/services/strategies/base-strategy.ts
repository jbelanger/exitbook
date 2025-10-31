import type { Decimal } from 'decimal.js';

import type { AcquisitionLot, LotDisposal } from '../../domain/schemas.js';

/**
 * Disposal request for matching to acquisition lots
 */
export interface DisposalRequest {
  /** Transaction ID of the disposal */
  transactionId: number;
  /** Asset being disposed (e.g., 'BTC', 'ETH') */
  asset: string;
  /** Quantity being disposed */
  quantity: Decimal;
  /** Date of disposal */
  date: Date;
  /** Proceeds per unit (sale price) */
  proceedsPerUnit: Decimal;
}

/**
 * Interface for cost basis matching strategies
 *
 * Strategies determine which acquisition lots to match
 * against disposals when calculating capital gains/losses.
 */
export interface ICostBasisStrategy {
  /**
   * Get the name of this strategy
   */
  getName(): 'fifo' | 'lifo' | 'specific-id' | 'average-cost';

  /**
   * Match a disposal against open acquisition lots
   *
   * @param disposal - The disposal to match
   * @param openLots - Available open lots for this asset (sorted appropriately by caller)
   * @returns Array of lot disposals showing how the disposal was matched to lots
   */
  matchDisposal(disposal: DisposalRequest, openLots: AcquisitionLot[]): LotDisposal[];
}
