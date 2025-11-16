import { createHash } from 'node:crypto';

import type { UniversalTransaction } from '@exitbook/core';

/**
 * Creates a deterministic hash for transaction identification when no external ID is available.
 *
 * This function generates a stable, deterministic identifier that will be the same
 * across multiple imports of identical transaction data, enabling proper cross-session
 * deduplication.
 *
 * Hash includes (in stable order):
 * - source (exchange/blockchain name)
 * - timestamp (milliseconds)
 * - operation category and type
 * - all movement amounts and assets (sorted for determinism)
 * - all fee amounts and assets (sorted for determinism)
 * - from/to addresses if present
 *
 * @param transaction - The universal transaction to generate a hash for
 * @returns A deterministic hash string prefixed with 'gen-' to indicate it's generated
 *
 * @example
 * // Same transaction data will always produce the same hash
 * const hash1 = generateDeterministicTransactionHash(tx);
 * const hash2 = generateDeterministicTransactionHash(tx);
 * assert(hash1 === hash2);
 */
export function generateDeterministicTransactionHash(transaction: UniversalTransaction): string {
  // Collect all identifying characteristics in a stable order
  const parts: string[] = [
    transaction.source,
    transaction.timestamp.toString(),
    transaction.operation.category,
    transaction.operation.type,
  ];

  // Add from/to if present
  if (transaction.from) parts.push(`from:${transaction.from}`);
  if (transaction.to) parts.push(`to:${transaction.to}`);

  // Collect all movements with amounts and assets
  const movementParts: string[] = [];

  for (const inflow of transaction.movements.inflows ?? []) {
    const netAmount = inflow.netAmount?.toFixed() ?? inflow.grossAmount.toFixed();
    movementParts.push(`in:${inflow.asset}:${inflow.grossAmount.toFixed()}:${netAmount}`);
  }

  for (const outflow of transaction.movements.outflows ?? []) {
    const netAmount = outflow.netAmount?.toFixed() ?? outflow.grossAmount.toFixed();
    movementParts.push(`out:${outflow.asset}:${outflow.grossAmount.toFixed()}:${netAmount}`);
  }

  // Sort movements for determinism (same movements in different order should produce same hash)
  movementParts.sort();
  parts.push(...movementParts);

  // Collect all fees
  const feeParts: string[] = [];
  for (const fee of transaction.fees ?? []) {
    feeParts.push(`fee:${fee.asset}:${fee.amount.toFixed()}:${fee.scope}:${fee.settlement}`);
  }

  // Sort fees for determinism
  feeParts.sort();
  parts.push(...feeParts);

  // Create hash from all parts
  const dataString = parts.join('|');
  const hash = createHash('sha256').update(dataString).digest('hex');

  // Return full SHA-256 hash with a prefix to indicate it's generated
  // Format: gen-<64-char-hex> (full SHA-256 to eliminate collision risk)
  return `gen-${hash}`;
}
