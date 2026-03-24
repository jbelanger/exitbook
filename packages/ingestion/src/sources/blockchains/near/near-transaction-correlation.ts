import {
  type NearBalanceChange,
  type NearBalanceChangeCause,
  type NearStreamEvent,
} from '@exitbook/blockchain-providers/near';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';

import type { NearCorrelatedTransaction, NearReceipt, NearTransactionBundle } from './types.js';

const logger = getLogger('near-transaction-correlation');

const TRANSACTION_LEVEL_CAUSES = new Set<NearBalanceChangeCause>(['TRANSACTION']);
const RECEIPT_LEVEL_CAUSES = new Set<NearBalanceChangeCause>(['RECEIPT', 'TRANSFER']);
const AMBIGUOUS_CAUSES = new Set<NearBalanceChangeCause>([
  'FEE',
  'GAS',
  'GAS_REFUND',
  'CONTRACT_REWARD',
  'MINT',
  'STAKE',
]);

interface DerivedDeltaResult {
  derivedDeltas: Map<string, string>;
  warnings: string[];
}

function parseBlockHeight(blockHeight: string | undefined): number {
  if (!blockHeight) return 0;
  const parsed = parseInt(blockHeight, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function compareBalanceChanges(a: NearBalanceChange, b: NearBalanceChange): number {
  if (a.timestamp !== b.timestamp) {
    return a.timestamp - b.timestamp;
  }
  const heightA = parseBlockHeight(a.blockHeight);
  const heightB = parseBlockHeight(b.blockHeight);
  if (heightA !== heightB) {
    return heightA - heightB;
  }
  const hasReceiptA = a.receiptId !== undefined;
  const hasReceiptB = b.receiptId !== undefined;
  if (hasReceiptA !== hasReceiptB) {
    return hasReceiptA ? -1 : 1;
  }
  const receiptA = a.receiptId ?? '';
  const receiptB = b.receiptId ?? '';
  if (receiptA !== receiptB) {
    return receiptA.localeCompare(receiptB);
  }
  return (a.eventId ?? '').localeCompare(b.eventId ?? '');
}

export function deriveBalanceChangeDeltasFromAbsolutes(
  balanceChanges: NearBalanceChange[],
  previousBalances = new Map<string, string>()
): DerivedDeltaResult {
  const derivedDeltas = new Map<string, string>();
  const warnings: string[] = [];

  const byAccount = new Map<string, NearBalanceChange[]>();
  for (const change of balanceChanges) {
    const existing = byAccount.get(change.affectedAccountId) ?? [];
    existing.push(change);
    byAccount.set(change.affectedAccountId, existing);
  }

  for (const [accountId, changes] of byAccount.entries()) {
    const ordered = [...changes].sort(compareBalanceChanges);

    let previousBalance: Decimal | undefined;
    const seededBalance = previousBalances.get(accountId);
    if (seededBalance !== undefined) {
      try {
        previousBalance = new Decimal(seededBalance);
      } catch {
        warnings.push(`Invalid previous balance for account ${accountId}: ${seededBalance}`);
      }
    }

    for (const change of ordered) {
      const currentBalance = new Decimal(change.absoluteNonstakedAmount);

      if (change.deltaAmountYocto) {
        previousBalance = currentBalance;
        continue;
      }

      if (previousBalance !== undefined) {
        const delta = currentBalance.minus(previousBalance);
        const deltaStr = delta.toFixed();
        derivedDeltas.set(change.eventId, deltaStr);
        previousBalance = currentBalance;
        continue;
      }

      if (change.direction === 'INBOUND' && !currentBalance.isZero()) {
        const deltaStr = currentBalance.toFixed();
        derivedDeltas.set(change.eventId, deltaStr);
        warnings.push(
          `Derived delta for first activity (assumed prior balance 0). ` +
            `Account=${accountId}, Receipt=${change.receiptId ?? 'unknown'}, Amount=${deltaStr}`
        );
        previousBalance = currentBalance;
        continue;
      }

      warnings.push(
        `Unable to derive delta for first activity (missing prior balance). ` +
          `Account=${accountId}, Receipt=${change.receiptId ?? 'unknown'}, Direction=${change.direction}`
      );
      previousBalance = currentBalance;
    }
  }

  return { derivedDeltas, warnings };
}

export function groupNearEventsByTransaction(
  events: NearStreamEvent[]
): Result<Map<string, NearTransactionBundle>, Error> {
  const receiptIdToTxHash = new Map<string, string>();

  for (const event of events) {
    if (event.streamType === 'receipts') {
      const receipt = event;
      const receiptTxHash = receipt.transactionHash;
      if (receipt.receiptId && receiptTxHash) {
        receiptIdToTxHash.set(receipt.receiptId, receiptTxHash);
      }
    }
  }

  const groups = new Map<string, NearTransactionBundle>();
  let skippedBalanceChanges = 0;

  const getOrCreateGroup = (txHash: string): NearTransactionBundle => {
    let group = groups.get(txHash);
    if (!group) {
      group = {
        transaction: undefined,
        receipts: [],
        balanceChanges: [],
        tokenTransfers: [],
      };
      groups.set(txHash, group);
    }
    return group;
  };

  for (const event of events) {
    switch (event.streamType) {
      case 'transactions': {
        const transaction = event;
        const group = getOrCreateGroup(transaction.transactionHash);
        if (group.transaction) {
          return err(new Error(`Duplicate transaction record for hash ${transaction.transactionHash}`));
        }
        group.transaction = transaction;
        break;
      }
      case 'receipts': {
        const receipt = event;
        const group = getOrCreateGroup(receipt.transactionHash);
        group.receipts.push(receipt);
        break;
      }
      case 'balance-changes': {
        const balanceChange = event;
        let txHash = balanceChange.transactionHash;
        if (!txHash && balanceChange.receiptId && receiptIdToTxHash.has(balanceChange.receiptId)) {
          txHash = receiptIdToTxHash.get(balanceChange.receiptId)!;
        }
        if (!txHash) {
          if (balanceChange.receiptId) {
            logger.warn(
              `Skipping balance change - receipt_id not found in receipts map and missing transaction_hash. ` +
                `Receipt: ${balanceChange.receiptId}, Account: ${balanceChange.affectedAccountId}, ` +
                `Block: ${balanceChange.blockHeight}, Delta: ${balanceChange.deltaAmountYocto ?? 'null'}, ` +
                `Cause: ${balanceChange.cause}. THIS DATA WILL BE LOST.`
            );
          } else {
            logger.warn(
              `Skipping orphaned balance change - missing both receipt_id and transaction_hash. ` +
                `Account: ${balanceChange.affectedAccountId}, Block: ${balanceChange.blockHeight}, ` +
                `Delta: ${balanceChange.deltaAmountYocto ?? 'null'}, Cause: ${balanceChange.cause}. ` +
                `THIS DATA WILL BE LOST.`
            );
          }
          skippedBalanceChanges++;
          continue;
        }
        const group = getOrCreateGroup(txHash);
        group.balanceChanges.push(balanceChange);
        break;
      }
      case 'token-transfers': {
        const tokenTransfer = event;
        const group = getOrCreateGroup(tokenTransfer.transactionHash);
        group.tokenTransfers.push(tokenTransfer);
        break;
      }
      default:
        return err(new Error(`Unknown transaction type hint: ${(event as { streamType?: string }).streamType}`));
    }
  }

  if (skippedBalanceChanges > 0) {
    logger.error(
      `CRITICAL: Skipped ${skippedBalanceChanges} balance changes ` +
        `due to missing correlation keys (both receipt_id and transaction_hash missing or invalid). ` +
        `This represents data loss in a financial system. ` +
        `Total raw events: ${events.length}, Successfully grouped: ${events.length - skippedBalanceChanges}`
    );
  }

  return ok(groups);
}

export function validateTransactionGroup(txHash: string, group: NearTransactionBundle): Result<void, Error> {
  if (!group.transaction) {
    return err(new Error(`Missing transaction record for hash ${txHash}`));
  }

  return ok(undefined);
}

export function correlateTransactionData(group: NearTransactionBundle): Result<NearCorrelatedTransaction, Error> {
  if (!group.transaction) {
    return err(new Error('Missing transaction in group'));
  }

  const processedReceipts: NearReceipt[] = group.receipts.map((receipt) => ({
    receiptId: receipt.receiptId,
    transactionHash: receipt.transactionHash,
    predecessorAccountId: receipt.predecessorAccountId,
    receiverAccountId: receipt.receiverAccountId,
    receiptKind: receipt.receiptKind,
    blockHash: receipt.blockHash,
    blockHeight: receipt.blockHeight,
    timestamp: receipt.timestamp,
    executorAccountId: receipt.executorAccountId,
    gasBurnt: receipt.gasBurnt,
    tokensBurntYocto: receipt.tokensBurntYocto,
    status: receipt.status,
    logs: receipt.logs,
    actions: receipt.actions,
    balanceChanges: [],
  }));

  const balanceChangesWithoutDeltas = group.balanceChanges.filter(
    (balanceChange) => !balanceChange.deltaAmountYocto && balanceChange.receiptId
  );

  if (balanceChangesWithoutDeltas.length > 0) {
    const first = balanceChangesWithoutDeltas[0]!;
    return err(
      new Error(
        `Balance change missing deltaAmount for receipt ${first.receiptId} (account ${first.affectedAccountId}). ` +
          `Deltas should have been derived before correlation.`
      )
    );
  }

  const balanceChangesByReceipt = new Map<string, NearBalanceChange[]>();
  const txLevelReceiptId = `tx:${group.transaction.transactionHash}:transaction-level`;
  let hasTransactionLevelItems = false;
  const validReceiptIds = new Set(processedReceipts.map((receipt) => receipt.receiptId));

  for (const balanceChange of group.balanceChanges) {
    let receiptId: string;

    if (TRANSACTION_LEVEL_CAUSES.has(balanceChange.cause)) {
      receiptId = txLevelReceiptId;
      hasTransactionLevelItems = true;

      if (balanceChange.receiptId) {
        logger.debug(
          {
            transactionHash: group.transaction.transactionHash,
            cause: balanceChange.cause,
            receiptId: balanceChange.receiptId,
          },
          'Transaction-level balance change unexpectedly has receipt_id (will use transaction-level receipt)'
        );
      }
    } else if (RECEIPT_LEVEL_CAUSES.has(balanceChange.cause)) {
      if (!balanceChange.receiptId) {
        return err(
          new Error(
            `Balance change with cause '${balanceChange.cause}' missing receipt_id. ` +
              `This indicates data quality issues with the provider. ` +
              `Transaction: ${group.transaction.transactionHash}, ` +
              `Account: ${balanceChange.affectedAccountId}, ` +
              `Delta: ${balanceChange.deltaAmountYocto ?? 'null'}`
          )
        );
      }

      if (!validReceiptIds.has(balanceChange.receiptId)) {
        return err(
          new Error(
            `Balance change with cause '${balanceChange.cause}' has invalid receipt_id '${balanceChange.receiptId}'. ` +
              `Receipt ID does not match any known receipt for this transaction. ` +
              `This indicates incomplete data from the provider or cross-contract receipts not fetched. ` +
              `Transaction: ${group.transaction.transactionHash}, ` +
              `Valid receipt IDs: ${Array.from(validReceiptIds).join(', ')}`
          )
        );
      }

      receiptId = balanceChange.receiptId;
    } else if (AMBIGUOUS_CAUSES.has(balanceChange.cause)) {
      if (balanceChange.receiptId && validReceiptIds.has(balanceChange.receiptId)) {
        receiptId = balanceChange.receiptId;
      } else {
        receiptId = txLevelReceiptId;
        hasTransactionLevelItems = true;
        logger.debug(
          {
            transactionHash: group.transaction.transactionHash,
            cause: balanceChange.cause,
            hasReceiptId: !!balanceChange.receiptId,
            isValidReceiptId: balanceChange.receiptId ? validReceiptIds.has(balanceChange.receiptId) : false,
          },
          'Ambiguous-cause balance change without valid receipt_id (attaching to transaction-level)'
        );
      }
    } else {
      return err(
        new Error(
          `Unknown balance change cause '${balanceChange.cause}' encountered. ` +
            `Transaction: ${group.transaction.transactionHash}, ` +
            `Account: ${balanceChange.affectedAccountId}. ` +
            `This cause must be added to TRANSACTION_LEVEL_CAUSES, RECEIPT_LEVEL_CAUSES, or AMBIGUOUS_CAUSES.`
        )
      );
    }

    const existing = balanceChangesByReceipt.get(receiptId) ?? [];
    existing.push(balanceChange);
    balanceChangesByReceipt.set(receiptId, existing);
  }

  if (hasTransactionLevelItems) {
    const balanceChanges = balanceChangesByReceipt.get(txLevelReceiptId) ?? [];
    const causeBreakdown = new Map<NearBalanceChangeCause, number>();
    for (const balanceChange of balanceChanges) {
      causeBreakdown.set(balanceChange.cause, (causeBreakdown.get(balanceChange.cause) ?? 0) + 1);
    }

    logger.info(
      {
        transactionHash: group.transaction.transactionHash,
        balanceChangesCount: balanceChanges.length,
        causeBreakdown: Object.fromEntries(causeBreakdown),
      },
      'Created transaction-level synthetic receipt for balance changes'
    );

    processedReceipts.push({
      receiptId: txLevelReceiptId,
      transactionHash: group.transaction.transactionHash,
      predecessorAccountId: group.transaction.signerAccountId,
      receiverAccountId: group.transaction.receiverAccountId,
      receiptKind: 'ACTION',
      blockHash: group.transaction.blockHash,
      blockHeight: group.transaction.blockHeight,
      timestamp: group.transaction.timestamp,
      status: group.transaction.status,
      balanceChanges: [],
      isSynthetic: true,
    });
  }

  for (const receipt of processedReceipts) {
    receipt.balanceChanges = balanceChangesByReceipt.get(receipt.receiptId) ?? [];
  }

  return ok({
    transaction: group.transaction,
    receipts: processedReceipts,
    tokenTransfers: group.tokenTransfers,
  });
}
