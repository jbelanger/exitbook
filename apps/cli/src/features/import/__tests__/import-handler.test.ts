import type { AdapterRegistry, ImportCoordinator, ImportParams, RawDataProcessingService } from '@exitbook/ingestion';
import { err, ok } from 'neverthrow';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { ImportHandler } from '../import-handler.js';

vi.mock('@exitbook/blockchain-providers', () => ({
  BlockchainProviderManager: vi.fn().mockImplementation(() => ({
    destroy: vi.fn(),
  })),
  createProviderRegistry: vi.fn(),
  loadExplorerConfig: vi.fn(),
}));

vi.mock('@exitbook/ingestion', () => ({
  ImportSessionRepository: vi.fn(),
  ImportCoordinator: vi.fn(),
  RawTransactionRepository: vi.fn(),
  TokenMetadataService: vi.fn(),
  RawDataProcessingService: vi.fn(),
  createTransactionQueries: vi.fn(),
  isUtxoAdapter: vi.fn(),
}));

vi.mock('@exitbook/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exitbook/data')>();
  return {
    ...actual,
    createUserQueries: vi.fn(),
    TokenMetadataQueries: vi.fn(),
  };
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

describe('ImportHandler', () => {
  let mockImportCoordinator: Partial<ImportCoordinator>;
  let mockProcessService: Partial<RawDataProcessingService>;
  let mockRegistry: { getBlockchain: Mock };
  let mockIngestionMonitor: { abort: Mock; fail: Mock; stop: Mock };
  let mockInstrumentation: { getSummary: Mock };
  let handler: ImportHandler;

  beforeEach(() => {
    vi.clearAllMocks();

    mockImportCoordinator = {
      importBlockchain: vi.fn(),
      importExchangeApi: vi.fn(),
      importExchangeCsv: vi.fn(),
    };

    mockProcessService = {
      processAccountTransactions: vi.fn(),
      processImportedSessions: vi.fn().mockResolvedValue(ok({ processed: 50, errors: [] })),
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

    handler = new ImportHandler(
      mockImportCoordinator as ImportCoordinator,
      mockProcessService as RawDataProcessingService,
      mockRegistry as unknown as AdapterRegistry,
      mockIngestionMonitor as never,
      mockInstrumentation as never
    );
  });

  describe('execute — import stage', () => {
    it('should successfully import blockchain data', async () => {
      const session = makeSession({ transactionsImported: 50 });
      (mockImportCoordinator.importBlockchain as Mock).mockResolvedValue(ok(session));

      const params: ImportParams = {
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qtest',
      };

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().sessions).toEqual([session]);
      expect(mockImportCoordinator.importBlockchain).toHaveBeenCalledWith('bitcoin', 'bc1qtest', undefined, undefined);
      expect(mockIngestionMonitor.stop).toHaveBeenCalledOnce();
    });

    it('should successfully import exchange data from CSV', async () => {
      const session = makeSession({ id: 456, accountId: 2, transactionsImported: 100 });
      (mockImportCoordinator.importExchangeCsv as Mock).mockResolvedValue(ok(session));

      const params: ImportParams = {
        sourceName: 'kraken',
        sourceType: 'exchange-csv',
        csvDirectory: './data/kraken',
      };

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().sessions).toEqual([session]);
      expect(mockImportCoordinator.importExchangeCsv).toHaveBeenCalledWith('kraken', './data/kraken');
    });

    it('should successfully import exchange data from API', async () => {
      const session = makeSession({ id: 789, accountId: 3, transactionsImported: 75 });
      (mockImportCoordinator.importExchangeApi as Mock).mockResolvedValue(ok(session));

      const params: ImportParams = {
        sourceName: 'kucoin',
        sourceType: 'exchange-api',
        credentials: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
          apiPassphrase: 'test-passphrase',
        },
      };

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().sessions).toEqual([session]);
      expect(mockImportCoordinator.importExchangeApi).toHaveBeenCalledWith('kucoin', {
        apiKey: 'test-key',
        apiSecret: 'test-secret',
        apiPassphrase: 'test-passphrase',
      });
    });

    it('should fail when import sessions are not completed', async () => {
      (mockImportCoordinator.importBlockchain as Mock).mockResolvedValue(ok(makeSession({ status: 'failed' })));

      const result = await handler.execute({
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qtest',
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('not complete');
      expect(mockIngestionMonitor.fail).toHaveBeenCalledOnce();
      expect(mockIngestionMonitor.stop).toHaveBeenCalledOnce();
    });

    it('should return error when import fails', async () => {
      const importError = new Error('Import failed: network timeout');
      (mockImportCoordinator.importBlockchain as Mock).mockResolvedValue(err(importError));

      const result = await handler.execute({
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qtest',
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toBe(importError);
      expect(mockIngestionMonitor.fail).toHaveBeenCalledOnce();
    });
  });

  describe('execute — process stage', () => {
    const successfulImportSession = makeSession();

    beforeEach(() => {
      (mockImportCoordinator.importBlockchain as Mock).mockResolvedValue(ok(successfulImportSession));
    });

    const params: ImportParams = {
      sourceName: 'bitcoin',
      sourceType: 'blockchain',
      address: 'bc1qtest',
    };

    it('should process imported transactions', async () => {
      (mockProcessService.processImportedSessions as Mock).mockResolvedValue(ok({ processed: 50, errors: [] }));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchObject({
        processed: 50,
        processingErrors: [],
        runStats: { totalRequests: 0 },
      });
      expect(mockProcessService.processImportedSessions).toHaveBeenCalledWith([1]);
    });

    it('should return processing errors when present', async () => {
      const processingErrors = ['Error 1', 'Error 2', 'Error 3'];
      (mockProcessService.processImportedSessions as Mock).mockResolvedValue(
        ok({ processed: 47, errors: processingErrors })
      );

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchObject({
        processed: 47,
        processingErrors,
      });
    });

    it('should return error when processing fails', async () => {
      const processingError = new Error('Processing failed');
      (mockProcessService.processImportedSessions as Mock).mockResolvedValue(err(processingError));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toBe(processingError);
      expect(mockIngestionMonitor.fail).toHaveBeenCalledOnce();
    });

    it('should call processImportedSessions even when no transactions were imported', async () => {
      (mockImportCoordinator.importBlockchain as Mock).mockResolvedValue(ok(makeSession({ transactionsImported: 0 })));
      (mockProcessService.processImportedSessions as Mock).mockResolvedValue(ok({ processed: 0, errors: [] }));

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchObject({ processed: 0, processingErrors: [] });
      expect(mockProcessService.processImportedSessions).toHaveBeenCalledWith([1]);
    });
  });
});
