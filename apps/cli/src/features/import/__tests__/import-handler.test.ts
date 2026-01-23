/* eslint-disable @typescript-eslint/no-unsafe-assignment -- acceptable for tests */
import type { ImportOrchestrator, ImportParams, TransactionProcessService } from '@exitbook/ingestion';
import { err, ok } from 'neverthrow';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { ImportHandler } from '../import-handler.js';

// Mock dependencies
vi.mock('@exitbook/blockchain-providers', () => ({
  BlockchainProviderManager: vi.fn().mockImplementation(() => ({
    destroy: vi.fn(),
  })),
  initializeProviders: vi.fn(),
  loadExplorerConfig: vi.fn(),
}));

vi.mock('@exitbook/ingestion', () => ({
  ImportSessionRepository: vi.fn(),
  ImportOrchestrator: vi.fn(),
  RawDataRepository: vi.fn(),
  TokenMetadataService: vi.fn(),
  TransactionProcessService: vi.fn(),
  TransactionRepository: vi.fn(),
  getBlockchainAdapter: vi.fn(),
}));

vi.mock('@exitbook/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exitbook/data')>();
  return {
    ...actual,
    UserRepository: vi.fn(),
    AccountRepository: vi.fn(),
    TokenMetadataRepository: vi.fn(),
  };
});

describe('ImportHandler', () => {
  let mockImportOrchestrator: Partial<ImportOrchestrator>;
  let mockProcessService: Partial<TransactionProcessService>;
  let mockProviderManager: { destroy: Mock };
  let handler: ImportHandler;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock import orchestrator and process service
    mockImportOrchestrator = {
      importBlockchain: vi.fn(),
      importExchangeApi: vi.fn(),
      importExchangeCsv: vi.fn(),
    };

    mockProcessService = {
      processAccountTransactions: vi.fn(),
    };

    mockProviderManager = {
      destroy: vi.fn(),
    };

    handler = new ImportHandler(
      mockImportOrchestrator as ImportOrchestrator,
      mockProcessService as TransactionProcessService,
      mockProviderManager as unknown
    );
  });

  describe('executeImport', () => {
    it('should successfully import blockchain data', async () => {
      const params: ImportParams = {
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qtest',
      };

      (mockImportOrchestrator.importBlockchain as Mock).mockResolvedValue(
        ok({
          id: 123,
          accountId: 1,
          status: 'completed',
          startedAt: new Date(),
          transactionsImported: 50,
          transactionsSkipped: 0,
          createdAt: new Date(),
        })
      );

      const result = await handler.executeImport(params);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        sessions: [
          {
            id: 123,
            accountId: 1,
            status: 'completed',
            startedAt: expect.any(Date),
            transactionsImported: 50,
            transactionsSkipped: 0,
            createdAt: expect.any(Date),
          },
        ],
      });

      expect(mockImportOrchestrator.importBlockchain).toHaveBeenCalledWith('bitcoin', 'bc1qtest', undefined, undefined);
    });

    it('should successfully import exchange data from CSV', async () => {
      const params: ImportParams = {
        sourceName: 'kraken',
        sourceType: 'exchange-csv',
        csvDirectory: './data/kraken',
      };

      (mockImportOrchestrator.importExchangeCsv as Mock).mockResolvedValue(
        ok({
          id: 456,
          accountId: 2,
          status: 'completed',
          startedAt: new Date(),
          transactionsImported: 100,
          transactionsSkipped: 0,
          createdAt: new Date(),
        })
      );

      const result = await handler.executeImport(params);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        sessions: [
          {
            id: 456,
            accountId: 2,
            status: 'completed',
            startedAt: expect.any(Date),
            transactionsImported: 100,
            transactionsSkipped: 0,
            createdAt: expect.any(Date),
          },
        ],
      });

      expect(mockImportOrchestrator.importExchangeCsv).toHaveBeenCalledWith('kraken', './data/kraken');
    });

    it('should successfully import exchange data from API', async () => {
      const params: ImportParams = {
        sourceName: 'kucoin',
        sourceType: 'exchange-api',
        credentials: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
          apiPassphrase: 'test-passphrase',
        },
      };

      (mockImportOrchestrator.importExchangeApi as Mock).mockResolvedValue(
        ok({
          id: 789,
          accountId: 3,
          status: 'completed',
          startedAt: new Date(),
          transactionsImported: 75,
          transactionsSkipped: 0,
          createdAt: new Date(),
        })
      );

      const result = await handler.executeImport(params);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        sessions: [
          {
            id: 789,
            accountId: 3,
            status: 'completed',
            startedAt: expect.any(Date),
            transactionsImported: 75,
            transactionsSkipped: 0,
            createdAt: expect.any(Date),
          },
        ],
      });

      expect(mockImportOrchestrator.importExchangeApi).toHaveBeenCalledWith('kucoin', {
        apiKey: 'test-key',
        apiSecret: 'test-secret',
        apiPassphrase: 'test-passphrase',
      });
    });

    it('should fail when import sessions are not completed', async () => {
      const params: ImportParams = {
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qtest',
      };

      (mockImportOrchestrator.importBlockchain as Mock).mockResolvedValue(
        ok({
          id: 123,
          accountId: 1,
          status: 'failed',
          startedAt: new Date(),
          transactionsImported: 10,
          transactionsSkipped: 0,
          createdAt: new Date(),
        })
      );

      const result = await handler.executeImport(params);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('not complete');
      }
    });

    it('should return error when import fails', async () => {
      const params: ImportParams = {
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qtest',
      };

      const importError = new Error('Import failed: network timeout');
      (mockImportOrchestrator.importBlockchain as Mock).mockResolvedValue(err(importError));

      const result = await handler.executeImport(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toBe(importError);
    });
  });

  describe('processImportedSessions', () => {
    it('should process imported transactions', async () => {
      const sessions = [
        {
          id: 123,
          accountId: 1,
          status: 'completed' as const,
          startedAt: new Date(),
          transactionsImported: 50,
          transactionsSkipped: 0,
          createdAt: new Date(),
        },
      ];

      (mockProcessService.processAccountTransactions as Mock).mockResolvedValue(
        ok({
          processed: 50,
          errors: [],
        })
      );

      const result = await handler.processImportedSessions(sessions);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        processed: 50,
        processingErrors: [],
      });

      expect(mockProcessService.processAccountTransactions).toHaveBeenCalledWith(1);
    });

    it('should return processing errors when present', async () => {
      const sessions = [
        {
          id: 123,
          accountId: 1,
          status: 'completed' as const,
          startedAt: new Date(),
          transactionsImported: 50,
          transactionsSkipped: 0,
          createdAt: new Date(),
        },
      ];

      const processingErrors = ['Error 1', 'Error 2', 'Error 3'];
      (mockProcessService.processAccountTransactions as Mock).mockResolvedValue(
        ok({
          processed: 47,
          errors: processingErrors,
        })
      );

      const result = await handler.processImportedSessions(sessions);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        processed: 47,
        processingErrors,
      });
    });

    it('should return error when processing fails', async () => {
      const sessions = [
        {
          id: 123,
          accountId: 1,
          status: 'completed' as const,
          startedAt: new Date(),
          transactionsImported: 50,
          transactionsSkipped: 0,
          createdAt: new Date(),
        },
      ];

      const processingError = new Error('Processing failed');
      (mockProcessService.processAccountTransactions as Mock).mockResolvedValue(err(processingError));

      const result = await handler.processImportedSessions(sessions);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toBe(processingError);
    });

    it('should skip processing when no transactions imported', async () => {
      const sessions = [
        {
          id: 123,
          accountId: 1,
          status: 'completed' as const,
          startedAt: new Date(),
          transactionsImported: 0,
          transactionsSkipped: 0,
          createdAt: new Date(),
        },
      ];

      const result = await handler.processImportedSessions(sessions);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        processed: 0,
        processingErrors: [],
      });

      expect(mockProcessService.processAccountTransactions).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should call providerManager.destroy', () => {
      handler.destroy();

      expect(mockProviderManager.destroy).toHaveBeenCalled();
    });
  });
});
