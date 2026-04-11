import { filterTransferEligibleMovements, type NewTransactionLink, type Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import type { Logger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';

import type { LinkableMovement } from '../matching/linkable-movement.js';
import { normalizeTransactionHash } from '../strategies/exact-hash-utils.js';

import { groupSameHashTransactions } from './group-same-hash-transactions.js';
import { reduceBlockchainGroups } from './reduce-blockchain-groups.js';
import type { LinkableMovementBuildResult, PendingInternalLink } from './types.js';

/**
 * Build linkable movements from raw transactions.
 *
 * This is the pre-linking phase that:
 * 1. Groups same-hash blockchain transactions by asset
 * 2. Reduces groups conservatively → internal links + outflow reductions
 * 3. Creates linkable movements with trade exclusion, hash normalization, etc.
 *
 * All linkable movements are ephemeral — nothing is persisted in this phase.
 */
export function buildLinkableMovements(
  transactions: Transaction[],
  logger: Logger
): Result<LinkableMovementBuildResult, Error> {
  logger.info({ transactionCount: transactions.length }, 'Building linkable movements');

  // 1. Group same-hash blockchain transactions and reduce conservatively
  const sameHashGroups = groupSameHashTransactions(transactions);
  const { internalLinks, outflowReductions, internalTxIds } = reduceBlockchainGroups(sameHashGroups, logger);

  if (internalLinks.length > 0) {
    logger.info({ internalLinkCount: internalLinks.length }, 'Detected internal blockchain transfers');
  }

  if (outflowReductions.size > 0) {
    logger.info({ adjustmentCount: outflowReductions.size }, 'Computed outflow reductions for internal transfers');
  }

  // 2. Build linkable movements
  const linkableMovements: LinkableMovement[] = [];
  let nextCandidateId = 1;

  for (const tx of transactions) {
    const excluded = isStructuralTrade(tx);
    const isInternal = internalTxIds.has(tx.id);
    const normalizedHash = tx.blockchain?.transaction_hash
      ? normalizeTransactionHash(tx.blockchain.transaction_hash)
      : undefined;

    const inflows = filterTransferEligibleMovements(tx.movements.inflows);
    for (const inflow of inflows) {
      const amount = inflow.netAmount ?? inflow.grossAmount;
      const grossAmount = inflow.netAmount && !inflow.netAmount.eq(inflow.grossAmount) ? inflow.grossAmount : undefined;

      linkableMovements.push(
        createLinkableMovement(
          nextCandidateId++,
          tx,
          'in',
          inflow.assetId,
          inflow.assetSymbol,
          amount,
          grossAmount,
          normalizedHash,
          {
            excluded,
            isInternal,
            movementFingerprint: inflow.movementFingerprint,
          }
        )
      );
    }

    const outflows = filterTransferEligibleMovements(tx.movements.outflows);
    for (const outflow of outflows) {
      // Apply outflow reduction if one exists for this tx+asset
      const reduction = outflowReductions.get(tx.id)?.get(outflow.assetId);
      const amount = reduction ?? outflow.netAmount ?? outflow.grossAmount;
      const grossAmount =
        outflow.netAmount && !outflow.netAmount.eq(outflow.grossAmount) ? outflow.grossAmount : undefined;

      linkableMovements.push(
        createLinkableMovement(
          nextCandidateId++,
          tx,
          'out',
          outflow.assetId,
          outflow.assetSymbol,
          amount,
          grossAmount,
          normalizedHash,
          {
            excluded,
            isInternal,
            movementFingerprint: outflow.movementFingerprint,
          }
        )
      );
    }
  }

  const enrichedInternalLinksResult = attachInternalLinkFingerprints(internalLinks, linkableMovements);
  if (enrichedInternalLinksResult.isErr()) {
    return err(enrichedInternalLinksResult.error);
  }

  logger.info(
    {
      totalLinkableMovements: linkableMovements.length,
      excludedCount: linkableMovements.filter((movement) => movement.excluded).length,
      internalCount: linkableMovements.filter((movement) => movement.isInternal).length,
    },
    'Linkable movement building completed'
  );

  return ok({ linkableMovements, internalLinks: enrichedInternalLinksResult.value });
}

function createLinkableMovement(
  id: number,
  tx: Transaction,
  direction: 'in' | 'out',
  assetId: string,
  assetSymbol: Currency,
  amount: Decimal,
  grossAmount: Decimal | undefined,
  normalizedHash: string | undefined,
  flags: { excluded: boolean; isInternal: boolean; movementFingerprint: string }
): LinkableMovement {
  return {
    id,
    transactionId: tx.id,
    accountId: tx.accountId,
    platformKey: tx.platformKey,
    platformKind: tx.platformKind,
    assetId,
    assetSymbol,
    direction,
    amount,
    grossAmount,
    timestamp: new Date(tx.datetime),
    blockchainTxHash: normalizedHash,
    fromAddress: tx.from,
    toAddress: tx.to,
    isInternal: flags.isInternal,
    excluded: flags.excluded,
    movementFingerprint: flags.movementFingerprint,
  };
}

function attachInternalLinkFingerprints(
  internalLinks: PendingInternalLink[],
  linkableMovements: LinkableMovement[]
): Result<NewTransactionLink[], Error> {
  const enrichedLinks: NewTransactionLink[] = [];

  for (const link of internalLinks) {
    const sourceMovements = linkableMovements.filter(
      (movement) =>
        movement.transactionId === link.sourceTransactionId &&
        movement.direction === 'out' &&
        movement.assetId === link.sourceAssetId
    );
    if (sourceMovements.length !== 1) {
      return err(
        new Error(
          `Expected exactly one source movement for internal link ${link.sourceTransactionId}->${link.targetTransactionId} ${link.sourceAssetId}, found ${sourceMovements.length}`
        )
      );
    }

    const targetMovements = linkableMovements.filter(
      (movement) =>
        movement.transactionId === link.targetTransactionId &&
        movement.direction === 'in' &&
        movement.assetId === link.targetAssetId
    );
    if (targetMovements.length !== 1) {
      return err(
        new Error(
          `Expected exactly one target movement for internal link ${link.sourceTransactionId}->${link.targetTransactionId} ${link.targetAssetId}, found ${targetMovements.length}`
        )
      );
    }

    enrichedLinks.push({
      ...link,
      sourceMovementFingerprint: sourceMovements[0]!.movementFingerprint,
      targetMovementFingerprint: targetMovements[0]!.movementFingerprint,
    });
  }

  return ok(enrichedLinks);
}

/**
 * Detect trades/swaps structurally by movement shape.
 * A transaction with both inflows and outflows in completely disjoint asset sets
 * is a trade (e.g., buy INJ with USDT). These should never produce linkable movements.
 *
 * Returns false for:
 * - Pure outflows (withdrawals) or pure inflows (deposits)
 * - Same-asset inflows and outflows (e.g., NEAR storage refunds)
 */
function isStructuralTrade(tx: Transaction): boolean {
  const inflows = filterTransferEligibleMovements(tx.movements.inflows);
  const outflows = filterTransferEligibleMovements(tx.movements.outflows);

  if (inflows.length === 0 || outflows.length === 0) {
    return false;
  }

  const inflowAssets = new Set(inflows.map((m) => m.assetSymbol));
  const outflowAssets = new Set(outflows.map((m) => m.assetSymbol));

  for (const asset of inflowAssets) {
    if (outflowAssets.has(asset)) {
      return false;
    }
  }

  return true;
}
