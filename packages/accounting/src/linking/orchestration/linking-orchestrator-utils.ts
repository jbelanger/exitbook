import type { NewTransactionLink, Transaction } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { LinkableMovement } from '../matching/linkable-movement.js';
import { determineLinkType } from '../strategies/amount-timing-utils.js';

import type { OrphanedLinkOverride } from './override-replay.js';

const logger = getLogger('linking-orchestrator-utils');

/**
 * Build a confirmed TransactionLink from an orphaned override.
 *
 * An orphaned override occurs when the user confirmed a link between two
 * transactions, but the algorithm didn't rediscover it during reprocessing.
 *
 * Revalidates the exact source/target movement identity captured in the override.
 * Only materializes when both exact movements are rediscovered.
 */
export function buildLinkFromOrphanedOverride(
  entry: OrphanedLinkOverride,
  linkableMovements: LinkableMovement[],
  txById: Map<number, Transaction>
): Result<NewTransactionLink, Error> {
  const now = new Date();

  const sourceTx = txById.get(entry.sourceTransactionId);
  const targetTx = txById.get(entry.targetTransactionId);

  if (!sourceTx) {
    return err(new Error(`Source tx ${entry.sourceTransactionId} not found for orphaned override`));
  }
  if (!targetTx) {
    return err(new Error(`Target tx ${entry.targetTransactionId} not found for orphaned override`));
  }

  const exactSourceMovement = linkableMovements.find(
    (movement) =>
      movement.transactionId === entry.sourceTransactionId &&
      movement.direction === 'out' &&
      movement.movementFingerprint === entry.sourceMovementFingerprint &&
      movement.assetId === entry.sourceAssetId
  );
  const exactTargetMovement = linkableMovements.find(
    (movement) =>
      movement.transactionId === entry.targetTransactionId &&
      movement.direction === 'in' &&
      movement.movementFingerprint === entry.targetMovementFingerprint &&
      movement.assetId === entry.targetAssetId
  );

  if (!exactSourceMovement) {
    logger.warn(
      {
        overrideId: entry.override.id,
        sourceTransactionId: entry.sourceTransactionId,
        targetTransactionId: entry.targetTransactionId,
        sourceAssetId: entry.sourceAssetId,
        sourceMovementFingerprint: entry.sourceMovementFingerprint,
      },
      'Skipping orphaned override: exact source movement identity no longer resolves'
    );
    return err(new Error('Cannot resolve orphaned override: exact source movement identity no longer resolves'));
  }

  if (!exactTargetMovement) {
    logger.warn(
      {
        overrideId: entry.override.id,
        sourceTransactionId: entry.sourceTransactionId,
        targetTransactionId: entry.targetTransactionId,
        targetAssetId: entry.targetAssetId,
        targetMovementFingerprint: entry.targetMovementFingerprint,
      },
      'Skipping orphaned override: exact target movement identity no longer resolves'
    );
    return err(new Error('Cannot resolve orphaned override: exact target movement identity no longer resolves'));
  }

  // Derive structural link type from source/target transaction sourceType
  // (override's linkType is a user-facing category like 'transfer'/'trade', not the DB link_type)
  const linkType = determineLinkType(sourceTx.sourceType, targetTx.sourceType);

  return ok({
    sourceTransactionId: entry.sourceTransactionId,
    targetTransactionId: entry.targetTransactionId,
    assetSymbol: entry.assetSymbol as Currency,
    sourceAssetId: exactSourceMovement.assetId,
    targetAssetId: exactTargetMovement.assetId,
    sourceAmount: exactSourceMovement.amount,
    targetAmount: exactTargetMovement.amount,
    sourceMovementFingerprint: exactSourceMovement.movementFingerprint,
    targetMovementFingerprint: exactTargetMovement.movementFingerprint,
    linkType,
    confidenceScore: parseDecimal('1'),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('0'),
      timingValid: true,
      timingHours: 0,
    },
    status: 'confirmed',
    reviewedBy: entry.override.actor,
    reviewedAt: new Date(entry.override.created_at),
    createdAt: now,
    updatedAt: now,
    metadata: { overrideId: entry.override.id, overrideLinkType: entry.linkType },
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
