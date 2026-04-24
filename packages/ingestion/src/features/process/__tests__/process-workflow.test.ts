import type { RawTransaction, TransactionDraft } from '@exitbook/core';
import { err, ok } from '@exitbook/foundation';
import type { AccountingJournalDraft, SourceActivityDraft } from '@exitbook/ledger';
import { describe, expect, it, vi } from 'vitest';

import type { ProcessingPorts } from '../../../ports/processing-ports.js';
import { ProcessingWorkflow } from '../process-workflow.js';

function createWorkflow(params?: {
  accountFingerprint?: string | undefined;
  accountName?: string | undefined;
  importStatus?: 'started' | 'completed' | 'failed' | 'cancelled' | undefined;
}) {
  const accountFingerprint = params?.accountFingerprint ?? '1234567890abcdef1234567890abcdef';
  const accountName = params?.accountName;
  const importStatus = params?.importStatus ?? 'failed';
  const findAccountsWithPendingData = vi.fn().mockResolvedValue(ok([]));
  const findAccountsWithRawData = vi.fn().mockResolvedValue(ok([]));
  const findLatestSessionPerAccount = vi.fn().mockResolvedValue(ok([{ accountId: 14, status: importStatus }]));
  const emit = vi.fn();
  const markProcessedTransactionsFresh = vi.fn().mockResolvedValue(ok(undefined));
  const materializeStoredOverrides = vi.fn().mockResolvedValue(ok(0));
  const rebuildTransactionInterpretation = vi.fn().mockResolvedValue(ok(undefined));
  const rebuildAssetReviewProjection = vi.fn().mockResolvedValue(ok(undefined));

  const ports: ProcessingPorts = {
    accountLookup: {
      getAccountInfo: vi.fn().mockResolvedValue(
        ok({
          accountType: 'blockchain',
          accountFingerprint,
          identifier: '0xlukso',
          name: accountName,
          platformKey: 'lukso',
          profileId: 1,
        })
      ),
      getProfileAddresses: vi.fn().mockResolvedValue(ok([])),
    },
    accountingLedgerSink: {
      replaceSourceActivities: vi.fn().mockResolvedValue(
        ok({
          diagnostics: 0,
          journals: 0,
          postings: 0,
          rawAssignments: 0,
          sourceActivities: 0,
          sourceComponents: 0,
        })
      ),
    },
    batchSource: {
      countPending: vi.fn().mockResolvedValue(ok(0)),
      countPendingByStreamType: vi.fn().mockResolvedValue(ok(new Map())),
      fetchAllPending: vi.fn().mockResolvedValue(ok([])),
      fetchPendingByTransactionHash: vi.fn().mockResolvedValue(ok([])),
      findAccountsWithPendingData,
      findAccountsWithRawData,
      markProcessed: vi.fn().mockResolvedValue(ok(undefined)),
    },
    importSessionLookup: {
      findLatestSessionPerAccount,
    },
    markProcessedTransactionsBuilding: vi.fn().mockResolvedValue(ok(undefined)),
    markProcessedTransactionsFailed: vi.fn().mockResolvedValue(ok(undefined)),
    markProcessedTransactionsFresh,
    nearBatchSource: {} as never,
    rebuildAssetReviewProjection,
    rebuildTransactionInterpretation,
    transactionOverrides: {
      materializeStoredOverrides,
    },
    transactionSink: {} as never,
    withTransaction: vi.fn(),
  };

  const workflow = new ProcessingWorkflow(
    ports,
    {
      getProviders: vi.fn().mockReturnValue([]),
    } as never,
    {
      emit,
    } as never,
    {
      getBlockchain: vi.fn(),
      getExchange: vi.fn(),
      getAllBlockchains: vi.fn(),
      getAllExchanges: vi.fn(),
      hasBlockchain: vi.fn(),
      hasExchange: vi.fn(),
    } as never
  );

  return {
    ports,
    workflow,
    mocks: {
      emit,
      findAccountsWithRawData,
      findLatestSessionPerAccount,
      markProcessedTransactionsFresh,
      materializeStoredOverrides,
      rebuildAssetReviewProjection,
      rebuildTransactionInterpretation,
    },
  };
}

describe('ProcessingWorkflow', () => {
  describe('assertNoIncompleteImports', () => {
    it('uses the account name in the blocked-processing message', async () => {
      const { workflow } = createWorkflow({ accountName: 'lukso-wallet' });

      const result = await workflow.assertNoIncompleteImports([14]);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('lukso-wallet(failed)');
        expect(result.error.message).not.toContain('14(failed)');
      }
    });
  });

  describe('processImportedSessions', () => {
    it('falls back to a fingerprint ref instead of exposing the numeric account id', async () => {
      const { workflow } = createWorkflow({
        accountFingerprint: 'abcdef1234567890fedcba0987654321',
        accountName: undefined,
      });

      const result = await workflow.processImportedSessions([14]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.errors).toHaveLength(1);
        expect(result.value.errors[0]).toContain('abcdef1234');
        expect(result.value.errors[0]).not.toContain('account 14');
        expect(result.value.errors[0]).not.toContain('14(failed)');
      }
    });

    it('rebuilds interpretation before marking processed transactions fresh when processing succeeds', async () => {
      const { workflow, mocks } = createWorkflow({ importStatus: 'completed' });
      mocks.findLatestSessionPerAccount.mockResolvedValue(ok([]));
      vi.spyOn(workflow, 'processAccountTransactions').mockResolvedValue(
        ok({
          errors: [],
          failed: 0,
          processed: 1,
        })
      );

      const result = await workflow.processImportedSessions([14]);

      expect(result.isOk()).toBe(true);
      expect(mocks.materializeStoredOverrides).toHaveBeenCalledWith({ accountIds: [14] });
      expect(mocks.rebuildTransactionInterpretation).toHaveBeenCalledWith([14]);
      expect(mocks.markProcessedTransactionsFresh).toHaveBeenCalledWith([14]);
      expect(mocks.rebuildAssetReviewProjection).toHaveBeenCalledWith([14]);
      const rebuildInterpretationCall = mocks.rebuildTransactionInterpretation.mock.invocationCallOrder[0];
      const markFreshCall = mocks.markProcessedTransactionsFresh.mock.invocationCallOrder[0];
      const rebuildAssetReviewCall = mocks.rebuildAssetReviewProjection.mock.invocationCallOrder[0];

      expect(rebuildInterpretationCall).toBeDefined();
      expect(markFreshCall).toBeDefined();
      expect(rebuildAssetReviewCall).toBeDefined();

      if (
        rebuildInterpretationCall === undefined ||
        markFreshCall === undefined ||
        rebuildAssetReviewCall === undefined
      ) {
        return;
      }

      expect(rebuildInterpretationCall).toBeLessThan(markFreshCall);
      expect(markFreshCall).toBeLessThan(rebuildAssetReviewCall);
    });

    it('fails before marking processed transactions fresh when interpretation rebuild fails', async () => {
      const { workflow, mocks } = createWorkflow({ importStatus: 'completed' });
      mocks.findLatestSessionPerAccount.mockResolvedValue(ok([]));
      vi.spyOn(workflow, 'processAccountTransactions').mockResolvedValue(
        ok({
          errors: [],
          failed: 0,
          processed: 1,
        })
      );
      mocks.rebuildTransactionInterpretation.mockResolvedValue(err(new Error('interpretation exploded')));

      const result = await workflow.processImportedSessions([14]);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('transaction interpretation failed');
      }
      expect(mocks.markProcessedTransactionsFresh).not.toHaveBeenCalled();
      expect(mocks.rebuildAssetReviewProjection).not.toHaveBeenCalled();
      expect(mocks.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'process.failed',
          accountIds: [14],
        })
      );
    });
  });

  describe('processAccountTransactions', () => {
    it('persists ledger-v2 source activities in the same batch transaction as legacy transactions', async () => {
      const rawTransaction = createRawTransaction();
      const legacyTransaction = createLegacyTransactionDraft();
      const sourceActivity = createSourceActivityDraft();
      const ledgerJournal = createLedgerJournalDraft(sourceActivity.sourceActivityFingerprint);
      const saveProcessedBatch = vi.fn().mockResolvedValue(ok({ duplicates: 0, saved: 1 }));
      const replaceSourceActivities = vi.fn().mockResolvedValue(
        ok({
          diagnostics: 0,
          journals: 1,
          postings: 0,
          rawAssignments: 1,
          sourceActivities: 1,
          sourceComponents: 0,
        })
      );
      const markProcessed = vi.fn().mockResolvedValue(ok(undefined));
      const legacyProcess = vi.fn().mockResolvedValue(ok([legacyTransaction]));
      const ledgerProcess = vi.fn().mockResolvedValue(ok([{ journals: [ledgerJournal], sourceActivity }]));

      let batchFetched = false;
      const ports: ProcessingPorts = {
        accountLookup: {
          getAccountInfo: vi.fn().mockResolvedValue(
            ok({
              accountType: 'blockchain',
              accountFingerprint: 'acct-fingerprint',
              identifier: '0xabc',
              platformKey: 'ethereum',
              profileId: 1,
            })
          ),
          getProfileAddresses: vi.fn().mockResolvedValue(ok(['0xabc'])),
        },
        accountingLedgerSink: {
          replaceSourceActivities,
        },
        batchSource: {
          countPending: vi.fn().mockResolvedValue(ok(1)),
          countPendingByStreamType: vi.fn().mockResolvedValue(ok(new Map())),
          fetchAllPending: vi.fn().mockResolvedValue(ok([])),
          fetchPendingByTransactionHash: vi.fn().mockImplementation(async () => {
            if (batchFetched) {
              return ok([]);
            }
            batchFetched = true;
            return ok([rawTransaction]);
          }),
          findAccountsWithPendingData: vi.fn().mockResolvedValue(ok([])),
          findAccountsWithRawData: vi.fn().mockResolvedValue(ok([])),
          markProcessed,
        },
        importSessionLookup: {
          findLatestSessionPerAccount: vi.fn().mockResolvedValue(ok([])),
        },
        markProcessedTransactionsBuilding: vi.fn().mockResolvedValue(ok(undefined)),
        markProcessedTransactionsFailed: vi.fn().mockResolvedValue(ok(undefined)),
        markProcessedTransactionsFresh: vi.fn().mockResolvedValue(ok(undefined)),
        nearBatchSource: {} as never,
        rebuildAssetReviewProjection: vi.fn().mockResolvedValue(ok(undefined)),
        rebuildTransactionInterpretation: vi.fn().mockResolvedValue(ok(undefined)),
        transactionOverrides: {
          materializeStoredOverrides: vi.fn().mockResolvedValue(ok(0)),
        },
        transactionSink: {
          saveProcessedBatch,
        },
        withTransaction: async (fn) => fn(ports),
      };

      const workflow = new ProcessingWorkflow(
        ports,
        {
          getProviders: vi.fn().mockReturnValue([]),
          getTokenMetadata: vi.fn().mockResolvedValue(ok(new Map())),
        } as never,
        { emit: vi.fn() } as never,
        {
          getBlockchain: vi.fn().mockReturnValue(
            ok({
              blockchain: 'ethereum',
              chainModel: 'account-based',
              createImporter: vi.fn(),
              createProcessor: () => ({ process: legacyProcess }),
              createLedgerProcessor: () => ({ process: ledgerProcess }),
              normalizeAddress: vi.fn(),
            })
          ),
          getExchange: vi.fn(),
          getAllBlockchains: vi.fn(),
          getAllExchanges: vi.fn(),
          hasBlockchain: vi.fn(),
          hasExchange: vi.fn(),
        } as never
      );

      const result = await workflow.processAccountTransactions(14);

      expect(result.isOk()).toBe(true);
      expect(saveProcessedBatch).toHaveBeenCalledWith(
        [{ rawTransactionIds: [rawTransaction.id], transaction: legacyTransaction }],
        14
      );
      expect(replaceSourceActivities).toHaveBeenCalledWith([
        {
          journals: [ledgerJournal],
          rawTransactionIds: [rawTransaction.id],
          sourceActivity,
        },
      ]);
      expect(markProcessed).toHaveBeenCalledWith([rawTransaction.id]);

      const saveOrder = saveProcessedBatch.mock.invocationCallOrder[0]!;
      const ledgerOrder = replaceSourceActivities.mock.invocationCallOrder[0]!;
      const markOrder = markProcessed.mock.invocationCallOrder[0]!;
      expect(saveOrder).toBeLessThan(ledgerOrder);
      expect(ledgerOrder).toBeLessThan(markOrder);
    });
  });

  describe('prepareReprocess', () => {
    it('uses the provided profile scope for raw-data account discovery', async () => {
      const { workflow, mocks } = createWorkflow();
      mocks.findLatestSessionPerAccount.mockResolvedValue(ok([]));
      mocks.findAccountsWithRawData.mockResolvedValue(ok([11, 12]));

      const result = await workflow.prepareReprocess({ profileId: 7 });

      expect(result.isOk()).toBe(true);
      expect(mocks.findAccountsWithRawData).toHaveBeenCalledWith(7);
    });
  });
});

function createRawTransaction(): RawTransaction {
  return {
    id: 101,
    accountId: 14,
    blockchainTransactionHash: '0xhash',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    eventId: 'raw-event-101',
    normalizedData: {
      id: '0xhash',
    },
    processingStatus: 'pending',
    providerData: {},
    providerName: 'test',
    timestamp: 1_700_000_000_000,
  };
}

function createLegacyTransactionDraft(): TransactionDraft {
  return {
    datetime: '2023-11-14T22:13:20.000Z',
    fees: [],
    movements: {
      inflows: [],
      outflows: [],
    },
    operation: {
      category: 'transfer',
      type: 'transfer',
    },
    platformKey: 'ethereum',
    platformKind: 'blockchain',
    status: 'success',
    timestamp: 1_700_000_000_000,
    blockchain: {
      is_confirmed: true,
      name: 'ethereum',
      transaction_hash: '0xhash',
    },
  };
}

function createSourceActivityDraft(): SourceActivityDraft {
  return {
    accountId: 14,
    activityDatetime: '2023-11-14T22:13:20.000Z',
    activityStatus: 'success',
    activityTimestampMs: 1_700_000_000_000,
    blockchainName: 'ethereum',
    blockchainTransactionHash: '0xhash',
    platformKey: 'ethereum',
    platformKind: 'blockchain',
    sourceActivityFingerprint: 'source-activity-fingerprint',
  };
}

function createLedgerJournalDraft(sourceActivityFingerprint: string): AccountingJournalDraft {
  return {
    journalKind: 'transfer',
    journalStableKey: 'wallet_delta',
    postings: [],
    sourceActivityFingerprint,
  };
}
