import type { Currency, UniversalTransactionData } from '@exitbook/core';
import { ok, type Result } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';

import type { LinkCandidate } from '../link-candidate.js';
import { normalizeTransactionHash } from '../strategies/exact-hash-utils.js';

import { groupSameHashTransactions } from './group-same-hash-transactions.js';
import { reduceBlockchainGroups } from './reduce-blockchain-groups.js';
import type { LinkCandidateBuildResult } from './types.js';

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

    for (const inflow of tx.movements.inflows ?? []) {
      const amount = inflow.netAmount ?? inflow.grossAmount;
      const grossAmount = inflow.netAmount && !inflow.netAmount.eq(inflow.grossAmount) ? inflow.grossAmount : undefined;

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
          }
        )
      );
    }

    for (const outflow of tx.movements.outflows ?? []) {
      // Apply outflow reduction if one exists for this tx+asset
      const reduction = outflowReductions.get(tx.id)?.get(outflow.assetSymbol);
      const amount = reduction ?? outflow.netAmount ?? outflow.grossAmount;
      const grossAmount =
        outflow.netAmount && !outflow.netAmount.eq(outflow.grossAmount) ? outflow.grossAmount : undefined;

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
          }
        )
      );
    }
  }

  logger.info(
    {
      totalCandidates: candidates.length,
      excludedCount: candidates.filter((candidate) => candidate.excluded).length,
      internalCount: candidates.filter((candidate) => candidate.isInternal).length,
    },
    'Link candidate building completed'
  );

  return ok({ candidates, internalLinks });
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
  flags: { excluded: boolean; isInternal: boolean }
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
  };
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
