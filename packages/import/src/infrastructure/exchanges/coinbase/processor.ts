import type { CoinbaseLedgerEntry } from '@exitbook/exchanges';

import { CorrelatingExchangeProcessor } from '../shared/correlating-exchange-processor.ts';
import { byCorrelationId, coinbaseGrossAmounts } from '../shared/strategies/index.ts';

/**
 * Coinbase processor with correlation and gross amount semantics.
 * Fixes production bug where trades weren't being correlated.
 *
 * Uses:
 * - byCorrelationId grouping: Groups related entries (e.g., both sides of swap)
 * - coinbaseGrossAmounts interpretation: Handles Coinbase's unique amount semantics
 *
 * Coinbase specifics:
 * - Swaps create 2 correlated entries (one for each asset)
 * - For withdrawals: amount includes fee (gross), need to subtract for net
 * - For trades/deposits: amount is gross, fee is separate
 * - Fees may be duplicated across correlated entries (deduplication needed)
 *
 * Uses CoinbaseLedgerEntry generic parameter to provide type-safe access to raw Coinbase data.
 */
export class CoinbaseProcessor extends CorrelatingExchangeProcessor<CoinbaseLedgerEntry> {
  constructor() {
    super('coinbase', byCorrelationId, coinbaseGrossAmounts);
  }
}
