import type { UniversalTransactionData } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';
import { ok, type Result } from 'neverthrow';

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
 * Detect internal blockchain transfers (UTXO model).
 * Links transactions with the same blockchain_transaction_hash across different tracked accounts.
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

    // Create full mesh of links between all pairs from different accounts
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const tx1 = group[i];
        const tx2 = group[j];
        if (!tx1 || !tx2) continue;
        if (tx1.accountId === tx2.accountId) continue;

        const movement1 = extractPrimaryMovement(tx1);
        const movement2 = extractPrimaryMovement(tx2);

        if (!movement1 || !movement2 || movement1.assetSymbol !== movement2.assetSymbol) {
          logger.warn(
            {
              normalizedHash,
              tx1Id: tx1.id,
              tx2Id: tx2.id,
              asset1: movement1?.assetSymbol,
              asset2: movement2?.assetSymbol,
            },
            'Skipping internal link - cannot extract matching asset from both transactions'
          );
          continue;
        }

        links.push({
          sourceTransactionId: tx1.id,
          targetTransactionId: tx2.id,
          assetSymbol: movement1.assetSymbol,
          sourceAmount: movement1.grossAmount,
          targetAmount: movement2.grossAmount,
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
            blockchain: tx1.blockchain?.name,
          },
        });
      }
    }
  }

  return ok(links);
}
