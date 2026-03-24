import { err, ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import type { AdapterRegistry, ImportParams, ImportWorkflow } from '@exitbook/ingestion';
import { isUtxoAdapter } from '@exitbook/ingestion';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { abortImportRuntime, executeImportWithRuntime, type ImportExecutionRuntime } from '../import-handler.js';

vi.mock('@exitbook/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('@exitbook/ingestion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exitbook/ingestion')>();
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

describe('import runner helpers', () => {
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

    // Registry returns Err for all lookups — xpub warning path is skipped
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
      importWorkflow: mockImportWorkflow as unknown as ImportWorkflow,
      registry: mockRegistry as unknown as AdapterRegistry,
      ingestionMonitor: mockIngestionMonitor as never,
      instrumentation: mockInstrumentation as never,
    };
  });

  describe('execute — import stage', () => {
    it('should successfully import blockchain data', async () => {
      const session = makeSession({ transactionsImported: 50 });
      mockImportWorkflow.execute.mockResolvedValue(ok({ sessions: [session] }));

      const params: ImportParams = {
        blockchain: 'bitcoin',
        address: 'bc1qtest',
      };

      const result = await executeImportWithRuntime(runtime, params);

      const importResult = assertOk(result);
      expect(importResult.sessions).toEqual([session]);
      expect(mockImportWorkflow.execute).toHaveBeenCalledWith(params);
      expect(mockIngestionMonitor.stop).toHaveBeenCalledOnce();
    });

    it('should successfully import exchange data from CSV', async () => {
      const session = makeSession({ id: 456, accountId: 2, transactionsImported: 100 });
      mockImportWorkflow.execute.mockResolvedValue(ok({ sessions: [session] }));

      const params: ImportParams = {
        exchange: 'kraken',
        csvDir: './data/kraken',
      };

      const result = await executeImportWithRuntime(runtime, params);

      const importResult = assertOk(result);
      expect(importResult.sessions).toEqual([session]);
      expect(mockImportWorkflow.execute).toHaveBeenCalledWith(params);
    });

    it('should successfully import exchange data from API', async () => {
      const session = makeSession({ id: 789, accountId: 3, transactionsImported: 75 });
      mockImportWorkflow.execute.mockResolvedValue(ok({ sessions: [session] }));

      const params: ImportParams = {
        exchange: 'kucoin',
        credentials: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
          apiPassphrase: 'test-passphrase',
        },
      };

      const result = await executeImportWithRuntime(runtime, params);

      const importResult = assertOk(result);
      expect(importResult.sessions).toEqual([session]);
      expect(mockImportWorkflow.execute).toHaveBeenCalledWith(params);
    });

    it('should fail when import sessions are not completed', async () => {
      mockImportWorkflow.execute.mockResolvedValue(ok({ sessions: [makeSession({ status: 'failed' })] }));

      const result = await executeImportWithRuntime(runtime, {
        blockchain: 'bitcoin',
        address: 'bc1qtest',
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
        blockchain: 'bitcoin',
        address: 'bc1qtest',
      });

      const error = assertErr(result);
      expect(error).toBe(importError);
      expect(mockIngestionMonitor.fail).toHaveBeenCalledOnce();
    });
  });

  describe('execute — xpub single-address warning', () => {
    it('should show warning for UTXO single-address import and abort on decline', async () => {
      // Registry returns a UTXO adapter
      const mockAdapter = { isExtendedPublicKey: vi.fn().mockReturnValue(false) };
      mockRegistry.getBlockchain.mockReturnValue(ok(mockAdapter));
      vi.mocked(isUtxoAdapter).mockReturnValue(true);

      const onSingleAddressWarning = vi.fn().mockResolvedValue(false); // User declines

      const result = await executeImportWithRuntime(runtime, {
        blockchain: 'bitcoin',
        address: 'bc1qtest',
        onSingleAddressWarning,
      });

      const error = assertErr(result);
      expect(error.message).toContain('cancelled');
      expect(onSingleAddressWarning).toHaveBeenCalled();
      expect(mockImportWorkflow.execute).not.toHaveBeenCalled();
    });

    it('should proceed when user accepts single-address warning', async () => {
      const mockAdapter = { isExtendedPublicKey: vi.fn().mockReturnValue(false) };
      mockRegistry.getBlockchain.mockReturnValue(ok(mockAdapter));
      vi.mocked(isUtxoAdapter).mockReturnValue(true);

      const session = makeSession();
      mockImportWorkflow.execute.mockResolvedValue(ok({ sessions: [session] }));

      const onSingleAddressWarning = vi.fn().mockResolvedValue(true);

      const result = await executeImportWithRuntime(runtime, {
        blockchain: 'bitcoin',
        address: 'bc1qtest',
        onSingleAddressWarning,
      });

      expect(result.isOk()).toBe(true);
      expect(mockImportWorkflow.execute).toHaveBeenCalled();
    });

    it('should skip warning for xpub addresses', async () => {
      const mockAdapter = { isExtendedPublicKey: vi.fn().mockReturnValue(true) };
      mockRegistry.getBlockchain.mockReturnValue(ok(mockAdapter));
      vi.mocked(isUtxoAdapter).mockReturnValue(true);

      const session = makeSession();
      mockImportWorkflow.execute.mockResolvedValue(ok({ sessions: [session] }));

      const onSingleAddressWarning = vi.fn();

      const result = await executeImportWithRuntime(runtime, {
        blockchain: 'bitcoin',
        address: 'xpub6C...',
        onSingleAddressWarning,
      });

      expect(result.isOk()).toBe(true);
      expect(onSingleAddressWarning).not.toHaveBeenCalled();
    });
  });

  describe('abort', () => {
    it('should delegate abort to ImportWorkflow and monitor', () => {
      abortImportRuntime(runtime);

      expect(mockImportWorkflow.abort).toHaveBeenCalledOnce();
      expect(mockIngestionMonitor.abort).toHaveBeenCalledOnce();
    });
  });
});
