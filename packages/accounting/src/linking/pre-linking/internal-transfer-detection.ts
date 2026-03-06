import type { UniversalTransactionData } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { ok, type Result } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';

import { normalizeTransactionHash } from '../strategies/exact-hash-utils.js';
import type { NewTransactionLink } from '../types.js';

/**
 * Extract the primary movement from a transaction.
 * Prefers outflows, then inflows. Returns undefined if no movements exist.
 */
export function extractPrimaryMovement(tx: UniversalTransactionData) {
  return (tx.movements.outflows ?? [])[0] ?? (tx.movements.inflows ?? [])[0];
}

/**
 * Detect internal blockchain transfers.
 * Links outflow transactions to inflow transactions that share the same blockchain_transaction_hash
 * across different tracked accounts.
 *
 * Only creates links when a hash group contains both outflows and inflows — indicating ADA (or other
 * assets) moved from one tracked wallet to another. Groups with only outflows (e.g., multi-input
 * UTXO sends to an external address) are skipped since no internal transfer occurred.
 *
 * Works for both UTXO chains (Bitcoin etc.) and account-model chains (EVM etc.).
 *
 * Transaction hashes are normalized to handle cross-provider inconsistencies:
 * - Moralis appends log index (e.g., 0xabc-819 for token transfers)
 * - Routescan/Alchemy use base hash only
 */
export function detectInternalBlockchainTransfers(
  transactions: UniversalTransactionData[],
  logger: Logger
): Result<NewTransactionLink[], Error> {
  // Group by normalized blockchain_transaction_hash (strip log index suffix)
  const txHashGroups = new Map<string, UniversalTransactionData[]>();

  for (const tx of transactions) {
    if (tx.sourceType !== 'blockchain') continue;
    if (!tx.blockchain?.name || !tx.blockchain?.transaction_hash) continue;

    const hasMovements = (tx.movements.inflows?.length ?? 0) > 0 || (tx.movements.outflows?.length ?? 0) > 0;
    if (!hasMovements) {
      logger.debug(
        { txId: tx.id, txHash: tx.blockchain.transaction_hash },
        'Skipping transaction with no movements from internal linking'
      );
      continue;
    }

    const normalizedHash = normalizeTransactionHash(tx.blockchain.transaction_hash);
    const group = txHashGroups.get(normalizedHash) ?? [];
    group.push(tx);
    txHashGroups.set(normalizedHash, group);
  }

  const links: NewTransactionLink[] = [];
  const now = new Date();

  for (const [normalizedHash, group] of txHashGroups) {
    if (group.length < 2) continue;

    const accountIds = new Set(group.map((tx) => tx.accountId));
    if (accountIds.size < 2) continue;

    // Separate into outflow and inflow transactions
    const outflowTxs = group.filter((tx) => (tx.movements.outflows?.length ?? 0) > 0);
    const inflowTxs = group.filter(
      (tx) => (tx.movements.inflows?.length ?? 0) > 0 && (tx.movements.outflows?.length ?? 0) === 0
    );

    // No tracked inflows means this is a multi-input external send (e.g., multiple wallets
    // co-signing a UTXO transaction to a validator or exchange). Not an internal transfer.
    if (inflowTxs.length === 0) {
      logger.debug(
        { normalizedHash, outflowCount: outflowTxs.length },
        'Skipping hash group with only outflows — multi-input external send'
      );
      continue;
    }

    // Link each outflow to each inflow (the internal transfer: tracked wallet → tracked wallet)
    for (const outTx of outflowTxs) {
      for (const inTx of inflowTxs) {
        if (outTx.accountId === inTx.accountId) continue;

        const outMovement = extractPrimaryMovement(outTx);
        const inMovement = (inTx.movements.inflows ?? [])[0];

        if (!outMovement || !inMovement || outMovement.assetSymbol !== inMovement.assetSymbol) {
          logger.warn(
            {
              normalizedHash,
              outTxId: outTx.id,
              inTxId: inTx.id,
              outAsset: outMovement?.assetSymbol,
              inAsset: inMovement?.assetSymbol,
            },
            'Skipping internal link - cannot extract matching asset from both transactions'
          );
          continue;
        }

        links.push({
          sourceTransactionId: outTx.id,
          targetTransactionId: inTx.id,
          assetSymbol: outMovement.assetSymbol,
          sourceAmount: outMovement.grossAmount,
          targetAmount: inMovement.grossAmount,
          linkType: 'blockchain_internal',
          confidenceScore: parseDecimal('1.0'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('1.0'),
            timingValid: true,
            timingHours: 0,
            addressMatch: undefined,
          },
          status: 'confirmed',
          reviewedBy: 'auto',
          reviewedAt: now,
          createdAt: now,
          updatedAt: now,
          metadata: {
            blockchainTxHash: normalizedHash,
            blockchain: outTx.blockchain?.name,
          },
        });
      }
    }
  }

  return ok(links);
}
