import { buildExchangeAssetId, parseDecimal } from '@exitbook/core';
import type { CoinbaseLedgerEntry } from '@exitbook/exchange-providers';
import { err, ok, type Result } from 'neverthrow';

import type { LedgerEntryWithRaw } from './grouping.js';

/**
 * Movement input with amount semantics (used before parsing to Decimal)
 */
export interface MovementInput {
  assetId: string;
  assetSymbol: string;
  grossAmount: string;
  netAmount?: string; // Defaults to grossAmount
}

/**
 * Fee input with semantics (used before parsing to Decimal)
 */
export interface FeeInput {
  assetId: string;
  amount: string;
  assetSymbol: string;
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
    entry: LedgerEntryWithRaw<TRaw>,
    group: LedgerEntryWithRaw<TRaw>[],
    exchangeName: string
  ): Result<LedgerEntryInterpretation, Error>;
}

/**
 * Standard amount semantics (most exchanges like Kraken, KuCoin).
 *
 * - entry.normalized.amount is NET movement (what actually moved)
 * - entry.normalized.fee is SEPARATE deduction
 * - Balance change = amount - fee (for outflows)
 */
export const standardAmounts: InterpretationStrategy = {
  interpret(
    entry: LedgerEntryWithRaw,
    _group: LedgerEntryWithRaw[],
    exchangeName: string
  ): Result<LedgerEntryInterpretation, Error> {
    const amount = parseDecimal(entry.normalized.amount);
    const absAmount = amount.abs();
    const assetSymbol = entry.normalized.assetSymbol;

    // Build assetId for the main asset
    const assetIdResult = buildExchangeAssetId(exchangeName, assetSymbol);
    if (assetIdResult.isErr()) {
      return err(
        new Error(
          `Failed to build assetId for ${assetSymbol} on ${exchangeName} (entry ${entry.normalized.id}): ${assetIdResult.error.message}`
        )
      );
    }
    const assetId = assetIdResult.value;

    const feeCost =
      entry.normalized.fee && !parseDecimal(entry.normalized.fee).isZero()
        ? parseDecimal(entry.normalized.fee)
        : undefined;
    const feeCurrency = entry.normalized.feeCurrency || assetSymbol;

    // Build assetId for fee currency if fee exists
    let feeAssetId: string | undefined;
    if (feeCost) {
      const feeAssetIdResult = buildExchangeAssetId(exchangeName, feeCurrency);
      if (feeAssetIdResult.isErr()) {
        return err(
          new Error(
            `Failed to build fee assetId for ${feeCurrency} on ${exchangeName} (entry ${entry.normalized.id}): ${feeAssetIdResult.error.message}`
          )
        );
      }
      feeAssetId = feeAssetIdResult.value;
    }

    return ok({
      inflows: amount.isPositive()
        ? [
            {
              assetId,
              assetSymbol,
              grossAmount: absAmount.toFixed(),
              netAmount: absAmount.toFixed(), // No on-chain fees, net = gross
            },
          ]
        : [],

      outflows: amount.isNegative()
        ? [
            {
              assetId,
              assetSymbol,
              grossAmount: absAmount.toFixed(),
              netAmount: absAmount.toFixed(), // No on-chain fees, net = gross
            },
          ]
        : [],

      fees:
        feeCost && feeAssetId
          ? [
              {
                assetId: feeAssetId,
                assetSymbol: feeCurrency,
                amount: feeCost.toFixed(),
                scope: 'platform', // Standard exchange fees are platform revenue
                settlement: 'balance', // Charged from separate balance entry
              },
            ]
          : [],
    });
  },
};

/**
 * Helper function to determine if a fee should be included for a Coinbase entry.
 * Deduplicates fees across correlated entries.
 */
function shouldIncludeFeeForCoinbaseEntry(
  entry: LedgerEntryWithRaw<CoinbaseLedgerEntry>,
  group: LedgerEntryWithRaw<CoinbaseLedgerEntry>[]
): boolean {
  const entryFee = entry.normalized.fee;
  if (!entryFee || parseDecimal(entryFee).isZero()) {
    return false;
  }

  const entryFeeCurrency = entry.normalized.feeCurrency;

  // Find all entries in group with identical fee (using normalized data)
  // Only include fee on first occurrence to avoid duplication across correlated entries
  const entriesWithSameFee = group.filter(
    (e) => e.normalized.fee === entryFee && e.normalized.feeCurrency === entryFeeCurrency
  );

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
    entry: LedgerEntryWithRaw<CoinbaseLedgerEntry>,
    group: LedgerEntryWithRaw<CoinbaseLedgerEntry>[],
    exchangeName: string
  ): Result<LedgerEntryInterpretation, Error> {
    const amount = parseDecimal(entry.normalized.amount);
    const absAmount = amount.abs();
    const assetSymbol = entry.normalized.assetSymbol;
    const feeCost = entry.normalized.fee ? parseDecimal(entry.normalized.fee) : parseDecimal('0');
    const feeCurrency = entry.normalized.feeCurrency || assetSymbol;

    // Build assetId for the main asset
    const assetIdResult = buildExchangeAssetId(exchangeName, assetSymbol);
    if (assetIdResult.isErr()) {
      return err(
        new Error(
          `Failed to build assetId for ${assetSymbol} on ${exchangeName} (entry ${entry.normalized.id}): ${assetIdResult.error.message}`
        )
      );
    }
    const assetId = assetIdResult.value;

    // Deduplicate fees across group using RAW fee data (more accurate than parsed strings)
    const shouldIncludeFee = shouldIncludeFeeForCoinbaseEntry(entry, group);

    // Build assetId for fee currency if fee exists
    let feeAssetId: string | undefined;
    if (shouldIncludeFee && !feeCost.isZero()) {
      const feeAssetIdResult = buildExchangeAssetId(exchangeName, feeCurrency);
      if (feeAssetIdResult.isErr()) {
        return err(
          new Error(
            `Failed to build fee assetId for ${feeCurrency} on ${exchangeName} (entry ${entry.normalized.id}): ${feeAssetIdResult.error.message}`
          )
        );
      }
      feeAssetId = feeAssetIdResult.value;
    }

    // Use raw data for type detection
    // Withdrawals include: fiat_withdrawal, transaction (crypto sends)
    const isWithdrawal = entry.normalized.type === 'fiat_withdrawal' || entry.normalized.type === 'transaction';

    const isInflow = amount.isPositive();

    if (isWithdrawal && !isInflow) {
      // Withdrawal: amount is GROSS (includes fee), subtract to get net outflow
      const netAmount = absAmount.minus(feeCost);
      return ok({
        inflows: [],
        outflows: [
          {
            assetId,
            assetSymbol,
            grossAmount: absAmount.toFixed(), // Total before fee
            netAmount: netAmount.toFixed(), // After fee deduction
          },
        ],
        fees:
          shouldIncludeFee && feeAssetId
            ? [
                {
                  assetId: feeAssetId,
                  assetSymbol: feeCurrency,
                  amount: feeCost.toFixed(),
                  scope: 'platform',
                  settlement: 'on-chain', // Fee is carved out of the transfer before broadcast
                },
              ]
            : [],
      });
    }

    // Trades/deposits
    return ok({
      inflows: isInflow
        ? [
            {
              assetId,
              assetSymbol,
              grossAmount: absAmount.toFixed(),
              netAmount: absAmount.toFixed(), // No on-chain fees
            },
          ]
        : [],
      outflows: !isInflow
        ? [
            {
              assetId,
              assetSymbol,
              grossAmount: absAmount.toFixed(),
              netAmount: absAmount.toFixed(), // No on-chain fees
            },
          ]
        : [],
      fees:
        shouldIncludeFee && !feeCost.isZero() && feeAssetId
          ? [
              {
                assetId: feeAssetId,
                assetSymbol: feeCurrency,
                amount: feeCost.toFixed(),
                scope: 'platform',
                settlement: 'balance',
              },
            ]
          : [],
    });
  },
};
