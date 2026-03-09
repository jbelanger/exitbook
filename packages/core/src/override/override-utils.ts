import { err, ok, type Result } from '@exitbook/core';

import type { MovementFingerprintInput, ResolvedLinkIdentity, TransactionFingerprintInput } from './override.js';

/**
 * Compute transaction fingerprint from source, account scope, and externalId.
 * Format: tx:v2:${source}:${accountId}:${externalId}
 *
 * Examples:
 * - tx:v2:bitcoin:8:abc123def456
 * - tx:v2:kraken:1:TRADE-12345
 * - tx:v2:kucoin:4:gen-a1b2c3d4
 */
export function computeTxFingerprint(identity: TransactionFingerprintInput): Result<string, Error> {
  const { source, accountId, externalId } = identity;

  if (!source || source.trim() === '') {
    return err(new Error('source must not be empty'));
  }

  if (!Number.isInteger(accountId) || accountId <= 0) {
    return err(new Error(`accountId must be a positive integer, got ${String(accountId)}`));
  }

  if (!externalId || externalId.trim() === '') {
    return err(new Error('externalId must not be empty'));
  }

  return ok(`tx:v2:${source}:${accountId}:${externalId}`);
}

/**
 * Compute deterministic movement fingerprint from transaction fingerprint + movement type + position.
 * Format: movement:${txFingerprint}:${movementType}:${position}
 *
 * Examples:
 * - movement:tx:v2:kraken:1:WITHDRAWAL-123:outflow:0
 * - movement:tx:v2:blockchain:ethereum:2:0xabc...:inflow:0
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
