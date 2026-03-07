import { err, ok } from '@exitbook/core';
import type { ProcessingPorts } from '@exitbook/ingestion/ports';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext repositories to ingestion's ProcessingPorts.
 * This is the only place where the concrete data layer meets the ingestion hexagon's ports.
 */
export function buildProcessingPorts(db: DataContext): ProcessingPorts {
  return {
    derivedDataCleaner: {
      clearDerivedData: async (accountId) => {
        return db.executeInTransaction(async (tx) => {
          const accountIds = accountId ? [accountId] : undefined;

          // FK-ordered: consolidated movements → links → transactions
          const consolidatedResult = accountIds
            ? await tx.utxoConsolidatedMovements.deleteByAccountIds(accountIds)
            : await tx.utxoConsolidatedMovements.deleteAll();
          if (consolidatedResult.isErr()) return err(consolidatedResult.error);

          const linksResult = accountIds
            ? await tx.transactionLinks.deleteByAccountIds(accountIds)
            : await tx.transactionLinks.deleteAll();
          if (linksResult.isErr()) return err(linksResult.error);

          const transactionsResult = accountIds
            ? await tx.transactions.deleteByAccountIds(accountIds)
            : await tx.transactions.deleteAll();
          if (transactionsResult.isErr()) return err(transactionsResult.error);

          // Reset raw data processing status (do NOT delete raw data)
          const resetResult = accountId
            ? await tx.rawTransactions.resetProcessingStatus({ accountId })
            : await tx.rawTransactions.resetProcessingStatus();
          if (resetResult.isErr()) return err(resetResult.error);

          // Count what we deleted for observability
          const linksCount = linksResult.value ?? 0;
          const transactionsCount = transactionsResult.value ?? 0;

          return ok({
            transactions: transactionsCount,
            links: linksCount,
          });
        });
      },
    },

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

      getUserAddresses: async (userId, blockchain) => {
        const result = await db.accounts.findAll({ userId });
        if (result.isErr()) return err(result.error);
        return ok(
          result.value.filter((account) => account.sourceName === blockchain).map((account) => account.identifier)
        );
      },
    },

    importSessionLookup: {
      findLatestSessionPerAccount: async (accountIds) => {
        const result = await db.importSessions.findAll({ accountIds });
        if (result.isErr()) return err(result.error);

        // Sessions are returned ordered by creation date descending,
        // so the first one per account is the latest.
        const latestByAccount = new Map<number, { accountId: number; status: string }>();
        for (const session of result.value) {
          if (!latestByAccount.has(session.accountId)) {
            latestByAccount.set(session.accountId, {
              accountId: session.accountId,
              status: session.status,
            });
          }
        }

        return ok([...latestByAccount.values()]);
      },
    },

    withTransaction: (fn) => db.executeInTransaction((txDb) => fn(buildProcessingPorts(txDb))),
  };
}
