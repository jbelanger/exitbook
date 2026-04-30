import type { RawTransaction, TransactionDraft } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { err, ok, parseDecimal } from '@exitbook/foundation';
import type { AccountingJournalDraft, SourceActivityDraft } from '@exitbook/ledger';
import { describe, expect, it, vi } from 'vitest';

import type { ProcessingAccountInfo } from '../../../ports/account-lookup.js';
import type { ProcessingPorts } from '../../../ports/processing-ports.js';
import type {
  BlockchainLedgerProcessorFactoryContext,
  LegacyBlockchainProcessorContext,
} from '../../../shared/types/blockchain-adapter.js';
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
  const materializeLedgerLinkingAssetIdentityAssertions = vi.fn().mockResolvedValue(ok(0));
  const materializeStoredOverrides = vi.fn().mockResolvedValue(ok(0));
  const rebuildTransactionInterpretation = vi.fn().mockResolvedValue(ok(undefined));
  const rebuildAssetReviewProjection = vi.fn().mockResolvedValue(ok(undefined));

  const ports: ProcessingPorts = {
    accountLookup: {
      getAccountInfo: vi.fn().mockResolvedValue(
        ok({
          id: 14,
          accountType: 'blockchain',
          accountFingerprint,
          identifier: '0xlukso',
          name: accountName,
          platformKey: 'lukso',
          profileId: 1,
        })
      ),
      findChildAccounts: vi.fn().mockResolvedValue(ok([])),
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
      fetchByTransactionHashesForAccounts: vi.fn().mockResolvedValue(ok([])),
      fetchPendingByTransactionHash: vi.fn().mockResolvedValue(ok([])),
      findAccountsWithPendingData,
      findAccountsWithRawData,
      markProcessed: vi.fn().mockResolvedValue(ok(undefined)),
    },
    importSessionLookup: {
      findLatestSessionPerAccount,
    },
    ledgerLinkingOverrides: {
      materializeStoredAssetIdentityAssertions: materializeLedgerLinkingAssetIdentityAssertions,
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
      materializeLedgerLinkingAssetIdentityAssertions,
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

      expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
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

      expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
      expect(mocks.materializeStoredOverrides).toHaveBeenCalledWith({ accountIds: [14] });
      expect(mocks.materializeLedgerLinkingAssetIdentityAssertions).toHaveBeenCalledWith({ accountIds: [14] });
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
      const createLegacyProcessor = vi.fn((_deps: LegacyBlockchainProcessorContext) => ({ process: legacyProcess }));
      const createLedgerProcessor = vi.fn((_deps: BlockchainLedgerProcessorFactoryContext) => ({
        process: ledgerProcess,
      }));

      let batchFetched = false;
      const ports: ProcessingPorts = {
        accountLookup: {
          getAccountInfo: vi.fn().mockResolvedValue(
            ok({
              id: 14,
              accountType: 'blockchain',
              accountFingerprint: 'acct-fingerprint',
              identifier: '0xabc',
              platformKey: 'ethereum',
              profileId: 1,
            })
          ),
          findChildAccounts: vi.fn().mockResolvedValue(ok([])),
          getProfileAddresses: vi.fn().mockResolvedValue(ok(['0xabc'])),
        },
        accountingLedgerSink: {
          replaceSourceActivities,
        },
        batchSource: {
          countPending: vi.fn().mockResolvedValue(ok(1)),
          countPendingByStreamType: vi.fn().mockResolvedValue(ok(new Map())),
          fetchAllPending: vi.fn().mockResolvedValue(ok([])),
          fetchByTransactionHashesForAccounts: vi.fn().mockResolvedValue(ok([])),
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
        ledgerLinkingOverrides: {
          materializeStoredAssetIdentityAssertions: vi.fn().mockResolvedValue(ok(0)),
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
              createProcessor: createLegacyProcessor,
              createLedgerProcessor,
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

      expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
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
      const legacyProcessorDeps = createLegacyProcessor.mock.calls[0]?.[0];
      expect(typeof legacyProcessorDeps?.scamDetector).toBe('function');
      const ledgerProcessorDeps = createLedgerProcessor.mock.calls[0]?.[0];
      expect(ledgerProcessorDeps).toBeDefined();
      expect(ledgerProcessorDeps).not.toHaveProperty('scamDetector');

      const saveOrder = saveProcessedBatch.mock.invocationCallOrder[0]!;
      const ledgerOrder = replaceSourceActivities.mock.invocationCallOrder[0]!;
      const markOrder = markProcessed.mock.invocationCallOrder[0]!;
      expect(saveOrder).toBeLessThan(ledgerOrder);
      expect(ledgerOrder).toBeLessThan(markOrder);
    });

    it('persists UTXO ledger-v2 source activities on the parent wallet without marking sibling raw rows processed', async () => {
      const childRawTransaction = createRawTransaction({
        id: 201,
        accountId: 2,
        blockchainTransactionHash: 'bitcoin-hash',
        eventId: 'raw-child-201',
        normalizedData: { id: 'bitcoin-hash', view: 'child' },
      });
      const siblingRawTransaction = createRawTransaction({
        id: 202,
        accountId: 3,
        blockchainTransactionHash: 'bitcoin-hash',
        eventId: 'raw-sibling-202',
        normalizedData: { id: 'bitcoin-hash', view: 'sibling' },
      });
      const legacyTransaction: TransactionDraft = {
        ...createLegacyTransactionDraft(),
        platformKey: 'bitcoin',
        blockchain: {
          is_confirmed: true,
          name: 'bitcoin',
          transaction_hash: 'bitcoin-hash',
        },
      };
      const sourceActivity = createSourceActivityDraft({
        ownerAccountId: 1,
        blockchainName: 'bitcoin',
        blockchainTransactionHash: 'bitcoin-hash',
        platformKey: 'bitcoin',
      });
      const ledgerJournal = createLedgerJournalDraft(sourceActivity.sourceActivityFingerprint);
      const saveProcessedBatch = vi.fn().mockResolvedValue(ok({ duplicates: 0, saved: 1 }));
      const replaceSourceActivities = vi.fn().mockResolvedValue(
        ok({
          diagnostics: 0,
          journals: 1,
          postings: 0,
          rawAssignments: 2,
          sourceActivities: 1,
          sourceComponents: 0,
        })
      );
      const markProcessed = vi.fn().mockResolvedValue(ok(undefined));
      const legacyProcess = vi.fn().mockResolvedValue(ok([legacyTransaction]));
      const ledgerProcess = vi.fn().mockResolvedValue(ok([{ journals: [ledgerJournal], sourceActivity }]));

      let batchFetched = false;
      const accounts = new Map<number, ProcessingAccountInfo>([
        [
          1,
          {
            id: 1,
            accountType: 'blockchain',
            accountFingerprint: 'parent-fingerprint',
            identifier: 'xpub-parent',
            platformKey: 'bitcoin',
            profileId: 1,
          },
        ],
        [
          2,
          {
            id: 2,
            accountType: 'blockchain',
            accountFingerprint: 'child-fingerprint',
            identifier: 'bc1qchild',
            parentAccountId: 1,
            platformKey: 'bitcoin',
            profileId: 1,
          },
        ],
        [
          3,
          {
            id: 3,
            accountType: 'blockchain',
            accountFingerprint: 'sibling-fingerprint',
            identifier: 'bc1qsibling',
            parentAccountId: 1,
            platformKey: 'bitcoin',
            profileId: 1,
          },
        ],
      ]);
      const fetchByTransactionHashesForAccounts = vi
        .fn()
        .mockResolvedValue(ok([childRawTransaction, siblingRawTransaction]));

      const ports: ProcessingPorts = {
        accountLookup: {
          getAccountInfo: vi.fn().mockImplementation(async (accountId: number) => ok(accounts.get(accountId)!)),
          findChildAccounts: vi
            .fn()
            .mockImplementation(async (parentAccountId: number) =>
              ok([...accounts.values()].filter((account) => account.parentAccountId === parentAccountId))
            ),
          getProfileAddresses: vi.fn().mockResolvedValue(ok(['xpub-parent', 'bc1qchild', 'bc1qsibling'])),
        },
        accountingLedgerSink: {
          replaceSourceActivities,
        },
        batchSource: {
          countPending: vi.fn().mockResolvedValue(ok(1)),
          countPendingByStreamType: vi.fn().mockResolvedValue(ok(new Map())),
          fetchAllPending: vi.fn().mockResolvedValue(ok([])),
          fetchByTransactionHashesForAccounts,
          fetchPendingByTransactionHash: vi.fn().mockImplementation(async () => {
            if (batchFetched) {
              return ok([]);
            }
            batchFetched = true;
            return ok([childRawTransaction]);
          }),
          findAccountsWithPendingData: vi.fn().mockResolvedValue(ok([])),
          findAccountsWithRawData: vi.fn().mockResolvedValue(ok([])),
          markProcessed,
        },
        importSessionLookup: {
          findLatestSessionPerAccount: vi.fn().mockResolvedValue(ok([])),
        },
        ledgerLinkingOverrides: {
          materializeStoredAssetIdentityAssertions: vi.fn().mockResolvedValue(ok(0)),
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
              blockchain: 'bitcoin',
              chainModel: 'utxo',
              createImporter: vi.fn(),
              createProcessor: () => ({ process: legacyProcess }),
              createLedgerProcessor: () => ({ process: ledgerProcess }),
              deriveAddressesFromXpub: vi.fn(),
              isExtendedPublicKey: (identifier: string) => identifier.startsWith('xpub'),
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

      const result = await workflow.processAccountTransactions(2);

      expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
      expect(ledgerProcess).toHaveBeenCalledWith(
        [childRawTransaction.normalizedData, siblingRawTransaction.normalizedData],
        expect.objectContaining({
          account: {
            fingerprint: 'parent-fingerprint',
            id: 1,
          },
          walletAddresses: ['bc1qchild', 'bc1qsibling'],
        })
      );
      expect(fetchByTransactionHashesForAccounts).toHaveBeenCalledWith([1, 2, 3], ['bitcoin-hash']);
      expect(replaceSourceActivities).toHaveBeenCalledWith([
        {
          journals: [ledgerJournal],
          rawTransactionIds: [childRawTransaction.id, siblingRawTransaction.id],
          sourceActivity,
        },
      ]);
      expect(markProcessed).toHaveBeenCalledWith([childRawTransaction.id]);
    });

    it('persists exchange ledger-v2 source activities without legacy scam-detector wiring', async () => {
      const rawTransaction = createRawTransaction({
        accountId: 14,
        blockchainTransactionHash: undefined,
        eventId: 'kraken-event-1',
        providerData: { id: 'kraken-event-1' },
      });
      const { blockchain: _blockchain, ...baseLegacyTransaction } = createLegacyTransactionDraft();
      const legacyTransaction: TransactionDraft = {
        ...baseLegacyTransaction,
        identityMaterial: {
          componentEventIds: ['kraken-event-1'],
        },
        platformKey: 'kraken',
        platformKind: 'exchange',
      };
      const sourceActivity = createSourceActivityDraft({
        blockchainName: undefined,
        blockchainTransactionHash: undefined,
        ownerAccountId: 14,
        platformKind: 'exchange',
        platformKey: 'kraken',
        sourceActivityFingerprint: 'kraken-source-activity-fingerprint',
        sourceActivityStableKey: 'provider-event-group:kraken-ref-1',
      });
      const ledgerJournal: AccountingJournalDraft = {
        journalKind: 'transfer',
        journalStableKey: 'primary',
        sourceActivityFingerprint: sourceActivity.sourceActivityFingerprint,
        postings: [
          {
            postingStableKey: 'movement:in:exchange:kraken:btc:1',
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC' as Currency,
            quantity: parseDecimal('1'),
            role: 'principal',
            balanceCategory: 'liquid',
            sourceComponentRefs: [
              {
                component: {
                  sourceActivityFingerprint: sourceActivity.sourceActivityFingerprint,
                  componentKind: 'raw_event',
                  componentId: 'kraken-event-1',
                  assetId: 'exchange:kraken:btc',
                },
                quantity: parseDecimal('1'),
              },
            ],
          },
        ],
      };
      const saveProcessedBatch = vi.fn().mockResolvedValue(ok({ duplicates: 0, saved: 1 }));
      const replaceSourceActivities = vi.fn().mockResolvedValue(
        ok({
          diagnostics: 0,
          journals: 1,
          postings: 1,
          rawAssignments: 1,
          sourceActivities: 1,
          sourceComponents: 1,
        })
      );
      const markProcessed = vi.fn().mockResolvedValue(ok(undefined));
      const legacyProcess = vi.fn().mockResolvedValue(ok([legacyTransaction]));
      const ledgerProcess = vi.fn().mockResolvedValue(ok([{ journals: [ledgerJournal], sourceActivity }]));
      const createLegacyProcessor = vi.fn(() => ({ process: legacyProcess }));
      const createLedgerProcessor = vi.fn(() => ({ process: ledgerProcess }));

      let batchFetched = false;
      const ports: ProcessingPorts = {
        accountLookup: {
          getAccountInfo: vi.fn().mockResolvedValue(
            ok({
              id: 14,
              accountType: 'exchange-api',
              accountFingerprint: 'kraken-account-fingerprint',
              identifier: 'kraken',
              platformKey: 'kraken',
              profileId: 1,
            })
          ),
          findChildAccounts: vi.fn().mockResolvedValue(ok([])),
          getProfileAddresses: vi.fn().mockResolvedValue(ok([])),
        },
        accountingLedgerSink: {
          replaceSourceActivities,
        },
        batchSource: {
          countPending: vi.fn().mockResolvedValue(ok(1)),
          countPendingByStreamType: vi.fn().mockResolvedValue(ok(new Map())),
          fetchAllPending: vi.fn().mockImplementation(async () => {
            if (batchFetched) {
              return ok([]);
            }
            batchFetched = true;
            return ok([rawTransaction]);
          }),
          fetchByTransactionHashesForAccounts: vi.fn().mockResolvedValue(ok([])),
          fetchPendingByTransactionHash: vi.fn().mockResolvedValue(ok([])),
          findAccountsWithPendingData: vi.fn().mockResolvedValue(ok([])),
          findAccountsWithRawData: vi.fn().mockResolvedValue(ok([])),
          markProcessed,
        },
        importSessionLookup: {
          findLatestSessionPerAccount: vi.fn().mockResolvedValue(ok([])),
        },
        ledgerLinkingOverrides: {
          materializeStoredAssetIdentityAssertions: vi.fn().mockResolvedValue(ok(0)),
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
        } as never,
        { emit: vi.fn() } as never,
        {
          getBlockchain: vi.fn(),
          getExchange: vi.fn().mockReturnValue(
            ok({
              capabilities: {
                supportsApi: true,
                supportsCsv: false,
              },
              exchange: 'kraken',
              createImporter: vi.fn(),
              createProcessor: createLegacyProcessor,
              createLedgerProcessor,
            })
          ),
          getAllBlockchains: vi.fn(),
          getAllExchanges: vi.fn(),
          hasBlockchain: vi.fn(),
          hasExchange: vi.fn(),
        } as never
      );

      const result = await workflow.processAccountTransactions(14);

      expect(result.isOk(), result.isErr() ? result.error.message : '').toBe(true);
      expect(createLedgerProcessor).toHaveBeenCalledWith();
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

function createRawTransaction(overrides: Partial<RawTransaction> = {}): RawTransaction {
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
    ...overrides,
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

function createSourceActivityDraft(overrides: Partial<SourceActivityDraft> = {}): SourceActivityDraft {
  return {
    ownerAccountId: 14,
    sourceActivityOrigin: 'provider_event',
    sourceActivityStableKey: '0xhash',
    activityDatetime: '2023-11-14T22:13:20.000Z',
    activityStatus: 'success',
    activityTimestampMs: 1_700_000_000_000,
    blockchainName: 'ethereum',
    blockchainTransactionHash: '0xhash',
    platformKey: 'ethereum',
    platformKind: 'blockchain',
    sourceActivityFingerprint: 'source-activity-fingerprint',
    ...overrides,
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
