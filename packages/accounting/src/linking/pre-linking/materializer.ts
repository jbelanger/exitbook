import type { Currency, UniversalTransactionData } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import { ok, type Result } from 'neverthrow';

import { normalizeTransactionHash } from '../strategies/exact-hash-utils.js';
import type { OutflowGrouping } from '../types.js';

import { detectInternalBlockchainTransfers } from './internal-transfer-detection.js';
import type { MaterializationResult, NewLinkableMovement } from './types.js';
import { buildInternalOutflowAdjustments } from './utxo-adjustment.js';

/**
 * Materialize linkable movements from raw transactions.
 *
 * This is the pre-linking phase that:
 * 1. Detects internal blockchain transfers → produces confirmed links
 * 2. Applies UTXO outflow adjustments (change subtraction, multi-input summing)
 * 3. Creates LinkableMovement rows with trade exclusion, hash normalization, etc.
 */
export function materializeLinkableMovements(
  transactions: UniversalTransactionData[],
  logger: Logger
): Result<MaterializationResult, Error> {
  logger.info({ transactionCount: transactions.length }, 'Starting movement materialization');

  // 1. Detect internal blockchain transfers
  const internalLinksResult = detectInternalBlockchainTransfers(transactions, logger);
  if (internalLinksResult.isErr()) {
    logger.warn({ error: internalLinksResult.error.message }, 'Failed to detect internal transfers');
  }
  const internalLinks = internalLinksResult.isOk() ? internalLinksResult.value : [];

  if (internalLinks.length > 0) {
    logger.info({ internalLinkCount: internalLinks.length }, 'Detected internal blockchain transfers');
  }

  // 2. Build UTXO adjustments
  const { adjustments, outflowGroupings } = buildInternalOutflowAdjustments(transactions, internalLinks, logger);

  if (adjustments.size > 0) {
    logger.info({ adjustmentCount: adjustments.size }, 'Computed internal change adjustments for blockchain outflows');
  }

  // 3. Build internal transaction ID sets for marking isInternal
  const internalTxIds = new Set<number>();
  for (const link of internalLinks) {
    internalTxIds.add(link.sourceTransactionId);
    internalTxIds.add(link.targetTransactionId);
  }

  // 4. Materialize movements
  const movements: NewLinkableMovement[] = [];

  for (const tx of transactions) {
    const excluded = isStructuralTrade(tx);
    const isInternal = internalTxIds.has(tx.id);
    const normalizedHash = tx.blockchain?.transaction_hash
      ? normalizeTransactionHash(tx.blockchain.transaction_hash)
      : undefined;

    // Create movements for inflows
    for (const inflow of tx.movements.inflows ?? []) {
      const amount = inflow.netAmount ?? inflow.grossAmount;
      const grossAmount = inflow.netAmount && !inflow.netAmount.eq(inflow.grossAmount) ? inflow.grossAmount : undefined;

      movements.push(
        createMovement(tx, 'in', inflow.assetId, inflow.assetSymbol, amount, grossAmount, normalizedHash, {
          excluded,
          isInternal,
        })
      );
    }

    // Create movements for outflows
    for (const outflow of tx.movements.outflows ?? []) {
      // Skip non-representative members of UTXO outflow groups
      if (isNonRepresentativeGroupMember(tx.id, outflow.assetSymbol, outflowGroupings)) {
        continue;
      }

      const amount = adjustments.get(tx.id)?.get(outflow.assetSymbol) ?? outflow.netAmount ?? outflow.grossAmount;
      const grossAmount =
        outflow.netAmount && !outflow.netAmount.eq(outflow.grossAmount) ? outflow.grossAmount : undefined;

      // Determine UTXO group ID if this is a representative
      const utxoGroupId = findUtxoGroupId(tx.id, outflow.assetSymbol, outflowGroupings);

      movements.push(
        createMovement(tx, 'out', outflow.assetId, outflow.assetSymbol, amount, grossAmount, normalizedHash, {
          excluded,
          isInternal,
          utxoGroupId,
        })
      );
    }
  }

  logger.info(
    {
      totalMovements: movements.length,
      excludedCount: movements.filter((m) => m.excluded).length,
      internalCount: movements.filter((m) => m.isInternal).length,
    },
    'Movement materialization completed'
  );

  return ok({ movements, internalLinks });
}

function createMovement(
  tx: UniversalTransactionData,
  direction: 'in' | 'out',
  assetId: string,
  assetSymbol: Currency,
  amount: Decimal,
  grossAmount: Decimal | undefined,
  normalizedHash: string | undefined,
  flags: { excluded: boolean; isInternal: boolean; utxoGroupId?: string | undefined }
): NewLinkableMovement {
  return {
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
    utxoGroupId: flags.utxoGroupId,
    excluded: flags.excluded,
  };
}

function isNonRepresentativeGroupMember(
  txId: number,
  assetSymbol: string,
  outflowGroupings: OutflowGrouping[]
): boolean {
  for (const grouping of outflowGroupings) {
    if (grouping.assetSymbol === assetSymbol && grouping.groupMemberIds.has(txId)) {
      return txId !== grouping.representativeTxId;
    }
  }
  return false;
}

function findUtxoGroupId(txId: number, assetSymbol: string, outflowGroupings: OutflowGrouping[]): string | undefined {
  for (const grouping of outflowGroupings) {
    if (grouping.assetSymbol === assetSymbol && grouping.representativeTxId === txId) {
      return `utxo:${Array.from(grouping.groupMemberIds).sort().join(',')}`;
    }
  }
  return undefined;
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
