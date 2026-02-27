import { parseDecimal, type Currency, type UniversalTransactionData } from '@exitbook/core';
import type { OrphanedLinkOverride } from '@exitbook/data';
import { err, ok, type Result } from 'neverthrow';

import type { NewTransactionLink } from './types.js';

/**
 * Resolve a unique assetId for an asset symbol within a transaction.
 * Returns an error if there are no matching movements or multiple assetIds.
 */
export function resolveUniqueAssetId(
  tx: UniversalTransactionData | undefined,
  transactionId: number,
  assetSymbol: string,
  movementPriority: ('inflows' | 'outflows')[]
): Result<string, Error> {
  if (!tx) {
    return err(new Error(`tx ${transactionId} not found`));
  }

  const candidates: string[] = [];
  for (const direction of movementPriority) {
    for (const movement of tx.movements[direction] ?? []) {
      if (movement.assetSymbol === assetSymbol) {
        candidates.push(movement.assetId);
      }
    }
  }

  const unique = [...new Set(candidates)];
  if (unique.length === 0) {
    return err(new Error(`tx ${transactionId} has no ${assetSymbol} movements`));
  }
  if (unique.length > 1) {
    return err(new Error(`tx ${transactionId} has ambiguous ${assetSymbol} assetIds: ${unique.join(', ')}`));
  }

  return ok(unique[0]!);
}

/**
 * Build a confirmed TransactionLink from an orphaned override.
 *
 * An orphaned override occurs when the user confirmed a link between two
 * transactions, but the algorithm didn't rediscover it during reprocessing.
 * Sentinel values (zero amounts, 1.0 confidence) indicate this is user-created.
 */
export function buildLinkFromOrphanedOverride(
  entry: OrphanedLinkOverride,
  txById: Map<number, UniversalTransactionData>
): Result<NewTransactionLink, Error> {
  const now = new Date();
  const zero = parseDecimal('0');

  const sourceAssetIdResult = resolveUniqueAssetId(
    txById.get(entry.sourceTransactionId),
    entry.sourceTransactionId,
    entry.assetSymbol,
    ['outflows', 'inflows']
  );
  const targetAssetIdResult = resolveUniqueAssetId(
    txById.get(entry.targetTransactionId),
    entry.targetTransactionId,
    entry.assetSymbol,
    ['inflows', 'outflows']
  );

  if (sourceAssetIdResult.isErr() || targetAssetIdResult.isErr()) {
    const sourceCtx = sourceAssetIdResult.isOk() ? sourceAssetIdResult.value : sourceAssetIdResult.error.message;
    const targetCtx = targetAssetIdResult.isOk() ? targetAssetIdResult.value : targetAssetIdResult.error.message;
    return err(new Error(`Cannot resolve assetId for ${entry.assetSymbol}: source=${sourceCtx}, target=${targetCtx}.`));
  }

  return ok({
    sourceTransactionId: entry.sourceTransactionId,
    targetTransactionId: entry.targetTransactionId,
    assetSymbol: entry.assetSymbol as Currency,
    sourceAssetId: sourceAssetIdResult.value,
    targetAssetId: targetAssetIdResult.value,
    sourceAmount: zero,
    targetAmount: zero,
    linkType: entry.linkType as NewTransactionLink['linkType'],
    confidenceScore: parseDecimal('1'),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: zero,
      timingValid: true,
      timingHours: 0,
    },
    status: 'confirmed',
    reviewedBy: entry.override.actor,
    reviewedAt: new Date(entry.override.created_at),
    createdAt: now,
    updatedAt: now,
    metadata: { overrideId: entry.override.id },
  });
}

/** Count links by category after override replay. */
export function categorizeFinalLinks(links: NewTransactionLink[]) {
  let internalCount = 0;
  let confirmedCount = 0;
  let suggestedCount = 0;

  for (const link of links) {
    if (link.linkType === 'blockchain_internal') {
      internalCount++;
    } else if (link.status === 'confirmed') {
      confirmedCount++;
    } else if (link.status === 'suggested') {
      suggestedCount++;
    }
  }

  return { internalCount, confirmedCount, suggestedCount };
}
