import { resultDoAsync } from '@exitbook/foundation';
import type { ProcessingPorts } from '@exitbook/ingestion/ports';

import type { DataSession } from '../data-session.js';
import type { OverrideStore } from '../overrides/override-store.js';
import { materializeStoredTransactionNoteOverrides } from '../overrides/transaction-note-replay.js';
import { markDownstreamProjectionsStale } from '../projections/projection-invalidation.js';
import { computeAccountHash } from '../utils/account-hash.js';

/**
 * Bridges DataSession repositories to ingestion's ProcessingPorts.
 * This is the only place where the concrete data layer meets the ingestion hexagon's ports.
 */
export function buildProcessingPorts(
  db: DataSession,
  options: {
    overrideStore: Pick<OverrideStore, 'exists' | 'readByScopes'>;
    rebuildAssetReviewProjection: () => Promise<import('@exitbook/foundation').Result<void, Error>>;
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
      fetchPendingAnchorHashes: (accountId, limit) => db.nearRawTransactions.findPendingAnchorHashes(accountId, limit),

      fetchPendingByHashes: (accountId, hashes) => db.nearRawTransactions.findPendingByHashes(accountId, hashes),

      fetchPendingByReceiptIds: (accountId, receiptIds) =>
        db.nearRawTransactions.findPendingByReceiptIds(accountId, receiptIds),

      findProcessedBalanceChanges: (accountId, affectedAccountIds, beforeTimestamp) =>
        db.nearRawTransactions.findProcessedBalanceChangesByAccounts(accountId, affectedAccountIds, beforeTimestamp),
    },

    transactionSink: {
      saveProcessedBatch: (transactions, accountId) => db.transactions.createBatch(transactions, accountId),
    },

    accountLookup: {
      getAccountInfo: (accountId) => db.accounts.getById(accountId),

      getUserAddresses: (userId, blockchain) =>
        resultDoAsync(async function* () {
          const accounts = yield* await db.accounts.findAll({ userId });
          return accounts.filter((account) => account.sourceName === blockchain).map((account) => account.identifier);
        }),
    },

    transactionNotes: {
      materializeStoredNotes: (scope) =>
        materializeStoredTransactionNoteOverrides(db.transactions, options.overrideStore, scope),
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
