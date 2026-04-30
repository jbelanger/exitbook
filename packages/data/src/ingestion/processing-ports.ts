import type { ImportSessionStatus, TransactionMaterializationScope } from '@exitbook/core';
import { err, resultDoAsync } from '@exitbook/foundation';
import type { ProcessingPorts } from '@exitbook/ingestion/ports';

import type { DataSession } from '../data-session.js';
import { materializeStoredLedgerLinkingAssetIdentityAssertions } from '../overrides/ledger-linking-asset-identity-replay.js';
import type { OverrideStore } from '../overrides/override-store.js';
import { materializeStoredTransactionOverrides } from '../overrides/transaction-override-materialization.js';
import { buildProfileProjectionScopeKey, resolveAffectedProfileIds } from '../projections/profile-scope-key.js';
import { markDownstreamProjectionsStale } from '../projections/projection-invalidation.js';
import { computeScopedAccountHash } from '../utils/account-hash.js';

async function materializeProfileScopedTransactionOverrides(
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
        if (!account) {
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
      const scopedScope = {
        ...scope,
        ...(scope.accountIds ? { accountIds } : {}),
      };

      const materializeOverridesResult = yield* await materializeStoredTransactionOverrides(
        db.transactions,
        overrideStore,
        profileKey,
        scopedScope
      );
      updatedCount += materializeOverridesResult;
    }

    return updatedCount;
  });
}

async function materializeProfileScopedLedgerLinkingAssetIdentityOverrides(
  db: DataSession,
  overrideStore: Pick<OverrideStore, 'exists' | 'readByScopes'>,
  scope: { accountIds?: readonly number[] | undefined }
): Promise<import('@exitbook/foundation').Result<number, Error>> {
  return resultDoAsync(async function* () {
    const profiles = yield* await db.profiles.list();
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const profileIds = new Set<number>();

    if (scope.accountIds) {
      for (const accountId of scope.accountIds) {
        const account = yield* await db.accounts.findById(accountId);
        if (!account) {
          continue;
        }

        if (!profileById.has(account.profileId)) {
          return yield* err(
            new Error(`Profile key not found for account ${accountId} and profile ${String(account.profileId)}`)
          );
        }

        profileIds.add(account.profileId);
      }
    } else {
      for (const profile of profiles) {
        profileIds.add(profile.id);
      }
    }

    let materializedCount = 0;
    for (const profileId of [...profileIds].sort((left, right) => left - right)) {
      const profile = profileById.get(profileId);
      if (!profile) {
        return yield* err(new Error(`Profile not found for ledger-linking override replay: ${profileId}`));
      }

      const materializeResult = yield* await materializeStoredLedgerLinkingAssetIdentityAssertions(
        db.accountingLedger,
        overrideStore,
        profile.id,
        profile.profileKey
      );
      materializedCount += materializeResult.savedCount;
    }

    return materializedCount;
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
    rebuildAssetReviewProjection: (accountIds: number[]) => Promise<import('@exitbook/foundation').Result<void, Error>>;
    rebuildTransactionInterpretation: (
      accountIds: number[]
    ) => Promise<import('@exitbook/foundation').Result<void, Error>>;
  }
): ProcessingPorts {
  return {
    batchSource: {
      findAccountsWithRawData: (profileId) => db.rawTransactions.findDistinctAccountIds({ profileId }),

      findAccountsWithPendingData: (profileId) =>
        db.rawTransactions.findDistinctAccountIds({ profileId, processingStatus: 'pending' }),

      countPending: (accountId) => db.rawTransactions.count({ accountIds: [accountId], processingStatus: 'pending' }),

      countPendingByStreamType: (accountId) => db.rawTransactions.countByStreamType(accountId),

      fetchAllPending: (accountId) => db.rawTransactions.findAll({ processingStatus: 'pending', accountId }),

      fetchPendingByTransactionHash: (accountId, hashLimit) => db.rawTransactions.findByHashes(accountId, hashLimit),

      fetchByTransactionHashesForAccounts: (accountIds, transactionHashes) =>
        db.rawTransactions.findByAccountIdsAndHashes(accountIds, transactionHashes),

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

    accountingLedgerSink: {
      replaceSourceActivities: (writes) =>
        resultDoAsync(async function* () {
          const summary = {
            diagnostics: 0,
            journals: 0,
            postings: 0,
            rawAssignments: 0,
            sourceActivities: 0,
            sourceComponents: 0,
          };

          for (const write of writes) {
            const result = yield* await db.accountingLedger.replaceForSourceActivity({
              journals: write.journals,
              rawTransactionIds: write.rawTransactionIds,
              sourceActivity: write.sourceActivity,
            });

            summary.diagnostics += result.diagnosticCount;
            summary.journals += result.journalCount;
            summary.postings += result.postingCount;
            summary.rawAssignments += result.rawAssignmentCount;
            summary.sourceActivities += 1;
            summary.sourceComponents += result.sourceComponentCount;
          }

          return summary;
        }),
    },

    accountLookup: {
      getAccountInfo: (accountId) => db.accounts.getById(accountId),

      findChildAccounts: (parentAccountId) => db.accounts.findAll({ parentAccountId }),

      getProfileAddresses: (profileId, blockchain) =>
        resultDoAsync(async function* () {
          const accounts = yield* await db.accounts.findAll({ profileId });
          return accounts.filter((account) => account.platformKey === blockchain).map((account) => account.identifier);
        }),
    },

    ledgerLinkingOverrides: {
      materializeStoredAssetIdentityAssertions: (scope) =>
        materializeProfileScopedLedgerLinkingAssetIdentityOverrides(db, options.overrideStore, scope ?? {}),
    },

    transactionOverrides: {
      materializeStoredOverrides: (scope) =>
        materializeProfileScopedTransactionOverrides(db, options.overrideStore, scope ?? {}),
    },

    importSessionLookup: {
      findLatestSessionPerAccount: (accountIds) =>
        resultDoAsync(async function* () {
          const sessions = yield* await db.importSessions.findAll({ accountIds });

          // Sessions are returned ordered by creation date descending,
          // so the first one per account is the latest.
          const latestByAccount = new Map<number, { accountId: number; status: ImportSessionStatus }>();
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

    markProcessedTransactionsBuilding: (accountIds) =>
      resultDoAsync(async function* () {
        const profileIds = yield* await resolveAffectedProfileIds(db, accountIds);
        for (const profileId of profileIds) {
          yield* await db.projectionState.markBuilding(
            'processed-transactions',
            buildProfileProjectionScopeKey(profileId)
          );
        }
      }),

    markProcessedTransactionsFresh: (accountIds) =>
      resultDoAsync(async function* () {
        const profileIds = yield* await resolveAffectedProfileIds(db, accountIds);
        for (const profileId of profileIds) {
          const accountHash = yield* await computeScopedAccountHash(db, profileId);
          yield* await db.projectionState.markFresh(
            'processed-transactions',
            { accountHash },
            buildProfileProjectionScopeKey(profileId)
          );
        }
        yield* await markDownstreamProjectionsStale({
          accountIds,
          db,
          from: 'processed-transactions',
          reason: 'upstream-rebuilt:processed-transactions',
        });
      }),

    markProcessedTransactionsFailed: (accountIds) =>
      resultDoAsync(async function* () {
        const profileIds = yield* await resolveAffectedProfileIds(db, accountIds);
        for (const profileId of profileIds) {
          yield* await db.projectionState.markFailed(
            'processed-transactions',
            buildProfileProjectionScopeKey(profileId)
          );
        }
      }),

    rebuildTransactionInterpretation: (accountIds) => options.rebuildTransactionInterpretation(accountIds),

    rebuildAssetReviewProjection: (accountIds) => options.rebuildAssetReviewProjection(accountIds),

    withTransaction: (fn) => db.executeInTransaction((txDb) => fn(buildProcessingPorts(txDb, options))),
  };
}
