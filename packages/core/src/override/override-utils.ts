import { err, ok, type Result } from '@exitbook/core';

import type { TransactionFingerprintInput, LinkIdentity, MovementFingerprintInput } from './override.js';

/**
 * Compute transaction fingerprint from source and externalId
 * Format: ${source}:${externalId}
 *
 * Examples:
 * - blockchain:bitcoin:abc123def456
 * - kraken:TRADE-12345
 * - kucoin:gen-a1b2c3d4
 */
export function computeTxFingerprint(identity: TransactionFingerprintInput): Result<string, Error> {
  const { source, externalId } = identity;

  if (!source || source.trim() === '') {
    return err(new Error('source must not be empty'));
  }

  if (!externalId || externalId.trim() === '') {
    return err(new Error('externalId must not be empty'));
  }

  return ok(`${source}:${externalId}`);
}

/**
 * Compute deterministic movement fingerprint from transaction fingerprint + movement type + position.
 * Format: movement:${txFingerprint}:${movementType}:${position}
 *
 * Examples:
 * - movement:kraken:WITHDRAWAL-123:outflow:0
 * - movement:blockchain:ethereum:0xabc...:inflow:0
 */
export function computeMovementFingerprint(input: MovementFingerprintInput): Result<string, Error> {
  const { txFingerprint, movementType, position } = input;

  if (!txFingerprint || txFingerprint.trim() === '') {
    return err(new Error('txFingerprint must not be empty'));
  }

  if (position < 0 || !Number.isInteger(position)) {
    return err(new Error(`position must be a non-negative integer, got ${position}`));
  }

  return ok(`movement:${txFingerprint}:${movementType}:${position}`);
}

/**
 * Compute link fingerprint from two transaction fingerprints and asset
 * Format: link:${sorted_fp1}:${sorted_fp2}:${asset}
 *
 * Fingerprints are sorted for deterministic ordering (A->B and B->A produce same fingerprint)
 */
export function computeLinkFingerprint(identity: LinkIdentity): Result<string, Error> {
  const { sourceTx: source_tx, targetTx: target_tx, asset } = identity;

  if (!source_tx || source_tx.trim() === '') {
    return err(new Error('source_tx must not be empty'));
  }

  if (!target_tx || target_tx.trim() === '') {
    return err(new Error('target_tx must not be empty'));
  }

  if (!asset || asset.trim() === '') {
    return err(new Error('asset must not be empty'));
  }

  // Sort fingerprints for deterministic ordering
  const [fp1, fp2] = [source_tx, target_tx].sort();

  return ok(`link:${fp1}:${fp2}:${asset}`);
}
