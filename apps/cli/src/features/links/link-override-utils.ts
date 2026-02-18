// Shared utility for writing link/unlink override events from CLI handlers.
// Resolves transaction fingerprints and delegates to OverrideStore.

import {
  computeLinkFingerprint,
  computeTxFingerprint,
  type OverrideStore,
  type CreateOverrideEventOptions,
} from '@exitbook/data';
import type { TransactionQueries } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';

const logger = getLogger('LinkOverrideUtils');

/**
 * Write a link_override (confirm) event to the override store.
 * Fetches both transactions to compute fingerprints.
 * Logs warnings on failure but never throws — the DB update already succeeded.
 */
export async function writeLinkOverrideEvent(
  txRepo: TransactionQueries,
  overrideStore: OverrideStore,
  sourceTransactionId: number,
  targetTransactionId: number,
  assetSymbol: string
): Promise<void> {
  const fingerprints = await resolveFingerprints(txRepo, sourceTransactionId, targetTransactionId, assetSymbol);
  if (!fingerprints) return;

  const options: CreateOverrideEventOptions = {
    scope: 'link',
    payload: {
      type: 'link_override',
      action: 'confirm',
      link_type: 'transfer',
      source_fingerprint: fingerprints.sourceFp,
      target_fingerprint: fingerprints.targetFp,
      asset: assetSymbol,
    },
  };

  const appendResult = await overrideStore.append(options);
  if (appendResult.isErr()) {
    logger.warn({ error: appendResult.error }, 'Failed to write link override event');
  }
}

/**
 * Write an unlink_override event to the override store.
 * Fetches both transactions to compute the link fingerprint.
 * Logs warnings on failure but never throws — the DB update already succeeded.
 */
export async function writeUnlinkOverrideEvent(
  txRepo: TransactionQueries,
  overrideStore: OverrideStore,
  sourceTransactionId: number,
  targetTransactionId: number,
  assetSymbol: string
): Promise<void> {
  const fingerprints = await resolveFingerprints(txRepo, sourceTransactionId, targetTransactionId, assetSymbol);
  if (!fingerprints) return;

  const options: CreateOverrideEventOptions = {
    scope: 'unlink',
    payload: {
      type: 'unlink_override',
      link_fingerprint: fingerprints.linkFp,
    },
  };

  const appendResult = await overrideStore.append(options);
  if (appendResult.isErr()) {
    logger.warn({ error: appendResult.error }, 'Failed to write unlink override event');
  }
}

/**
 * Resolve transaction and link fingerprints from transaction IDs.
 * Returns undefined if any step fails (with warnings logged).
 */
async function resolveFingerprints(
  txRepo: TransactionQueries,
  sourceTransactionId: number,
  targetTransactionId: number,
  assetSymbol: string
): Promise<{ linkFp: string; sourceFp: string; targetFp: string } | undefined> {
  try {
    const [sourceResult, targetResult] = await Promise.all([
      txRepo.findById(sourceTransactionId),
      txRepo.findById(targetTransactionId),
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

    const sourceFp = computeTxFingerprint({ source_name: sourceTx.source, external_id: sourceTx.externalId });
    const targetFp = computeTxFingerprint({ source_name: targetTx.source, external_id: targetTx.externalId });

    if (sourceFp.isErr() || targetFp.isErr()) {
      logger.warn('Failed to compute fingerprints for override event');
      return undefined;
    }

    const linkFpResult = computeLinkFingerprint({
      source_tx: sourceFp.value,
      target_tx: targetFp.value,
      asset: assetSymbol,
    });

    if (linkFpResult.isErr()) {
      logger.warn('Failed to compute link fingerprint for override event');
      return undefined;
    }

    return { sourceFp: sourceFp.value, targetFp: targetFp.value, linkFp: linkFpResult.value };
  } catch (error) {
    logger.warn({ error }, 'Unexpected error resolving fingerprints for override event');
    return undefined;
  }
}
