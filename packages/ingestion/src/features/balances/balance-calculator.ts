import type { UniversalTransactionData } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

/**
 * Result from balance calculation including balances and asset metadata
 */
export interface BalanceCalculationResult {
  balances: Record<string, Decimal>; // assetId -> balance
  assetMetadata: Record<string, string>; // assetId -> assetSymbol
}

/**
 * Calculate balances for all assets from a set of transactions.
 * Returns balances keyed by assetId and metadata mapping assetId -> assetSymbol for display.
 */
export function calculateBalances(transactions: UniversalTransactionData[]): BalanceCalculationResult {
  const balances: Record<string, Decimal> = {};
  const assetMetadata: Record<string, string> = {};

  for (const transaction of transactions) {
    processTransactionForBalance(transaction, balances, assetMetadata);
  }

  return { balances, assetMetadata };
}

/**
 * Process a single transaction's movements and fees to update balances.
 * Handles inflows, outflows, and fees from the transaction's structured data.
 * Groups balances by assetId (unique identity) rather than assetSymbol (display label).
 * Also tracks assetId -> assetSymbol mapping for display purposes.
 */
function processTransactionForBalance(
  transaction: UniversalTransactionData,
  balances: Record<string, Decimal>,
  assetMetadata: Record<string, string>
): void {
  // Initialize balance for any assets we encounter
  const ensureBalance = (assetId: string, assetSymbol: string) => {
    if (!balances[assetId]) {
      balances[assetId] = parseDecimal('0');
    }
    // Store assetSymbol for display (overwrites with same value if already exists)
    assetMetadata[assetId] = assetSymbol;
  };

  // Process inflows (what user gained)
  // Movements are already deserialized with Decimal amounts
  const inflows = transaction.movements.inflows;
  if (inflows && Array.isArray(inflows) && inflows.length > 0) {
    for (const inflow of inflows) {
      ensureBalance(inflow.assetId, inflow.assetSymbol);
      // Use grossAmount - it represents what the user's balance increased by
      // (netAmount is for transfer matching, not balance calculation)
      const amount = inflow.grossAmount;
      balances[inflow.assetId] = balances[inflow.assetId]!.plus(amount);
    }
  }

  // Process outflows (what user lost)
  // Movements are already deserialized with Decimal amounts
  const outflows = transaction.movements.outflows;
  if (outflows && Array.isArray(outflows) && outflows.length > 0) {
    for (const outflow of outflows) {
      ensureBalance(outflow.assetId, outflow.assetSymbol);
      // Use grossAmount - it represents what the user's balance decreased by
      // For UTXO chains (Bitcoin): grossAmount includes the fee (inputs - change)
      // For account-based chains (Ethereum, Solana, etc.): grossAmount = netAmount, fee deducted separately below
      const amount = outflow.grossAmount;
      balances[outflow.assetId] = balances[outflow.assetId]!.minus(amount);
    }
  }

  // Process fees (always a cost)
  // Fees are now stored as an array
  // IMPORTANT: Only subtract fees with settlement='balance' separately.
  // Fees with settlement='on-chain' are already included in grossAmount for UTXO chains (Bitcoin).
  // Account-based chains (Ethereum, Solana, etc.) use settlement='balance' for gas fees.
  if (transaction.fees && Array.isArray(transaction.fees) && transaction.fees.length > 0) {
    for (const fee of transaction.fees) {
      // Skip on-chain fees - they're already included in grossAmount (UTXO chains only)
      if (fee.settlement === 'on-chain') {
        continue;
      }

      // Subtract balance-settled and external fees separately
      ensureBalance(fee.assetId, fee.assetSymbol);
      balances[fee.assetId] = balances[fee.assetId]!.minus(fee.amount);
    }
  }
}
