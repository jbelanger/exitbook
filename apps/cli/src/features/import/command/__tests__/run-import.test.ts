import type { Account } from '@exitbook/core';
import { EventBus } from '@exitbook/events';
import { err, ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import type { AdapterRegistry } from '@exitbook/ingestion/adapters';
import { isUtxoAdapter } from '@exitbook/ingestion/adapters';
import type { ImportParams, ImportWorkflow } from '@exitbook/ingestion/import';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { BatchImportMonitorEvent } from '../../view/index.js';
import {
  abortImportRuntime,
  createBatchImportRuntime,
  executeBatchImportAccounts,
  executeImportWithRuntime,
  type ImportExecutionRuntime,
} from '../run-import.js';

vi.mock('@exitbook/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('@exitbook/ingestion/adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exitbook/ingestion/adapters')>();
  return { ...actual, isUtxoAdapter: vi.fn() };
});

const makeSession = (
  overrides: Partial<{
    accountId: number;
    id: number;
    status: string;
    transactionsImported: number;
    transactionsSkipped: number;
  }> = {}
) => ({
  id: 123,
  accountId: 1,
  status: 'completed',
  startedAt: new Date(),
  transactionsImported: 50,
  transactionsSkipped: 0,
  createdAt: new Date(),
  ...overrides,
});

const makeAccount = (overrides: Partial<Account> = {}): Account => {
  const profileId = overrides.profileId ?? 1;
  const accountType = overrides.accountType ?? 'blockchain';
  const platformKey = overrides.platformKey ?? 'bitcoin';
  const identifier = overrides.identifier ?? 'bc1qtest';

  return {
    id: 1,
    profileId,
    accountType,
    platformKey,
    identifier,
    accountFingerprint: overrides.accountFingerprint ?? `acct:${profileId}:${accountType}:${platformKey}:${identifier}`,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
};

describe('import runner helpers', () => {
  let mockFindAccountById: Mock;
  let mockImportWorkflow: { abort: Mock; execute: Mock };
  let mockRegistry: { getBlockchain: Mock };
  let mockIngestionMonitor: { abort: Mock; fail: Mock; stop: Mock };
  let mockInstrumentation: { getSummary: Mock };
  let runtime: ImportExecutionRuntime;

  beforeEach(() => {
    vi.clearAllMocks();

    mockImportWorkflow = {
      execute: vi.fn(),
      abort: vi.fn(),
    };

    mockFindAccountById = vi.fn();

    // Registry returns Err for all lookups — xpub warning path is skipped.
    mockRegistry = {
      getBlockchain: vi.fn().mockReturnValue({ isOk: () => false, isErr: () => true }),
    };

    mockIngestionMonitor = {
      fail: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
    };

    mockInstrumentation = {
      getSummary: vi.fn().mockReturnValue({ totalRequests: 0 }),
    };

    runtime = {
      findAccountById: mockFindAccountById,
      importWorkflow: mockImportWorkflow as unknown as ImportWorkflow,
      registry: mockRegistry as unknown as AdapterRegistry,
      ingestionMonitor: mockIngestionMonitor as never,
      instrumentation: mockInstrumentation as never,
    };
  });

  describe('execute — import stage', () => {
    it('should successfully import account data', async () => {
      const session = makeSession({ transactionsImported: 50 });
      mockImportWorkflow.execute.mockResolvedValue(ok({ sessions: [session] }));

      const params: ImportParams = {
        accountId: 1,
      };

      const result = await executeImportWithRuntime(runtime, params);

      const importResult = assertOk(result);
      expect(importResult).toEqual({
        kind: 'completed',
        result: {
          sessions: [session],
          runStats: { totalRequests: 0 },
        },
      });
      expect(mockImportWorkflow.execute).toHaveBeenCalledWith(params);
      expect(mockIngestionMonitor.stop).toHaveBeenCalledOnce();
    });

    it('should fail when import sessions are not completed', async () => {
      mockImportWorkflow.execute.mockResolvedValue(ok({ sessions: [makeSession({ status: 'failed' })] }));

      const result = await executeImportWithRuntime(runtime, {
        accountId: 1,
      });

      const error = assertErr(result);
      expect(error.message).toContain('not complete');
      expect(mockIngestionMonitor.fail).toHaveBeenCalledOnce();
      expect(mockIngestionMonitor.stop).toHaveBeenCalledOnce();
    });

    it('should return error when import fails', async () => {
      const importError = new Error('Import failed: network timeout');
      mockImportWorkflow.execute.mockResolvedValue(err(importError));

      const result = await executeImportWithRuntime(runtime, {
        accountId: 1,
      });

      const error = assertErr(result);
      expect(error).toBe(importError);
      expect(mockIngestionMonitor.fail).toHaveBeenCalledOnce();
    });
  });

  describe('execute — xpub single-address warning', () => {
    it('should show warning for UTXO single-address import and abort on decline', async () => {
      const mockAdapter = { isExtendedPublicKey: vi.fn().mockReturnValue(false) };
      mockRegistry.getBlockchain.mockReturnValue(ok(mockAdapter));
      mockFindAccountById.mockResolvedValue(ok(makeAccount()));
      vi.mocked(isUtxoAdapter).mockReturnValue(true);

      const onSingleAddressWarning = vi.fn().mockResolvedValue('declined');

      const result = await executeImportWithRuntime(runtime, {
        accountId: 1,
        onSingleAddressWarning,
      });

      const outcome = assertOk(result);
      expect(outcome).toEqual({
        kind: 'cancelled',
      });
      expect(onSingleAddressWarning).toHaveBeenCalled();
      expect(mockImportWorkflow.execute).not.toHaveBeenCalled();
      expect(mockIngestionMonitor.fail).not.toHaveBeenCalled();
      expect(mockIngestionMonitor.stop).toHaveBeenCalledOnce();
    });

    it('should proceed when user accepts single-address warning', async () => {
      const mockAdapter = { isExtendedPublicKey: vi.fn().mockReturnValue(false) };
      mockRegistry.getBlockchain.mockReturnValue(ok(mockAdapter));
      mockFindAccountById.mockResolvedValue(ok(makeAccount()));
      vi.mocked(isUtxoAdapter).mockReturnValue(true);

      const session = makeSession();
      mockImportWorkflow.execute.mockResolvedValue(ok({ sessions: [session] }));

      const onSingleAddressWarning = vi.fn().mockResolvedValue('confirmed');

      const result = await executeImportWithRuntime(runtime, {
        accountId: 1,
        onSingleAddressWarning,
      });

      expect(assertOk(result)).toEqual({
        kind: 'completed',
        result: {
          sessions: [session],
          runStats: { totalRequests: 0 },
        },
      });
      expect(mockImportWorkflow.execute).toHaveBeenCalled();
    });

    it('should skip warning for xpub accounts', async () => {
      const mockAdapter = { isExtendedPublicKey: vi.fn().mockReturnValue(true) };
      mockRegistry.getBlockchain.mockReturnValue(ok(mockAdapter));
      mockFindAccountById.mockResolvedValue(ok(makeAccount({ identifier: 'xpub6C...' })));
      vi.mocked(isUtxoAdapter).mockReturnValue(true);

      const session = makeSession();
      mockImportWorkflow.execute.mockResolvedValue(ok({ sessions: [session] }));

      const onSingleAddressWarning = vi.fn();

      const result = await executeImportWithRuntime(runtime, {
        accountId: 1,
        onSingleAddressWarning,
      });

      expect(assertOk(result)).toEqual({
        kind: 'completed',
        result: {
          sessions: [session],
          runStats: { totalRequests: 0 },
        },
      });
      expect(onSingleAddressWarning).not.toHaveBeenCalled();
    });

    it('should fail when the requested account does not exist', async () => {
      mockFindAccountById.mockResolvedValue(ok(undefined));

      const result = await executeImportWithRuntime(runtime, {
        accountId: 999,
        onSingleAddressWarning: vi.fn().mockResolvedValue('confirmed'),
      });

      const error = assertErr(result);
      expect(error.message).toContain('Account 999 not found');
      expect(mockImportWorkflow.execute).not.toHaveBeenCalled();
    });
  });

  describe('abort', () => {
    it('should delegate abort to ImportWorkflow and monitor', () => {
      abortImportRuntime(runtime);

      expect(mockImportWorkflow.abort).toHaveBeenCalledOnce();
      expect(mockIngestionMonitor.abort).toHaveBeenCalledOnce();
    });
  });

  describe('batch executor', () => {
    it('should execute batch accounts and summarize successful imports', async () => {
      mockImportWorkflow.execute
        .mockResolvedValueOnce(
          ok({ sessions: [makeSession({ accountId: 1, transactionsImported: 3, transactionsSkipped: 1 })] })
        )
        .mockResolvedValueOnce(
          ok({ sessions: [makeSession({ accountId: 2, transactionsImported: 5, transactionsSkipped: 0 })] })
        );

      const batchEventBus = new EventBus<BatchImportMonitorEvent>({
        onError: vi.fn(),
      });
      const emittedEvents: { type: string }[] = [];
      batchEventBus.subscribe((event) => {
        emittedEvents.push(event as { type: string });
      });

      const result = await executeBatchImportAccounts({
        batchAccounts: [
          { account: makeAccount({ id: 1, name: 'kraken-main', platformKey: 'kraken' }), syncMode: 'incremental' },
          { account: makeAccount({ id: 2, name: 'btc-wallet', platformKey: 'bitcoin' }), syncMode: 'first-sync' },
        ],
        batchEventBus,
        database: {
          importSessions: {
            findLatestIncomplete: vi.fn(),
          },
        } as never,
        runtime,
      });

      expect(assertOk(result)).toEqual({
        accounts: [
          {
            account: {
              accountType: 'blockchain',
              id: 1,
              name: 'kraken-main',
              platformKey: 'kraken',
            },
            counts: { imported: 3, skipped: 1 },
            status: 'completed',
            syncMode: 'incremental',
          },
          {
            account: {
              accountType: 'blockchain',
              id: 2,
              name: 'btc-wallet',
              platformKey: 'bitcoin',
            },
            counts: { imported: 5, skipped: 0 },
            status: 'completed',
            syncMode: 'first-sync',
          },
        ],
        failedCount: 0,
        totalCount: 2,
      });
      expect(emittedEvents.map((event) => event.type)).toEqual([
        'batch.account.started',
        'batch.account.completed',
        'batch.account.started',
        'batch.account.completed',
      ]);
    });

    it('should keep running after an account import fails and load failed-session counts', async () => {
      const failedSessionLookup = vi
        .fn()
        .mockResolvedValueOnce(ok({ transactionsImported: 7, transactionsSkipped: 2 }));
      mockImportWorkflow.execute.mockResolvedValueOnce(err(new Error('network timeout')));

      const batchEventBus = new EventBus<BatchImportMonitorEvent>({
        onError: vi.fn(),
      });
      const emittedEvents: { type: string }[] = [];
      batchEventBus.subscribe((event) => {
        emittedEvents.push(event as { type: string });
      });

      const result = await executeBatchImportAccounts({
        batchAccounts: [
          { account: makeAccount({ id: 1, name: 'kraken-main', platformKey: 'kraken' }), syncMode: 'resuming' },
        ],
        batchEventBus,
        database: {
          importSessions: {
            findLatestIncomplete: failedSessionLookup,
          },
        } as never,
        runtime,
      });

      expect(assertOk(result)).toEqual({
        accounts: [
          {
            account: {
              accountType: 'blockchain',
              id: 1,
              name: 'kraken-main',
              platformKey: 'kraken',
            },
            counts: { imported: 7, skipped: 2 },
            errorMessage: 'network timeout',
            status: 'failed',
            syncMode: 'resuming',
          },
        ],
        failedCount: 1,
        totalCount: 1,
      });
      expect(failedSessionLookup).toHaveBeenCalledWith(1);
      expect(emittedEvents.map((event) => event.type)).toEqual(['batch.account.started', 'batch.account.failed']);
    });
  });

  describe('batch runtime', () => {
    it('should emit lifecycle events, stop the presentation, and return the batch summary', async () => {
      mockImportWorkflow.execute.mockResolvedValueOnce(
        ok({ sessions: [makeSession({ accountId: 7, transactionsImported: 5, transactionsSkipped: 2 })] })
      );

      const batchEventBus = new EventBus<BatchImportMonitorEvent>({
        onError: vi.fn(),
      });
      const emittedEvents: { type: string }[] = [];
      batchEventBus.subscribe((event) => {
        emittedEvents.push(event as { type: string });
      });
      const batchPresentation = {
        abort: vi.fn(),
        fail: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
        unsubscribe: vi.fn(),
      };

      const batchRuntime = await createBatchImportRuntime({
        batchEventBus,
        database: {
          importSessions: {
            findLatestIncomplete: vi.fn(),
          },
        } as never,
        format: 'json',
        infra: {
          blockchainProviderRuntime: {} as never,
          eventBus: {} as never,
          instrumentation: mockInstrumentation as never,
        },
        presentation: batchPresentation,
        profileDisplayName: 'business',
        registry: mockRegistry as unknown as AdapterRegistry,
        runtime,
      });

      const result = await batchRuntime.run([
        {
          account: makeAccount({
            accountType: 'exchange-api',
            id: 7,
            name: 'kraken-main',
            platformKey: 'kraken',
          }),
          syncMode: 'incremental',
        },
      ]);

      expect(assertOk(result)).toEqual({
        accounts: [
          {
            account: {
              accountType: 'exchange-api',
              id: 7,
              name: 'kraken-main',
              platformKey: 'kraken',
            },
            counts: { imported: 5, skipped: 2 },
            status: 'completed',
            syncMode: 'incremental',
          },
        ],
        failedCount: 0,
        profileDisplayName: 'business',
        runStats: { totalRequests: 0 },
        totalCount: 1,
      });
      expect(emittedEvents.map((event) => event.type)).toEqual([
        'batch.started',
        'batch.account.started',
        'batch.account.completed',
        'batch.completed',
      ]);
      expect(batchPresentation.fail).not.toHaveBeenCalled();
      expect(batchPresentation.stop).toHaveBeenCalledOnce();

      batchRuntime.cleanup();
      expect(batchPresentation.unsubscribe).toHaveBeenCalledOnce();
    });

    it('should fail and stop the presentation when batch execution returns an error', async () => {
      mockImportWorkflow.execute.mockResolvedValueOnce(err(new Error('network timeout')));
      const failedSessionLookup = vi.fn().mockResolvedValueOnce(err(new Error('failed-session lookup failed')));
      const batchPresentation = {
        abort: vi.fn(),
        fail: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
        unsubscribe: vi.fn(),
      };

      const batchRuntime = await createBatchImportRuntime({
        database: {
          importSessions: {
            findLatestIncomplete: failedSessionLookup,
          },
        } as never,
        format: 'json',
        infra: {
          blockchainProviderRuntime: {} as never,
          eventBus: {} as never,
          instrumentation: mockInstrumentation as never,
        },
        presentation: batchPresentation,
        profileDisplayName: 'business',
        registry: mockRegistry as unknown as AdapterRegistry,
        runtime,
      });

      const result = await batchRuntime.run([
        {
          account: makeAccount({
            id: 7,
            name: 'kraken-main',
            platformKey: 'kraken',
          }),
          syncMode: 'resuming',
        },
      ]);

      const error = assertErr(result);
      expect(error.message).toBe('failed-session lookup failed');
      expect(batchPresentation.fail).toHaveBeenCalledWith('failed-session lookup failed');
      expect(batchPresentation.stop).toHaveBeenCalledOnce();
    });

    it('should abort the import workflow and presentation together', async () => {
      const batchPresentation = {
        abort: vi.fn(),
        fail: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
        unsubscribe: vi.fn(),
      };

      const batchRuntime = await createBatchImportRuntime({
        database: {
          importSessions: {
            findLatestIncomplete: vi.fn(),
          },
        } as never,
        format: 'json',
        infra: {
          blockchainProviderRuntime: {} as never,
          eventBus: {} as never,
          instrumentation: mockInstrumentation as never,
        },
        presentation: batchPresentation,
        profileDisplayName: 'business',
        registry: mockRegistry as unknown as AdapterRegistry,
        runtime,
      });

      batchRuntime.abort();

      expect(mockImportWorkflow.abort).toHaveBeenCalledOnce();
      expect(batchPresentation.abort).toHaveBeenCalledOnce();
      expect(batchPresentation.stop).toHaveBeenCalledOnce();
    });
  });
});
