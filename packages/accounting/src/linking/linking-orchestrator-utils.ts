import { parseDecimal, type AssetMovement, type Currency, type UniversalTransactionData } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

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
 * Resolves actual source outflow and target inflow movements for the override
 * asset symbol. Only materializes when exactly one source movement and one
 * target movement match — ambiguous cases are skipped with a warning.
 */
export function buildLinkFromOrphanedOverride(
  entry: OrphanedLinkOverride,
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

  // Resolve eligible source outflow movements for the override asset symbol
  const sourceOutflows = (sourceTx.movements.outflows ?? []).filter((m) => m.assetSymbol === entry.assetSymbol);

  // Resolve eligible target inflow movements for the override asset symbol
  const targetInflows = (targetTx.movements.inflows ?? []).filter((m) => m.assetSymbol === entry.assetSymbol);

  if (sourceOutflows.length !== 1) {
    const reason =
      sourceOutflows.length === 0
        ? `no outflow movements for ${entry.assetSymbol}`
        : `${sourceOutflows.length} outflow movements for ${entry.assetSymbol} (ambiguous)`;
    logger.warn(
      {
        overrideId: entry.override.id,
        sourceTransactionId: entry.sourceTransactionId,
        targetTransactionId: entry.targetTransactionId,
        asset: entry.assetSymbol,
        outflowCount: sourceOutflows.length,
      },
      `Skipping orphaned override: source tx has ${reason}`
    );
    return err(new Error(`Cannot resolve orphaned override: source tx has ${reason}`));
  }

  if (targetInflows.length !== 1) {
    const reason =
      targetInflows.length === 0
        ? `no inflow movements for ${entry.assetSymbol}`
        : `${targetInflows.length} inflow movements for ${entry.assetSymbol} (ambiguous)`;
    logger.warn(
      {
        overrideId: entry.override.id,
        sourceTransactionId: entry.sourceTransactionId,
        targetTransactionId: entry.targetTransactionId,
        asset: entry.assetSymbol,
        inflowCount: targetInflows.length,
      },
      `Skipping orphaned override: target tx has ${reason}`
    );
    return err(new Error(`Cannot resolve orphaned override: target tx has ${reason}`));
  }

  const sourceMovement = sourceOutflows[0] as AssetMovement;
  const targetMovement = targetInflows[0] as AssetMovement;

  const sourceAmount = sourceMovement.netAmount ?? sourceMovement.grossAmount;
  const targetAmount = targetMovement.netAmount ?? targetMovement.grossAmount;

  // Derive structural link type from source/target transaction sourceType
  // (override's linkType is a user-facing category like 'transfer'/'trade', not the DB link_type)
  const linkType = determineLinkType(sourceTx.sourceType, targetTx.sourceType);

  return ok({
    sourceTransactionId: entry.sourceTransactionId,
    targetTransactionId: entry.targetTransactionId,
    assetSymbol: entry.assetSymbol as Currency,
    sourceAssetId: sourceMovement.assetId,
    targetAssetId: targetMovement.assetId,
    sourceAmount,
    targetAmount,
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
