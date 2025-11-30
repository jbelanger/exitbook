import type { ImportOrchestrator, TransactionProcessService } from '@exitbook/ingestion';
import { err, ok } from 'neverthrow';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import type { ImportHandlerParams } from '../import-handler.js';
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
  DataSourceRepository: vi.fn(),
  ImportOrchestrator: vi.fn(),
  RawDataRepository: vi.fn(),
  TokenMetadataService: vi.fn(),
  TransactionProcessService: vi.fn(),
  TransactionRepository: vi.fn(),
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
      processRawDataToTransactions: vi.fn(),
    };

    handler = new ImportHandler(
      mockImportOrchestrator as ImportOrchestrator,
      mockProcessService as TransactionProcessService
    );
  });

  describe('execute', () => {
    it('should successfully import blockchain data', async () => {
      const params: ImportHandlerParams = {
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qtest',
      };

      (mockImportOrchestrator.importBlockchain as Mock).mockResolvedValue(
        ok({
          importSessionId: 123,
          transactionsImported: 50,
        })
      );

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        importSessionId: 123,
        imported: 50,
      });

      expect(mockImportOrchestrator.importBlockchain).toHaveBeenCalledWith('bitcoin', 'bc1qtest', undefined, undefined);
    });

    it('should successfully import exchange data from CSV', async () => {
      const params: ImportHandlerParams = {
        sourceName: 'kraken',
        sourceType: 'exchange',
        csvDir: './data/kraken',
      };

      (mockImportOrchestrator.importExchangeCsv as Mock).mockResolvedValue(
        ok({
          importSessionId: 456,
          transactionsImported: 100,
        })
      );

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        importSessionId: 456,
        imported: 100,
      });

      expect(mockImportOrchestrator.importExchangeCsv).toHaveBeenCalledWith('kraken', ['./data/kraken']);
    });

    it('should successfully import exchange data from API', async () => {
      const params: ImportHandlerParams = {
        sourceName: 'kucoin',
        sourceType: 'exchange',
        credentials: {
          apiKey: 'test-key',
          secret: 'test-secret',
          apiPassphrase: 'test-passphrase',
        },
      };

      (mockImportOrchestrator.importExchangeApi as Mock).mockResolvedValue(
        ok({
          importSessionId: 789,
          transactionsImported: 75,
        })
      );

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockImportOrchestrator.importExchangeApi).toHaveBeenCalledWith('kucoin', {
        apiKey: 'test-key',
        secret: 'test-secret',
        passphrase: 'test-passphrase',
      });
    });

    it('should process data when shouldProcess is true', async () => {
      const params: ImportHandlerParams = {
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qtest',
        shouldProcess: true,
      };

      (mockImportOrchestrator.importBlockchain as Mock).mockResolvedValue(
        ok({
          importSessionId: 123,
          transactionsImported: 50,
        })
      );

      (mockProcessService.processRawDataToTransactions as Mock).mockResolvedValue(
        ok({
          processed: 50,
          errors: [],
        })
      );

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        importSessionId: 123,
        imported: 50,
        processed: 50,
        processingErrors: [],
      });

      expect(mockProcessService.processRawDataToTransactions).toHaveBeenCalledWith('bitcoin', 'blockchain', {
        importSessionId: 123,
      });
    });

    it('should return processing errors when present', async () => {
      const params: ImportHandlerParams = {
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qtest',
        shouldProcess: true,
      };

      (mockImportOrchestrator.importBlockchain as Mock).mockResolvedValue(
        ok({
          importSessionId: 123,
          transactionsImported: 50,
        })
      );

      const processingErrors = ['Error 1', 'Error 2', 'Error 3'];
      (mockProcessService.processRawDataToTransactions as Mock).mockResolvedValue(
        ok({
          processed: 47,
          errors: processingErrors,
        })
      );

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        importSessionId: 123,
        imported: 50,
        processed: 47,
        processingErrors,
      });
    });

    it('should return error when import fails', async () => {
      const params: ImportHandlerParams = {
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qtest',
      };

      const importError = new Error('Import failed: network timeout');
      (mockImportOrchestrator.importBlockchain as Mock).mockResolvedValue(err(importError));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toBe(importError);
    });

    it('should return error when processing fails', async () => {
      const params: ImportHandlerParams = {
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qtest',
        shouldProcess: true,
      };

      (mockImportOrchestrator.importBlockchain as Mock).mockResolvedValue(
        ok({
          importSessionId: 123,
          transactionsImported: 50,
        })
      );

      const processingError = new Error('Processing failed');
      (mockProcessService.processRawDataToTransactions as Mock).mockResolvedValue(err(processingError));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toBe(processingError);
    });
  });

  describe('destroy', () => {
    it('should call providerManager.destroy', async () => {
      const { BlockchainProviderManager } = await import('@exitbook/blockchain-providers');
      const mockDestroy = vi.fn();
      (BlockchainProviderManager as unknown as Mock).mockImplementation(() => ({
        destroy: mockDestroy,
      }));

      const newHandler = new ImportHandler(
        mockImportOrchestrator as ImportOrchestrator,
        mockProcessService as TransactionProcessService
      );
      newHandler.destroy();

      expect(mockDestroy).toHaveBeenCalled();
    });
  });
});
