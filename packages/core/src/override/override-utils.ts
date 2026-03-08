import { err, ok, type Result } from '@exitbook/core';

import type { MovementFingerprintInput, ResolvedLinkIdentity, TransactionFingerprintInput } from './override.js';

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
 * Compute a fingerprint for an exact persisted link identity.
 * This key is movement-level and asset-id-aware.
 */
export function computeResolvedLinkFingerprint(identity: ResolvedLinkIdentity): Result<string, Error> {
  const { sourceAssetId, sourceMovementFingerprint, targetAssetId, targetMovementFingerprint } = identity;

  if (!sourceAssetId || sourceAssetId.trim() === '') {
    return err(new Error('sourceAssetId must not be empty'));
  }

  if (!targetAssetId || targetAssetId.trim() === '') {
    return err(new Error('targetAssetId must not be empty'));
  }

  if (!sourceMovementFingerprint || sourceMovementFingerprint.trim() === '') {
    return err(new Error('sourceMovementFingerprint must not be empty'));
  }

  if (!targetMovementFingerprint || targetMovementFingerprint.trim() === '') {
    return err(new Error('targetMovementFingerprint must not be empty'));
  }

  return ok(
    `resolved-link:v1:${sourceMovementFingerprint}:${targetMovementFingerprint}:${sourceAssetId}:${targetAssetId}`
  );
}
