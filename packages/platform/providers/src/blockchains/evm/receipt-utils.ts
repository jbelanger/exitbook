import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { AlchemyAssetTransfer, AlchemyTransactionReceipt } from './providers/alchemy/alchemy.schemas.ts';

/**
 * Calculates the total gas fee in wei from gas used and effective gas price.
 * Both inputs should be in wei (hex or decimal strings).
 *
 * @param gasUsed - Gas units consumed by the transaction
 * @param effectiveGasPrice - Effective gas price per unit in wei
 * @returns Total fee in wei as a Decimal
 */
export function calculateGasFee(gasUsed: string, effectiveGasPrice: string): Decimal {
  const gasUsedDecimal = parseDecimal(gasUsed);
  const gasPriceDecimal = parseDecimal(effectiveGasPrice);
  return gasUsedDecimal.mul(gasPriceDecimal);
}

/**
 * Calculates gas fee using BigInt for large numbers.
 * Alternative to Decimal-based calculation for consistency with existing code.
 *
 * @param gasUsed - Gas units consumed
 * @param gasPrice - Gas price per unit
 * @returns Total fee as a string
 */
export function calculateGasFeeBigInt(gasUsed: string, gasPrice: string): string {
  const gasUsedBigInt = BigInt(gasUsed);
  const gasPriceBigInt = BigInt(gasPrice);
  return (gasUsedBigInt * gasPriceBigInt).toString();
}

/**
 * Deduplicates an array of transaction hashes.
 *
 * @param txHashes - Array of transaction hashes (may contain duplicates)
 * @returns Array of unique transaction hashes
 */
export function deduplicateTransactionHashes(txHashes: string[]): string[] {
  return [...new Set(txHashes)];
}

/**
 * Merges receipt data (gas fees) into Alchemy asset transfers.
 * Modifies transfers in place by adding _gasUsed, _effectiveGasPrice, and _nativeCurrency fields.
 *
 * @param transfers - Array of Alchemy asset transfers to enrich
 * @param receipts - Map of transaction hash to receipt data
 * @param nativeCurrency - The chain's native currency symbol (e.g., 'ETH', 'MATIC')
 */
export function mergeReceiptsIntoTransfers(
  transfers: AlchemyAssetTransfer[],
  receipts: Map<string, AlchemyTransactionReceipt>,
  nativeCurrency: string
): void {
  for (const transfer of transfers) {
    const receipt = receipts.get(transfer.hash);
    if (receipt) {
      transfer._gasUsed = receipt.gasUsed;
      transfer._effectiveGasPrice = receipt.effectiveGasPrice || '0';
      transfer._nativeCurrency = nativeCurrency;
    }
  }
}
