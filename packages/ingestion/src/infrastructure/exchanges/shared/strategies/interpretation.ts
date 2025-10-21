import { parseDecimal } from '@exitbook/core';
import type { CoinbaseLedgerEntry } from '@exitbook/exchanges';

import type { RawTransactionWithMetadata } from './grouping.ts';

/**
 * Result of interpreting a single ledger entry.
 * Arrays support multi-leg transactions.
 */
export interface LedgerEntryInterpretation {
  inflows: { amount: string; asset: string }[];
  outflows: { amount: string; asset: string }[];
  fees: { amount: string; currency: string }[];
}

/**
 * Strategy for interpreting what amounts/fees a ledger entry contributes.
 *
 * Has access to both normalized (validated) and raw (full context) data.
 * Determines the actual fund movements from exchange-specific semantics.
 *
 * @template TRaw - The raw exchange-specific type for accessing additional context
 */
export interface InterpretationStrategy<TRaw = unknown> {
  interpret(
    entry: RawTransactionWithMetadata<TRaw>,
    group: RawTransactionWithMetadata<TRaw>[]
  ): LedgerEntryInterpretation;
}

/**
 * Standard amount semantics (most exchanges like Kraken, KuCoin).
 *
 * - entry.normalized.amount is NET movement (what actually moved)
 * - entry.normalized.fee is SEPARATE deduction
 * - Balance change = amount - fee (for outflows)
 */
export const standardAmounts: InterpretationStrategy = {
  interpret(entry: RawTransactionWithMetadata, _group: RawTransactionWithMetadata[]): LedgerEntryInterpretation {
    const amount = parseDecimal(entry.normalized.amount);
    const absAmount = amount.abs();
    const asset = entry.normalized.asset;

    const feeCost =
      entry.normalized.fee && !parseDecimal(entry.normalized.fee).isZero()
        ? parseDecimal(entry.normalized.fee)
        : undefined;
    const feeCurrency = entry.normalized.feeCurrency || asset;

    return {
      inflows: amount.isPositive() ? [{ amount: absAmount.toString(), asset }] : [],
      outflows: amount.isNegative() ? [{ amount: absAmount.toString(), asset }] : [],
      fees: feeCost ? [{ amount: feeCost.toString(), currency: feeCurrency }] : [],
    };
  },
};

/**
 * Coinbase amount semantics.
 *
 * - For trades/deposits: amount is GROSS movement, fee is separate
 * - For withdrawals: amount is GROSS (includes fee), need to subtract fee for net
 * - Fees may be duplicated across correlated entries (need deduplication)
 *
 * Uses entry.raw for Coinbase-specific context (direction, fee details).
 * Uses entry.normalized for validated common fields (amount, asset, correlationId).
 */
class CoinbaseGrossAmountsStrategy implements InterpretationStrategy<CoinbaseLedgerEntry> {
  interpret(
    entry: RawTransactionWithMetadata<CoinbaseLedgerEntry>,
    group: RawTransactionWithMetadata<CoinbaseLedgerEntry>[]
  ): LedgerEntryInterpretation {
    const amount = parseDecimal(entry.normalized.amount);
    const absAmount = amount.abs();
    const asset = entry.normalized.asset;
    const feeCost = entry.normalized.fee ? parseDecimal(entry.normalized.fee) : parseDecimal('0');
    const feeCurrency = entry.normalized.feeCurrency || asset;

    // Deduplicate fees across group using RAW fee data (more accurate than parsed strings)
    const shouldIncludeFee = this.shouldIncludeFeeForEntry(entry, group);

    // Use raw data for type detection
    // Withdrawals include: fiat_withdrawal, transaction (crypto sends)
    const isWithdrawal = entry.normalized.type === 'fiat_withdrawal' || entry.normalized.type === 'transaction';

    const isInflow = amount.isPositive();

    if (isWithdrawal && !isInflow) {
      // Withdrawal: amount is GROSS (includes fee), subtract to get net outflow
      const netAmount = absAmount.minus(feeCost);
      return {
        inflows: [],
        outflows: [{ amount: netAmount.toString(), asset }],
        fees: shouldIncludeFee ? [{ amount: feeCost.toString(), currency: feeCurrency }] : [],
      };
    }

    // Trades/deposits: amount is GROSS, fee is separate
    return {
      inflows: isInflow ? [{ amount: absAmount.toString(), asset }] : [],
      outflows: !isInflow ? [{ amount: absAmount.toString(), asset }] : [],
      fees: shouldIncludeFee && !feeCost.isZero() ? [{ amount: feeCost.toString(), currency: feeCurrency }] : [],
    };
  }

  private shouldIncludeFeeForEntry(
    entry: RawTransactionWithMetadata<CoinbaseLedgerEntry>,
    group: RawTransactionWithMetadata<CoinbaseLedgerEntry>[]
  ): boolean {
    if (!entry.normalized.fee || parseDecimal(entry.normalized.fee).isZero()) {
      return false;
    }

    // Use normalized fee for comparison (handles both CCXT fees and extracted commission)
    const entryFeeCost = entry.normalized.fee;
    const entryFeeCurrency = entry.normalized.feeCurrency;

    if (!entryFeeCost) return false;

    // Find all entries in group with identical fee (using normalized data)
    const entriesWithSameFee = group.filter(
      (e) =>
        e.normalized.fee === entryFeeCost &&
        e.normalized.feeCurrency === entryFeeCurrency &&
        e.normalized.fee !== undefined
    );

    // Only include fee on first occurrence
    return entriesWithSameFee.length === 0 || entriesWithSameFee[0]?.normalized.id === entry.normalized.id;
  }
}

export const coinbaseGrossAmounts: InterpretationStrategy<CoinbaseLedgerEntry> = new CoinbaseGrossAmountsStrategy();
