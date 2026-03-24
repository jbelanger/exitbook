// Shared utility for writing link/unlink override events from CLI handlers.
// Resolves transaction fingerprints and delegates to OverrideStore.

import { computeResolvedLinkFingerprint, type CreateOverrideEventOptions, type TransactionLink } from '@exitbook/core';
import type { OverrideStore } from '@exitbook/data/overrides';
import type { Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

const logger = getLogger('LinkOverrideUtils');

interface TransactionFingerprintReader {
  findById(transactionId: number): Promise<Result<{ txFingerprint: string } | undefined, Error>>;
}

/**
 * Write a link_override (confirm) event to the override store.
 * Fetches both transactions to read persisted fingerprints.
 * Logs warnings on failure but never throws — the DB update already succeeded.
 */
export async function writeLinkOverrideEvent(
  txRepo: TransactionFingerprintReader,
  overrideStore: OverrideStore,
  link: TransactionLink
): Promise<void> {
  const fingerprints = await resolveFingerprints(txRepo, link);
  if (!fingerprints) return;

  const options: CreateOverrideEventOptions = {
    scope: 'link',
    payload: {
      type: 'link_override',
      action: 'confirm',
      link_type: 'transfer',
      source_fingerprint: fingerprints.sourceFp,
      target_fingerprint: fingerprints.targetFp,
      asset: link.assetSymbol,
      resolved_link_fingerprint: fingerprints.resolvedLinkFp,
      source_asset_id: link.sourceAssetId,
      target_asset_id: link.targetAssetId,
      source_movement_fingerprint: link.sourceMovementFingerprint,
      target_movement_fingerprint: link.targetMovementFingerprint,
      source_amount: link.sourceAmount.toFixed(),
      target_amount: link.targetAmount.toFixed(),
    },
  };

  const appendResult = await overrideStore.append(options);
  if (appendResult.isErr()) {
    logger.warn({ error: appendResult.error }, 'Failed to write link override event');
  }
}

/**
 * Write an unlink_override event to the override store.
 * Fetches both transactions to read the persisted transaction fingerprints.
 * Logs warnings on failure but never throws — the DB update already succeeded.
 */
export async function writeUnlinkOverrideEvent(
  txRepo: TransactionFingerprintReader,
  overrideStore: OverrideStore,
  link: TransactionLink
): Promise<void> {
  const fingerprints = await resolveFingerprints(txRepo, link);
  if (!fingerprints) return;

  const options: CreateOverrideEventOptions = {
    scope: 'unlink',
    payload: {
      type: 'unlink_override',
      resolved_link_fingerprint: fingerprints.resolvedLinkFp,
    },
  };

  const appendResult = await overrideStore.append(options);
  if (appendResult.isErr()) {
    logger.warn({ error: appendResult.error }, 'Failed to write unlink override event');
  }
}

/**
 * Resolve transaction and exact link fingerprints from transaction IDs.
 * Returns undefined if any step fails (with warnings logged).
 */
async function resolveFingerprints(
  txRepo: TransactionFingerprintReader,
  link: TransactionLink
): Promise<{ resolvedLinkFp: string; sourceFp: string; targetFp: string } | undefined> {
  try {
    const [sourceResult, targetResult] = await Promise.all([
      txRepo.findById(link.sourceTransactionId),
      txRepo.findById(link.targetTransactionId),
    ]);

    if (sourceResult.isErr() || targetResult.isErr()) {
      logger.warn('Failed to fetch transactions for override event');
      return undefined;
    }

    const sourceTx = sourceResult.value;
    const targetTx = targetResult.value;

    if (!sourceTx || !targetTx) {
      logger.warn('Source or target transaction not found for override event');
      return undefined;
    }

    const resolvedLinkFpResult = computeResolvedLinkFingerprint({
      sourceAssetId: link.sourceAssetId,
      targetAssetId: link.targetAssetId,
      sourceMovementFingerprint: link.sourceMovementFingerprint,
      targetMovementFingerprint: link.targetMovementFingerprint,
    });

    if (resolvedLinkFpResult.isErr()) {
      logger.warn('Failed to compute resolved link fingerprint for override event');
      return undefined;
    }

    return {
      sourceFp: sourceTx.txFingerprint,
      targetFp: targetTx.txFingerprint,
      resolvedLinkFp: resolvedLinkFpResult.value,
    };
  } catch (error) {
    logger.warn({ error }, 'Unexpected error resolving fingerprints for override event');
    return undefined;
  }
}
