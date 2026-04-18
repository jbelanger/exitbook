import { ok } from '@exitbook/foundation';
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
    markProcessedTransactionsFresh: vi.fn().mockResolvedValue(ok(undefined)),
    nearBatchSource: {} as never,
    rebuildAssetReviewProjection: vi.fn().mockResolvedValue(ok(undefined)),
    transactionOverrides: {
      materializeStoredOverrides: vi.fn().mockResolvedValue(ok(0)),
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
      emit: vi.fn(),
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
      findAccountsWithRawData,
      findLatestSessionPerAccount,
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
