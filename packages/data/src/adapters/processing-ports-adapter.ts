import { resultDoAsync } from '@exitbook/core';
import type { ProcessingPorts } from '@exitbook/ingestion/ports';

import type { DataContext } from '../data-context.js';
import { computeAccountHash } from '../utils/account-hash.js';

import { markDownstreamProjectionsStale } from './projection-invalidation-utils.js';

/**
 * Bridges DataContext repositories to ingestion's ProcessingPorts.
 * This is the only place where the concrete data layer meets the ingestion hexagon's ports.
 */
export function buildProcessingPorts(
  db: DataContext,
  options: {
    rebuildAssetReviewProjection: () => Promise<import('@exitbook/core').Result<void, Error>>;
  }
): ProcessingPorts {
  return {
    batchSource: {
      findAccountsWithRawData: () => db.rawTransactions.findDistinctAccountIds({}),

      findAccountsWithPendingData: () => db.rawTransactions.findDistinctAccountIds({ processingStatus: 'pending' }),

      countPending: (accountId) => db.rawTransactions.count({ accountIds: [accountId], processingStatus: 'pending' }),

      countPendingByStreamType: (accountId) => db.rawTransactions.countByStreamType(accountId),

      fetchAllPending: (accountId) => db.rawTransactions.findAll({ processingStatus: 'pending', accountId }),

      fetchPendingByTransactionHash: (accountId, hashLimit) => db.rawTransactions.findByHashes(accountId, hashLimit),

      markProcessed: (ids) => db.rawTransactions.markProcessed(ids),
    },

    nearBatchSource: {
      fetchPendingAnchorHashes: (accountId, limit) => db.nearRawData.findPendingAnchorHashes(accountId, limit),

      fetchPendingByHashes: (accountId, hashes) => db.nearRawData.findPendingByHashes(accountId, hashes),

      fetchPendingByReceiptIds: (accountId, receiptIds) =>
        db.nearRawData.findPendingByReceiptIds(accountId, receiptIds),

      findProcessedBalanceChanges: (accountId, affectedAccountIds, beforeTimestamp) =>
        db.nearRawData.findProcessedBalanceChangesByAccounts(accountId, affectedAccountIds, beforeTimestamp),
    },

    transactionSink: {
      saveProcessedBatch: (transactions, accountId) => db.transactions.createBatch(transactions, accountId),
    },

    accountLookup: {
      getAccountInfo: (accountId) => db.accounts.findById(accountId),

      getUserAddresses: (userId, blockchain) =>
        resultDoAsync(async function* () {
          const accounts = yield* await db.accounts.findAll({ userId });
          return accounts.filter((account) => account.sourceName === blockchain).map((account) => account.identifier);
        }),
    },

    importSessionLookup: {
      findLatestSessionPerAccount: (accountIds) =>
        resultDoAsync(async function* () {
          const sessions = yield* await db.importSessions.findAll({ accountIds });

          // Sessions are returned ordered by creation date descending,
          // so the first one per account is the latest.
          const latestByAccount = new Map<number, { accountId: number; status: string }>();
          for (const session of sessions) {
            if (!latestByAccount.has(session.accountId)) {
              latestByAccount.set(session.accountId, {
                accountId: session.accountId,
                status: session.status,
              });
            }
          }

          return [...latestByAccount.values()];
        }),
    },

    markProcessedTransactionsBuilding: () => db.projectionState.markBuilding('processed-transactions'),

    markProcessedTransactionsFresh: (accountIds) =>
      resultDoAsync(async function* () {
        const accountHash = yield* await computeAccountHash(db);
        yield* await db.projectionState.markFresh('processed-transactions', { accountHash });
        yield* await markDownstreamProjectionsStale({
          accountIds,
          db,
          from: 'processed-transactions',
          reason: 'upstream-rebuilt:processed-transactions',
        });
      }),

    markProcessedTransactionsFailed: () => db.projectionState.markFailed('processed-transactions'),

    rebuildAssetReviewProjection: options.rebuildAssetReviewProjection,

    withTransaction: (fn) => db.executeInTransaction((txDb) => fn(buildProcessingPorts(txDb, options))),
  };
}
