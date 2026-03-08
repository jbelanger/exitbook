import type { Currency, UniversalTransactionData } from '@exitbook/core';
import { computeMovementFingerprint, computeTxFingerprint, err, ok, type Result } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';

import type { LinkCandidate } from '../link-candidate.js';
import { normalizeTransactionHash } from '../strategies/exact-hash-utils.js';
import type { NewTransactionLink } from '../types.js';

import { groupSameHashTransactions } from './group-same-hash-transactions.js';
import { reduceBlockchainGroups } from './reduce-blockchain-groups.js';
import type { LinkCandidateBuildResult, PendingInternalLink } from './types.js';

/**
 * Build link candidates from raw transactions.
 *
 * This is the pre-linking phase that:
 * 1. Groups same-hash blockchain transactions by asset
 * 2. Reduces groups conservatively → internal links + outflow reductions
 * 3. Creates link candidates with trade exclusion, hash normalization, etc.
 *
 * All candidates are ephemeral — nothing is persisted in this phase.
 */
export function buildLinkCandidates(
  transactions: UniversalTransactionData[],
  logger: Logger
): Result<LinkCandidateBuildResult, Error> {
  logger.info({ transactionCount: transactions.length }, 'Building link candidates');

  // 1. Group same-hash blockchain transactions and reduce conservatively
  const sameHashGroups = groupSameHashTransactions(transactions);
  const { internalLinks, outflowReductions, internalTxIds } = reduceBlockchainGroups(sameHashGroups, logger);

  if (internalLinks.length > 0) {
    logger.info({ internalLinkCount: internalLinks.length }, 'Detected internal blockchain transfers');
  }

  if (outflowReductions.size > 0) {
    logger.info({ adjustmentCount: outflowReductions.size }, 'Computed outflow reductions for internal transfers');
  }

  // 2. Build candidates
  const candidates: LinkCandidate[] = [];
  let nextCandidateId = 1;

  for (const tx of transactions) {
    const excluded = isStructuralTrade(tx);
    const isInternal = internalTxIds.has(tx.id);
    const normalizedHash = tx.blockchain?.transaction_hash
      ? normalizeTransactionHash(tx.blockchain.transaction_hash)
      : undefined;

    // Compute tx fingerprint once per transaction for movement fingerprints
    const txFpResult = computeTxFingerprint({ source: tx.source, externalId: tx.externalId });
    if (txFpResult.isErr()) {
      return err(txFpResult.error);
    }
    const txFingerprint = txFpResult.value;

    const inflows = tx.movements.inflows ?? [];
    for (let inflowIdx = 0; inflowIdx < inflows.length; inflowIdx++) {
      const inflow = inflows[inflowIdx]!;
      const amount = inflow.netAmount ?? inflow.grossAmount;
      const grossAmount = inflow.netAmount && !inflow.netAmount.eq(inflow.grossAmount) ? inflow.grossAmount : undefined;

      const movementFingerprintResult = computeMovementFingerprint({
        txFingerprint,
        movementType: 'inflow',
        position: inflowIdx,
      });
      if (movementFingerprintResult.isErr()) {
        return err(movementFingerprintResult.error);
      }

      candidates.push(
        createCandidate(
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
            position: inflowIdx,
            movementFingerprint: movementFingerprintResult.value,
          }
        )
      );
    }

    const outflows = tx.movements.outflows ?? [];
    for (let outflowIdx = 0; outflowIdx < outflows.length; outflowIdx++) {
      const outflow = outflows[outflowIdx]!;
      // Apply outflow reduction if one exists for this tx+asset
      const reduction = outflowReductions.get(tx.id)?.get(outflow.assetId);
      const amount = reduction ?? outflow.netAmount ?? outflow.grossAmount;
      const grossAmount =
        outflow.netAmount && !outflow.netAmount.eq(outflow.grossAmount) ? outflow.grossAmount : undefined;

      const movementFingerprintResult = computeMovementFingerprint({
        txFingerprint,
        movementType: 'outflow',
        position: outflowIdx,
      });
      if (movementFingerprintResult.isErr()) {
        return err(movementFingerprintResult.error);
      }

      candidates.push(
        createCandidate(
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
            position: outflowIdx,
            movementFingerprint: movementFingerprintResult.value,
          }
        )
      );
    }
  }

  const enrichedInternalLinksResult = attachInternalLinkFingerprints(internalLinks, candidates);
  if (enrichedInternalLinksResult.isErr()) {
    return err(enrichedInternalLinksResult.error);
  }

  logger.info(
    {
      totalCandidates: candidates.length,
      excludedCount: candidates.filter((candidate) => candidate.excluded).length,
      internalCount: candidates.filter((candidate) => candidate.isInternal).length,
    },
    'Link candidate building completed'
  );

  return ok({ candidates, internalLinks: enrichedInternalLinksResult.value });
}

function createCandidate(
  id: number,
  tx: UniversalTransactionData,
  direction: 'in' | 'out',
  assetId: string,
  assetSymbol: Currency,
  amount: Decimal,
  grossAmount: Decimal | undefined,
  normalizedHash: string | undefined,
  flags: { excluded: boolean; isInternal: boolean; movementFingerprint: string; position: number }
): LinkCandidate {
  return {
    id,
    transactionId: tx.id,
    accountId: tx.accountId,
    sourceName: tx.source,
    sourceType: tx.sourceType,
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
    position: flags.position,
    movementFingerprint: flags.movementFingerprint,
  };
}

function attachInternalLinkFingerprints(
  internalLinks: PendingInternalLink[],
  candidates: LinkCandidate[]
): Result<NewTransactionLink[], Error> {
  const enrichedLinks: NewTransactionLink[] = [];

  for (const link of internalLinks) {
    const sourceCandidates = candidates.filter(
      (candidate) =>
        candidate.transactionId === link.sourceTransactionId &&
        candidate.direction === 'out' &&
        candidate.assetId === link.sourceAssetId
    );
    if (sourceCandidates.length !== 1) {
      return err(
        new Error(
          `Expected exactly one source candidate for internal link ${link.sourceTransactionId}->${link.targetTransactionId} ${link.sourceAssetId}, found ${sourceCandidates.length}`
        )
      );
    }

    const targetCandidates = candidates.filter(
      (candidate) =>
        candidate.transactionId === link.targetTransactionId &&
        candidate.direction === 'in' &&
        candidate.assetId === link.targetAssetId
    );
    if (targetCandidates.length !== 1) {
      return err(
        new Error(
          `Expected exactly one target candidate for internal link ${link.sourceTransactionId}->${link.targetTransactionId} ${link.targetAssetId}, found ${targetCandidates.length}`
        )
      );
    }

    enrichedLinks.push({
      ...link,
      sourceMovementFingerprint: sourceCandidates[0]!.movementFingerprint,
      targetMovementFingerprint: targetCandidates[0]!.movementFingerprint,
    });
  }

  return ok(enrichedLinks);
}

/**
 * Detect trades/swaps structurally by movement shape.
 * A transaction with both inflows and outflows in completely disjoint asset sets
 * is a trade (e.g., buy INJ with USDT). These should never produce link candidates.
 *
 * Returns false for:
 * - Pure outflows (withdrawals) or pure inflows (deposits)
 * - Same-asset inflows and outflows (e.g., NEAR storage refunds)
 */
function isStructuralTrade(tx: UniversalTransactionData): boolean {
  const inflows = tx.movements.inflows ?? [];
  const outflows = tx.movements.outflows ?? [];

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
