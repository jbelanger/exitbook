import { err, ok, type Result } from 'neverthrow';

import type { TransactionIdentity, LinkIdentity } from './override.types.js';

/**
 * Compute transaction fingerprint from source_name and external_id
 * Format: ${source_name}:${external_id}
 *
 * Examples:
 * - blockchain:bitcoin:abc123def456
 * - kraken:TRADE-12345
 * - kucoin:gen-a1b2c3d4
 */
export function computeTxFingerprint(identity: TransactionIdentity): Result<string, Error> {
  const { source_name, external_id } = identity;

  if (!source_name || source_name.trim() === '') {
    return err(new Error('source_name must not be empty'));
  }

  if (!external_id || external_id.trim() === '') {
    return err(new Error('external_id must not be empty'));
  }

  return ok(`${source_name}:${external_id}`);
}

/**
 * Compute link fingerprint from two transaction fingerprints and asset
 * Format: link:${sorted_fp1}:${sorted_fp2}:${asset}
 *
 * Fingerprints are sorted for deterministic ordering (A->B and B->A produce same fingerprint)
 */
export function computeLinkFingerprint(identity: LinkIdentity): Result<string, Error> {
  const { source_tx, target_tx, asset } = identity;

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
