import { parseDecimal } from '@exitbook/core';
import type { CoinbaseLedgerEntry } from '@exitbook/exchanges';

import type { RawTransactionWithMetadata } from './grouping.ts';

/**
 * Movement input with amount semantics (used before parsing to Decimal)
 */
export interface MovementInput {
  asset: string;
  grossAmount: string;
  netAmount?: string; // Defaults to grossAmount
}

/**
 * Fee input with semantics (used before parsing to Decimal)
 */
export interface FeeInput {
  amount: string;
  asset: string;
  scope: 'network' | 'platform' | 'spread' | 'tax' | 'other';
  settlement: 'on-chain' | 'balance' | 'external';
}

/**
 * Result of interpreting a single ledger entry.
 * Arrays support multi-leg transactions.
 */
export interface LedgerEntryInterpretation {
  inflows: MovementInput[];
  outflows: MovementInput[];
  fees: FeeInput[];
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
      inflows: amount.isPositive()
        ? [
            {
              asset,
              grossAmount: absAmount.toFixed(),
              netAmount: absAmount.toFixed(), // No on-chain fees, net = gross
            },
          ]
        : [],

      outflows: amount.isNegative()
        ? [
            {
              asset,
              grossAmount: absAmount.toFixed(),
              netAmount: absAmount.toFixed(), // No on-chain fees, net = gross
            },
          ]
        : [],

      fees: feeCost
        ? [
            {
              asset: feeCurrency,
              amount: feeCost.toFixed(),
              scope: 'platform', // Standard exchange fees are platform revenue
              settlement: 'balance', // Charged from separate balance entry
            },
          ]
        : [],
    };
  },
};

/**
 * Helper function to determine if a fee should be included for a Coinbase entry.
 * Deduplicates fees across correlated entries.
 */
function shouldIncludeFeeForCoinbaseEntry(
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
export const coinbaseGrossAmounts: InterpretationStrategy<CoinbaseLedgerEntry> = {
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
    const shouldIncludeFee = shouldIncludeFeeForCoinbaseEntry(entry, group);

    // Use raw data for type detection
    // Withdrawals include: fiat_withdrawal, transaction (crypto sends)
    const isWithdrawal = entry.normalized.type === 'fiat_withdrawal' || entry.normalized.type === 'transaction';

    const isInflow = amount.isPositive();

    if (isWithdrawal && !isInflow) {
      // Withdrawal: amount is GROSS (includes fee), subtract to get net outflow
      const netAmount = absAmount.minus(feeCost);
      return {
        inflows: [],
        outflows: [
          {
            asset,
            grossAmount: absAmount.toFixed(), // Total before fee
            netAmount: netAmount.toFixed(), // After fee deduction
          },
        ],
        fees: shouldIncludeFee
          ? [
              {
                asset: feeCurrency,
                amount: feeCost.toFixed(),
                scope: 'platform',
                settlement: 'on-chain', // Fee is carved out of the transfer before broadcast
              },
            ]
          : [],
      };
    }

    // Trades/deposits
    return {
      inflows: isInflow
        ? [
            {
              asset,
              grossAmount: absAmount.toFixed(),
              netAmount: absAmount.toFixed(), // No on-chain fees
            },
          ]
        : [],
      outflows: !isInflow
        ? [
            {
              asset,
              grossAmount: absAmount.toFixed(),
              netAmount: absAmount.toFixed(), // No on-chain fees
            },
          ]
        : [],
      fees:
        shouldIncludeFee && !feeCost.isZero()
          ? [
              {
                asset: feeCurrency,
                amount: feeCost.toFixed(),
                scope: 'platform',
                settlement: 'balance',
              },
            ]
          : [],
    };
  },
};
