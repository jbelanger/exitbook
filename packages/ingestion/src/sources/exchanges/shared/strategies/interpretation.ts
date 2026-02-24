import { buildExchangeAssetId, parseDecimal } from '@exitbook/core';
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
