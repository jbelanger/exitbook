import type { Result } from 'neverthrow';

import type { AcquisitionLot, LotDisposal } from '../../domain/schemas.js';

import type { DisposalRequest, ICostBasisStrategy } from './base-strategy.js';
import { matchDisposalToSortedLots, sortLotsFifo } from './matching-utils.js';

/**
 * FIFO (First-In-First-Out) cost basis strategy
 *
 * Matches disposals to the oldest acquisition lots first.
 * This is the default strategy in the US and most jurisdictions.
 *
 * Example:
 * - Buy 1 BTC on Jan 1 at $30k
 * - Buy 1 BTC on Jan 15 at $35k
 * - Sell 1 BTC on Feb 1
 * → Uses Jan 1 lot ($30k cost basis)
 */
export class FifoStrategy implements ICostBasisStrategy {
  getName(): 'fifo' {
    return 'fifo';
  }

  matchDisposal(disposal: DisposalRequest, openLots: AcquisitionLot[]): Result<LotDisposal[], Error> {
    // Sort lots oldest first
    const sortedLots = sortLotsFifo(openLots);

    // Match disposal to sorted lots
    return matchDisposalToSortedLots(disposal, sortedLots);
  }
}
