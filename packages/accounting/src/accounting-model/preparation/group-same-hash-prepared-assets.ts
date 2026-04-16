import { filterTransferEligibleMovements, type Transaction } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

import { normalizeTransactionHash } from '../../linking/strategies/exact-hash-utils.js';
import type { PreparedAccountingTransaction } from '../prepared-accounting-types.js';

import type { SameHashPreparedAssetGroup, SameHashPreparedParticipant } from './same-hash-preparation-types.js';

export function groupSameHashTransactionsForPreparation(
  transactions: Transaction[],
  preparedByTxId: Map<number, PreparedAccountingTransaction>
): Result<SameHashPreparedAssetGroup[], Error> {
  const transactionsByHash = new Map<string, { blockchain: string; normalizedHash: string; txs: Transaction[] }>();

  for (const tx of transactions) {
    if (tx.platformKind !== 'blockchain') continue;
    if (!tx.blockchain?.name || !tx.blockchain?.transaction_hash) continue;

    const hasMovements = (tx.movements.inflows?.length ?? 0) > 0 || (tx.movements.outflows?.length ?? 0) > 0;
    if (!hasMovements) continue;

    const normalizedHash = normalizeTransactionHash(tx.blockchain.transaction_hash);
    const bucketKey = buildSameHashBucketKey(tx.blockchain.name, normalizedHash);
    const entry = transactionsByHash.get(bucketKey) ?? {
      blockchain: tx.blockchain.name,
      normalizedHash,
      txs: [],
    };
    entry.txs.push(tx);
    transactionsByHash.set(bucketKey, entry);
  }

  const groups: SameHashPreparedAssetGroup[] = [];

  for (const { normalizedHash, blockchain, txs } of transactionsByHash.values()) {
    if (txs.length < 2) continue;

    const accountIds = new Set(txs.map((tx) => tx.accountId));
    if (accountIds.size < 2) continue;

    const assetMap = new Map<string, { assetId: string; assetSymbol: SameHashPreparedAssetGroup['assetSymbol'] }>();
    for (const tx of txs) {
      for (const inflow of filterTransferEligibleMovements(tx.movements.inflows)) {
        const existing = assetMap.get(inflow.assetId);
        if (existing && existing.assetSymbol !== inflow.assetSymbol) {
          return err(
            new Error(
              `Asset identity collision in same-hash group: assetId ${inflow.assetId} has symbols ` +
                `"${existing.assetSymbol}" and "${inflow.assetSymbol}" in hash ${normalizedHash} (${blockchain})`
            )
          );
        }
        assetMap.set(inflow.assetId, { assetId: inflow.assetId, assetSymbol: inflow.assetSymbol });
      }

      for (const outflow of filterTransferEligibleMovements(tx.movements.outflows)) {
        const existing = assetMap.get(outflow.assetId);
        if (existing && existing.assetSymbol !== outflow.assetSymbol) {
          return err(
            new Error(
              `Asset identity collision in same-hash group: assetId ${outflow.assetId} has symbols ` +
                `"${existing.assetSymbol}" and "${outflow.assetSymbol}" in hash ${normalizedHash} (${blockchain})`
            )
          );
        }
        assetMap.set(outflow.assetId, { assetId: outflow.assetId, assetSymbol: outflow.assetSymbol });
      }
    }

    const symbolToAssetIds = new Map<string, Set<string>>();
    for (const { assetId, assetSymbol } of assetMap.values()) {
      const ids = symbolToAssetIds.get(assetSymbol) ?? new Set<string>();
      ids.add(assetId);
      symbolToAssetIds.set(assetSymbol, ids);
    }

    for (const [symbol, ids] of symbolToAssetIds) {
      if (ids.size > 1) {
        return err(
          new Error(
            `Asset identity collision in same-hash group: symbol "${symbol}" maps to multiple assetIds ` +
              `[${[...ids].join(', ')}] in hash ${normalizedHash} (${blockchain})`
          )
        );
      }
    }

    for (const { assetId, assetSymbol } of assetMap.values()) {
      const participants: SameHashPreparedParticipant[] = [];

      for (const tx of txs) {
        const preparedTransaction = preparedByTxId.get(tx.id);
        if (!preparedTransaction) {
          return err(new Error(`Prepared transaction ${tx.id} not found while grouping same-hash participants`));
        }

        let inflowGrossAmount = new Decimal(0);
        let outflowGrossAmount = new Decimal(0);
        let inflowMovementCount = 0;
        let outflowMovementCount = 0;
        let outflowMovementFingerprint: string | undefined;
        let inflowMovementFingerprint: string | undefined;

        for (const inflow of filterTransferEligibleMovements(preparedTransaction.movements.inflows)) {
          if (inflow.assetId !== assetId) continue;
          inflowGrossAmount = inflowGrossAmount.plus(inflow.grossAmount);
          inflowMovementCount++;
          if (inflowMovementCount === 1) {
            inflowMovementFingerprint = inflow.movementFingerprint;
          } else {
            inflowMovementFingerprint = undefined;
          }
        }

        for (const outflow of filterTransferEligibleMovements(preparedTransaction.movements.outflows)) {
          if (outflow.assetId !== assetId) continue;
          outflowGrossAmount = outflowGrossAmount.plus(outflow.grossAmount);
          outflowMovementCount++;
          if (outflowMovementCount === 1) {
            outflowMovementFingerprint = outflow.movementFingerprint;
          } else {
            outflowMovementFingerprint = undefined;
          }
        }

        if (inflowGrossAmount.isZero() && outflowGrossAmount.isZero()) continue;

        let onChainFeeAmount = new Decimal(0);
        for (const fee of preparedTransaction.fees) {
          if (fee.assetId !== assetId) continue;
          if (fee.settlement !== 'on-chain') continue;
          onChainFeeAmount = onChainFeeAmount.plus(fee.amount);
        }

        participants.push({
          txId: tx.id,
          accountId: tx.accountId,
          assetId,
          inflowGrossAmount,
          inflowMovementCount,
          outflowGrossAmount,
          outflowMovementCount,
          onChainFeeAmount,
          outflowMovementFingerprint,
          inflowMovementFingerprint,
        });
      }

      if (participants.length < 2) continue;
      const participantAccountIds = new Set(participants.map((participant) => participant.accountId));
      if (participantAccountIds.size < 2) continue;

      groups.push({ normalizedHash, blockchain, assetId, assetSymbol, participants });
    }
  }

  return ok(groups);
}

function buildSameHashBucketKey(blockchain: string, normalizedHash: string): string {
  return `${blockchain}:${normalizedHash}`;
}
