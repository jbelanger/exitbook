import type { TransactionMaterializationScope } from '@exitbook/core';
import { err, resultDoAsync } from '@exitbook/foundation';
import type { ProcessingPorts } from '@exitbook/ingestion/ports';

import type { DataSession } from '../data-session.js';
import type { OverrideStore } from '../overrides/override-store.js';
import { materializeStoredTransactionNoteOverrides } from '../overrides/transaction-note-replay.js';
import { markDownstreamProjectionsStale } from '../projections/projection-invalidation.js';
import { computeAccountHash } from '../utils/account-hash.js';

async function materializeProfileScopedTransactionNotes(
  db: DataSession,
  overrideStore: Pick<OverrideStore, 'exists' | 'readByScopes'>,
  scope: TransactionMaterializationScope
): Promise<import('@exitbook/foundation').Result<number, Error>> {
  return resultDoAsync(async function* () {
    const profiles = yield* await db.profiles.list();
    const profileKeyById = new Map(profiles.map((profile) => [profile.id, profile.profileKey]));

    const scopedAccountIdsByProfileKey = new Map<string, number[]>();
    if (scope.accountIds) {
      for (const accountId of scope.accountIds) {
        const account = yield* await db.accounts.findById(accountId);
        if (account?.profileId === undefined) {
          continue;
        }

        const profileKey = profileKeyById.get(account.profileId);
        if (!profileKey) {
          return yield* err(
            new Error(`Profile key not found for account ${accountId} and profile ${String(account.profileId)}`)
          );
        }

        const accountIds = scopedAccountIdsByProfileKey.get(profileKey) ?? [];
        accountIds.push(accountId);
        scopedAccountIdsByProfileKey.set(profileKey, accountIds);
      }
    } else {
      for (const profile of profiles) {
        scopedAccountIdsByProfileKey.set(profile.profileKey, []);
      }
    }

    let updatedCount = 0;
    for (const [profileKey, accountIds] of scopedAccountIdsByProfileKey) {
      const materializeResult = yield* await materializeStoredTransactionNoteOverrides(
        db.transactions,
        overrideStore,
        profileKey,
        {
          ...scope,
          ...(scope.accountIds ? { accountIds } : {}),
        }
      );
      updatedCount += materializeResult;
    }

    return updatedCount;
  });
}

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

      getProfileAddresses: (profileId, blockchain) =>
        resultDoAsync(async function* () {
          const accounts = yield* await db.accounts.findAll({ profileId });
          return accounts.filter((account) => account.platformKey === blockchain).map((account) => account.identifier);
        }),
    },

    transactionNotes: {
      materializeStoredNotes: (scope) =>
        materializeProfileScopedTransactionNotes(db, options.overrideStore, scope ?? {}),
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
