import { buildExchangeAssetId, parseDecimal } from '@exitbook/core';
import type { RawCoinbaseLedgerEntry } from '@exitbook/exchange-providers';
import { err, ok, type Result } from 'neverthrow';

import type { LedgerEntryWithRaw } from '../shared/strategies/grouping.js';
import type {
  FeeInput,
  InterpretationStrategy,
  LedgerEntryInterpretation,
  MovementInput,
} from '../shared/strategies/interpretation.js';

// ─────────────────────────────────────────────────────────────────────────────
// Coinbase API v2 Amount & Fee Semantics
// ─────────────────────────────────────────────────────────────────────────────
//
// Coinbase API v2 returns one "transaction" object per wallet per event.
// Each transaction has `amount.amount` (signed) and a type-specific nested
// object (`buy`, `sell`, `advanced_trade_fill`, `send`, etc.) with extra detail.
//
// CRITICAL: the meaning of `amount` and `fee` varies by entry type.
// Getting this wrong causes balance miscalculation.
//
// ┌─────────────────────────┬──────────────────────────────────────────────────┐
// │ Entry Type              │ Amount & Fee Semantics                          │
// ├─────────────────────────┼──────────────────────────────────────────────────┤
// │ buy                     │ amount = TOTAL wallet change (fee INCLUDED)     │
// │ (v2 simple buy)         │ buy.total = |amount| = subtotal + fee           │
// │                         │ Fee is informational only — NOT a separate      │
// │                         │ balance deduction. Settlement: on-chain.        │
// │                         │                                                 │
// │ sell                    │ amount = TOTAL wallet change (fee INCLUDED)     │
// │ (v2 simple sell)        │ sell.total = |amount| = subtotal - fee          │
// │                         │ Same as buy: fee is already in the amount.      │
// │                         │ Settlement: on-chain.                           │
// │                         │                                                 │
// │ advanced_trade_fill     │ amount = qty × fill_price (GROSS trade value)   │
// │ (advanced trade)        │ commission is NOT included in amount.           │
// │                         │ The normalizer strips commission entirely       │
// │                         │ (no fee field), so no fee logic needed here.    │
// │                         │ See normalizer comment re: #264.               │
// │                         │                                                 │
// │ fiat_deposit            │ amount = positive, no fee. Pure inflow.         │
// │                         │                                                 │
// │ fiat_withdrawal         │ amount = TOTAL deducted (fee INCLUDED).         │
// │                         │ grossAmount = |amount|, net = gross - fee.      │
// │                         │ Fee settlement: on-chain (carved from gross).   │
// │                         │                                                 │
// │ send                    │ amount = wallet change, fee usually 0           │
// │ (crypto withdrawal)     │ (gasless sends). Treated same as                │
// │                         │ fiat_withdrawal when fee > 0.                   │
// │                         │                                                 │
// │ trade (v2 legacy)       │ amount = wallet change. No fee field in         │
// │                         │ normalized data (spread-based pricing).         │
// │                         │                                                 │
// │ interest, subscription, │ amount = wallet change. No fee.                 │
// │ retail_simple_dust, etc │                                                 │
// └─────────────────────────┴──────────────────────────────────────────────────┘
//
// Balance calculator contract:
//   balance += inflow.grossAmount
//   balance -= outflow.grossAmount
//   balance -= fee.amount  (only when settlement = 'balance')
//   (fees with settlement = 'on-chain' are already in grossAmount, skipped)
//
// Therefore:
//   - buy/sell fees use settlement 'on-chain' → not subtracted again
//   - fiat_withdrawal/send fees use settlement 'on-chain' → carved from gross
//   - advanced_trade_fill has no fee (stripped by normalizer)
//   - all other types: amount is the wallet change, no fee adjustment needed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper function to determine if a fee should be included for a Coinbase entry.
 * Deduplicates fees across correlated entries in the same group.
 *
 * Within a correlated group (e.g., buy/sell pairs), the same fee appears on
 * multiple entries. We only emit it once — on the first entry that carries it.
 */
function shouldIncludeFeeForCoinbaseEntry(
  entry: LedgerEntryWithRaw<RawCoinbaseLedgerEntry>,
  group: LedgerEntryWithRaw<RawCoinbaseLedgerEntry>[]
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

  return entriesWithSameFee[0]?.normalized.id === entry.normalized.id;
}

/**
 * Coinbase API v2 interpretation strategy.
 *
 * See the table above for per-type amount/fee semantics.
 */
export const coinbaseGrossAmounts: InterpretationStrategy<RawCoinbaseLedgerEntry> = {
  interpret(
    entry: LedgerEntryWithRaw<RawCoinbaseLedgerEntry>,
    group: LedgerEntryWithRaw<RawCoinbaseLedgerEntry>[],
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

    // Deduplicate fees across correlated entries in the same group
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

    const entryType = entry.normalized.type;
    const isInflow = amount.isPositive();

    // ── Withdrawals: fiat_withdrawal and send (crypto withdrawal) ──
    // Amount is TOTAL deducted (fee included). Extract net = gross - fee.
    // Fee settlement is 'on-chain' because it's carved from the gross amount,
    // not charged as a separate balance deduction.
    const isWithdrawal = entryType === 'fiat_withdrawal' || entryType === 'send';

    if (isWithdrawal && !isInflow) {
      const netAmount = absAmount.minus(feeCost);
      const outflow: MovementInput = {
        assetId,
        assetSymbol,
        grossAmount: absAmount.toFixed(),
        netAmount: netAmount.toFixed(),
      };
      const fee: FeeInput | undefined =
        shouldIncludeFee && feeAssetId
          ? {
              assetId: feeAssetId,
              assetSymbol: feeCurrency,
              amount: feeCost.toFixed(),
              scope: 'platform',
              settlement: 'on-chain', // Already included in grossAmount
            }
          : undefined;
      return ok({
        inflows: [],
        outflows: [outflow],
        fees: fee ? [fee] : [],
      });
    }

    // ── buy/sell (v2 simple trades): fee is INCLUDED in amount ──
    // For buy:  amount = -(subtotal + fee) → total debit from fiat wallet
    // For sell: amount = +(subtotal - fee) → total credit to fiat wallet
    // The fee is informational (tells us the fee portion) but the amount
    // already reflects the full wallet impact. Using settlement 'on-chain'
    // prevents the balance calculator from subtracting it again.
    const isBuySell = entryType === 'buy' || entryType === 'sell';

    if (isBuySell) {
      const movement: MovementInput = {
        assetId,
        assetSymbol,
        grossAmount: absAmount.toFixed(),
        netAmount: absAmount.toFixed(),
      };
      const fee: FeeInput | undefined =
        shouldIncludeFee && !feeCost.isZero() && feeAssetId
          ? {
              assetId: feeAssetId,
              assetSymbol: feeCurrency,
              amount: feeCost.toFixed(),
              scope: 'platform',
              settlement: 'on-chain', // Fee already embedded in amount
            }
          : undefined;
      return ok({
        inflows: isInflow ? [movement] : [],
        outflows: !isInflow ? [movement] : [],
        fees: fee ? [fee] : [],
      });
    }

    // ── All other types: advanced_trade_fill, fiat_deposit, trade,
    //    interest, subscription, retail_simple_dust, etc. ──
    // Amount = wallet change. No separate fee deduction needed.
    // advanced_trade_fill: normalizer already strips commission (see #264),
    //   so feeCost is always 0 here.
    // trade (v2 legacy): spread-based, no explicit fee in normalized data.
    // fiat_deposit / interest / etc.: pure amount, no fee.
    const movement: MovementInput = {
      assetId,
      assetSymbol,
      grossAmount: absAmount.toFixed(),
      netAmount: absAmount.toFixed(),
    };
    const fee: FeeInput | undefined =
      shouldIncludeFee && !feeCost.isZero() && feeAssetId
        ? {
            assetId: feeAssetId,
            assetSymbol: feeCurrency,
            amount: feeCost.toFixed(),
            scope: 'platform',
            settlement: 'balance',
          }
        : undefined;
    return ok({
      inflows: isInflow ? [movement] : [],
      outflows: !isInflow ? [movement] : [],
      fees: fee ? [fee] : [],
    });
  },
};
