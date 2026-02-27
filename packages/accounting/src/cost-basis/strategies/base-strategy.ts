import type { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';

import type { AcquisitionLot, LotDisposal } from '../schemas.js';

/**
 * Disposal request for matching to acquisition lots
 */
export interface DisposalRequest {
  /** Transaction ID of the disposal */
  transactionId: number;
  /** Asset being disposed (e.g., 'BTC', 'ETH') */
  assetSymbol: string;
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
   * @returns Result containing array of lot disposals showing how the disposal was matched to lots, or Error on failure
   */
  matchDisposal(disposal: DisposalRequest, openLots: AcquisitionLot[]): Result<LotDisposal[], Error>;
}
