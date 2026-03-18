import { createHash } from 'node:crypto';

import { computeTxFingerprint, err, ok, type Result } from '@exitbook/core';
import type { Transaction, TransactionDraft } from '@exitbook/core';
import { computeTxFingerprint as computeCanonicalTxFingerprint } from '@exitbook/core/identity';

/** Transaction data before persistence — `externalId` is optional (will be generated if absent). */
export type TransactionIdentityDraft = Omit<Transaction, 'accountId' | 'id' | 'txFingerprint' | 'externalId'> & {
  externalId?: string | undefined;
};

export interface TransactionIdentity {
  externalId: string;
  source: string;
  txFingerprint: string;
}

export function materializeExternalId(transaction: TransactionIdentityDraft): string {
  return transaction.externalId?.trim() || generateDeterministicTransactionHash(transaction);
}

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
 * @param transaction - The transaction to generate a hash for
 * @returns A deterministic hash string prefixed with 'gen-' to indicate it's generated
 *
 * @example
 * // Same transaction data will always produce the same hash
 * const hash1 = generateDeterministicTransactionHash(tx);
 * const hash2 = generateDeterministicTransactionHash(tx);
 * assert(hash1 === hash2);
 */
export function generateDeterministicTransactionHash(transaction: TransactionIdentityDraft): string {
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
    movementParts.push(`in:${inflow.assetSymbol}:${inflow.grossAmount.toFixed()}:${netAmount}`);
  }

  for (const outflow of transaction.movements.outflows ?? []) {
    const netAmount = outflow.netAmount?.toFixed() ?? outflow.grossAmount.toFixed();
    movementParts.push(`out:${outflow.assetSymbol}:${outflow.grossAmount.toFixed()}:${netAmount}`);
  }

  // Sort movements for determinism (same movements in different order should produce same hash)
  movementParts.sort();
  parts.push(...movementParts);

  // Collect all fees
  const feeParts: string[] = [];
  for (const fee of transaction.fees ?? []) {
    feeParts.push(`fee:${fee.assetSymbol}:${fee.amount.toFixed()}:${fee.scope}:${fee.settlement}`);
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

export function materializeTransactionIdentity(
  transaction: TransactionIdentityDraft,
  accountId: number
): Result<TransactionIdentity, Error> {
  const externalId = materializeExternalId(transaction);
  const txFingerprintResult = computeTxFingerprint({
    source: transaction.source,
    accountId,
    externalId,
  });
  if (txFingerprintResult.isErr()) {
    return err(txFingerprintResult.error);
  }

  return ok({
    externalId,
    source: transaction.source,
    txFingerprint: txFingerprintResult.value,
  });
}

export async function deriveProcessedTransactionFingerprint(
  input: TransactionDraft,
  accountFingerprint: string
): Promise<Result<string, Error>> {
  if (input.sourceType === 'blockchain') {
    return computeCanonicalTxFingerprint({
      accountFingerprint,
      source: input.source,
      sourceType: 'blockchain',
      blockchainTransactionHash: input.blockchain?.transaction_hash,
    });
  }

  return computeCanonicalTxFingerprint({
    accountFingerprint,
    source: input.source,
    sourceType: 'exchange',
    componentEventIds: input.identityMaterial?.componentEventIds,
  });
}
