import { parseDecimal, type Currency, type UniversalTransactionData } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type { LinkCandidate } from './link-candidate.js';
import type { OrphanedLinkOverride } from './override-replay.js';
import { determineLinkType } from './strategies/amount-timing-utils.js';
import type { NewTransactionLink } from './types.js';

const logger = getLogger('linking-orchestrator-utils');

/**
 * Build a confirmed TransactionLink from an orphaned override.
 *
 * An orphaned override occurs when the user confirmed a link between two
 * transactions, but the algorithm didn't rediscover it during reprocessing.
 *
 * Resolves source/target link candidates for the override asset symbol.
 * Only materializes when exactly one source candidate and one target candidate
 * match — ambiguous cases are skipped with a warning.
 */
export function buildLinkFromOrphanedOverride(
  entry: OrphanedLinkOverride,
  candidates: LinkCandidate[],
  txById: Map<number, UniversalTransactionData>
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

  // Resolve orphaned overrides from the same candidate set used by algorithmic matching,
  // so manual links inherit identical amount shaping and movement identity.
  const sourceCandidates = candidates.filter(
    (candidate) =>
      candidate.transactionId === entry.sourceTransactionId &&
      candidate.direction === 'out' &&
      candidate.assetSymbol === entry.assetSymbol
  );
  const targetCandidates = candidates.filter(
    (candidate) =>
      candidate.transactionId === entry.targetTransactionId &&
      candidate.direction === 'in' &&
      candidate.assetSymbol === entry.assetSymbol
  );

  if (sourceCandidates.length !== 1) {
    const reason =
      sourceCandidates.length === 0
        ? `no outflow link candidates for ${entry.assetSymbol}`
        : `${sourceCandidates.length} outflow link candidates for ${entry.assetSymbol} (ambiguous)`;
    logger.warn(
      {
        overrideId: entry.override.id,
        sourceTransactionId: entry.sourceTransactionId,
        targetTransactionId: entry.targetTransactionId,
        asset: entry.assetSymbol,
        outflowCount: sourceCandidates.length,
      },
      `Skipping orphaned override: source tx has ${reason}`
    );
    return err(new Error(`Cannot resolve orphaned override: source tx has ${reason}`));
  }

  if (targetCandidates.length !== 1) {
    const reason =
      targetCandidates.length === 0
        ? `no inflow link candidates for ${entry.assetSymbol}`
        : `${targetCandidates.length} inflow link candidates for ${entry.assetSymbol} (ambiguous)`;
    logger.warn(
      {
        overrideId: entry.override.id,
        sourceTransactionId: entry.sourceTransactionId,
        targetTransactionId: entry.targetTransactionId,
        asset: entry.assetSymbol,
        inflowCount: targetCandidates.length,
      },
      `Skipping orphaned override: target tx has ${reason}`
    );
    return err(new Error(`Cannot resolve orphaned override: target tx has ${reason}`));
  }

  const sourceCandidate = sourceCandidates[0]!;
  const targetCandidate = targetCandidates[0]!;

  // Derive structural link type from source/target transaction sourceType
  // (override's linkType is a user-facing category like 'transfer'/'trade', not the DB link_type)
  const linkType = determineLinkType(sourceTx.sourceType, targetTx.sourceType);

  return ok({
    sourceTransactionId: entry.sourceTransactionId,
    targetTransactionId: entry.targetTransactionId,
    assetSymbol: entry.assetSymbol as Currency,
    sourceAssetId: sourceCandidate.assetId,
    targetAssetId: targetCandidate.assetId,
    sourceAmount: sourceCandidate.amount,
    targetAmount: targetCandidate.amount,
    sourceMovementFingerprint: sourceCandidate.movementFingerprint,
    targetMovementFingerprint: targetCandidate.movementFingerprint,
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
