import type { Transaction } from '@exitbook/core';
import { parseDecimal } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

import { normalizeTransactionHash } from '../strategies/exact-hash-utils.js';

/**
 * A single transaction's participation in a same-hash asset group.
 */
export interface SameHashParticipant {
  txId: number;
  accountId: number;
  assetId: string;
  assetSymbol: string;
  inflowGrossAmount: Decimal;
  inflowMovementCount: number;
  outflowGrossAmount: Decimal;
  outflowMovementCount: number;
  onChainFeeAmount: Decimal;
  fromAddress?: string | undefined;
  toAddress?: string | undefined;
}

/**
 * All transactions sharing a normalized hash for a specific asset.
 */
export interface SameHashAssetGroup {
  normalizedHash: string;
  blockchain: string;
  assetId: string;
  assetSymbol: string;
  participants: SameHashParticipant[];
}

/**
 * Group blockchain transactions by normalized hash, then by asset.
 *
 * Only includes groups with 2+ participants from different accounts.
 * Non-blockchain transactions and transactions without hashes are skipped.
 */
export function groupSameHashTransactions(transactions: Transaction[]): SameHashAssetGroup[] {
  // First pass: group transactions by normalized hash
  const txsByHash = new Map<string, { blockchain: string; txs: Transaction[] }>();

  for (const tx of transactions) {
    if (tx.platformKind !== 'blockchain') continue;
    if (!tx.blockchain?.name || !tx.blockchain?.transaction_hash) continue;

    const hasMovements = (tx.movements.inflows?.length ?? 0) > 0 || (tx.movements.outflows?.length ?? 0) > 0;
    if (!hasMovements) continue;

    const normalizedHash = normalizeTransactionHash(tx.blockchain.transaction_hash);
    const entry = txsByHash.get(normalizedHash) ?? { blockchain: tx.blockchain.name, txs: [] };
    entry.txs.push(tx);
    txsByHash.set(normalizedHash, entry);
  }

  const groups: SameHashAssetGroup[] = [];

  for (const [normalizedHash, { blockchain, txs }] of txsByHash) {
    if (txs.length < 2) continue;

    const accountIds = new Set(txs.map((tx) => tx.accountId));
    if (accountIds.size < 2) continue;

    // Collect all assets involved across all transactions in this hash group
    const assetMap = new Map<string, { assetId: string; assetSymbol: string }>();
    for (const tx of txs) {
      for (const inflow of tx.movements.inflows ?? []) {
        assetMap.set(inflow.assetId, { assetId: inflow.assetId, assetSymbol: inflow.assetSymbol });
      }
      for (const outflow of tx.movements.outflows ?? []) {
        assetMap.set(outflow.assetId, { assetId: outflow.assetId, assetSymbol: outflow.assetSymbol });
      }
    }

    // Build a group per asset
    for (const { assetId, assetSymbol } of assetMap.values()) {
      const participants: SameHashParticipant[] = [];

      for (const tx of txs) {
        let inflowGrossAmount = parseDecimal('0');
        let outflowGrossAmount = parseDecimal('0');
        let inflowMovementCount = 0;
        let outflowMovementCount = 0;

        for (const inflow of tx.movements.inflows ?? []) {
          if (inflow.assetId !== assetId) continue;
          inflowGrossAmount = inflowGrossAmount.plus(inflow.grossAmount);
          inflowMovementCount++;
        }

        for (const outflow of tx.movements.outflows ?? []) {
          if (outflow.assetId !== assetId) continue;
          outflowGrossAmount = outflowGrossAmount.plus(outflow.grossAmount);
          outflowMovementCount++;
        }

        // Skip transactions that don't participate in this asset
        if (inflowGrossAmount.isZero() && outflowGrossAmount.isZero()) continue;

        let onChainFeeAmount = parseDecimal('0');
        for (const fee of tx.fees ?? []) {
          if (fee.assetId !== assetId) continue;
          if (fee.settlement !== 'on-chain') continue;
          onChainFeeAmount = onChainFeeAmount.plus(fee.amount);
        }

        participants.push({
          txId: tx.id,
          accountId: tx.accountId,
          assetId,
          assetSymbol,
          inflowGrossAmount,
          inflowMovementCount,
          outflowGrossAmount,
          outflowMovementCount,
          onChainFeeAmount,
          fromAddress: tx.from,
          toAddress: tx.to,
        });
      }

      if (participants.length >= 2) {
        const participantAccountIds = new Set(participants.map((p) => p.accountId));
        if (participantAccountIds.size >= 2) {
          groups.push({ normalizedHash, blockchain, assetId, assetSymbol, participants });
        }
      }
    }
  }

  return groups;
}
