import type { Result } from 'neverthrow';

import type { AcquisitionLot, LotDisposal } from '../schemas.js';

import type { DisposalRequest, ICostBasisStrategy } from './base-strategy.js';
import { matchDisposalToSortedLots, sortLotsLifo } from './lot-sorting-utils.js';

/**
 * LIFO (Last-In-First-Out) cost basis strategy
 *
 * Matches disposals to the newest acquisition lots first.
 * Can be advantageous in rising markets to maximize cost basis and minimize gains.
 *
 * Example:
 * - Buy 1 BTC on Jan 1 at $30k
 * - Buy 1 BTC on Jan 15 at $35k
 * - Sell 1 BTC on Feb 1
 * → Uses Jan 15 lot ($35k cost basis)
 */
export class LifoStrategy implements ICostBasisStrategy {
  getName(): 'lifo' {
    return 'lifo';
  }

  matchDisposal(disposal: DisposalRequest, openLots: AcquisitionLot[]): Result<LotDisposal[], Error> {
    // Sort lots newest first
    const sortedLots = sortLotsLifo(openLots);

    // Match disposal to sorted lots
    return matchDisposalToSortedLots(disposal, sortedLots);
  }
}
