import { err, ok, type Result } from '../result/index.js';

import type { ResolvedLinkIdentity } from './override.js';

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
