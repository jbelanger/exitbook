import { parseDecimal, type Currency, type UniversalTransactionData } from '@exitbook/core';
import type { OrphanedLinkOverride } from '@exitbook/data';
import { err, ok, type Result } from 'neverthrow';

import { determineLinkType } from './strategies/amount-timing-utils.js';
import type { NewTransactionLink } from './types.js';

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

  const sourceTx = txById.get(entry.sourceTransactionId);
  const targetTx = txById.get(entry.targetTransactionId);

  if (!sourceTx) {
    return err(new Error(`Source tx ${entry.sourceTransactionId} not found for orphaned override`));
  }
  if (!targetTx) {
    return err(new Error(`Target tx ${entry.targetTransactionId} not found for orphaned override`));
  }

  // Derive structural link type from source/target transaction sourceType
  // (override's linkType is a user-facing category like 'transfer'/'trade', not the DB link_type)
  const linkType = determineLinkType(sourceTx.sourceType, targetTx.sourceType);

  return ok({
    sourceTransactionId: entry.sourceTransactionId,
    targetTransactionId: entry.targetTransactionId,
    assetSymbol: entry.assetSymbol as Currency,
    sourceAmount: zero,
    targetAmount: zero,
    linkType,
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
