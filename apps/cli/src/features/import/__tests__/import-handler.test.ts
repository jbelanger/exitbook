import type { KyselyDB } from '@exitbook/data';
import type { TransactionIngestionService } from '@exitbook/import';
import { err, ok } from 'neverthrow';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import type { ImportHandlerParams } from '../import-handler.ts';
import { ImportHandler } from '../import-handler.ts';

// Mock dependencies
vi.mock('@exitbook/providers', () => ({
  BlockchainProviderManager: vi.fn().mockImplementation(() => ({
    destroy: vi.fn(),
  })),
  initializeProviders: vi.fn(),
  loadExplorerConfig: vi.fn(),
}));

vi.mock('@exitbook/import', () => ({
  ImporterFactory: vi.fn(),
  DataSourceRepository: vi.fn(),
  ProcessorFactory: vi.fn(),
  RawDataRepository: vi.fn(),
  TransactionIngestionService: vi.fn(),
  TransactionRepository: vi.fn(),
}));

describe('ImportHandler', () => {
  let mockDatabase: KyselyDB;
  let mockIngestionService: Partial<TransactionIngestionService>;
  let handler: ImportHandler;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock database
    mockDatabase = {} as KyselyDB;

    // Mock ingestion service
    mockIngestionService = {
      importFromSource: vi.fn(),
      processRawDataToTransactions: vi.fn(),
    };

    // Setup TransactionIngestionService mock to return our mock instance
    const { TransactionIngestionService } = await import('@exitbook/import');
    (TransactionIngestionService as unknown as Mock).mockImplementation(() => mockIngestionService);

    handler = new ImportHandler(mockDatabase);
  });

  describe('execute', () => {
    it('should successfully import blockchain data', async () => {
      const params: ImportHandlerParams = {
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qtest',
      };

      (mockIngestionService.importFromSource as Mock).mockResolvedValue(
        ok({
          dataSourceId: 123,
          imported: 50,
        })
      );

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        dataSourceId: 123,
        imported: 50,
      });

      expect(mockIngestionService.importFromSource).toHaveBeenCalledWith('bitcoin', 'blockchain', {
        address: 'bc1qtest',
        providerId: undefined,
      });
    });

    it('should successfully import exchange data from CSV', async () => {
      const params: ImportHandlerParams = {
        sourceName: 'kraken',
        sourceType: 'exchange',
        csvDir: './data/kraken',
      };

      (mockIngestionService.importFromSource as Mock).mockResolvedValue(
        ok({
          dataSourceId: 456,
          imported: 100,
        })
      );

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        dataSourceId: 456,
        imported: 100,
      });

      expect(mockIngestionService.importFromSource).toHaveBeenCalledWith('kraken', 'exchange', {
        csvDirectories: ['./data/kraken'],
      });
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

      (mockIngestionService.importFromSource as Mock).mockResolvedValue(
        ok({
          dataSourceId: 789,
          imported: 75,
        })
      );

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockIngestionService.importFromSource).toHaveBeenCalledWith('kucoin', 'exchange', {
        credentials: {
          apiKey: 'test-key',
          secret: 'test-secret',
          passphrase: 'test-passphrase',
        },
      });
    });

    it('should process data when shouldProcess is true', async () => {
      const params: ImportHandlerParams = {
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qtest',
        shouldProcess: true,
      };

      (mockIngestionService.importFromSource as Mock).mockResolvedValue(
        ok({
          dataSourceId: 123,
          imported: 50,
        })
      );

      (mockIngestionService.processRawDataToTransactions as Mock).mockResolvedValue(
        ok({
          processed: 50,
          errors: [],
        })
      );

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        dataSourceId: 123,
        imported: 50,
        processed: 50,
        processingErrors: [],
      });

      expect(mockIngestionService.processRawDataToTransactions).toHaveBeenCalledWith('bitcoin', 'blockchain', {
        dataSourceId: 123,
      });
    });

    it('should return processing errors when present', async () => {
      const params: ImportHandlerParams = {
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qtest',
        shouldProcess: true,
      };

      (mockIngestionService.importFromSource as Mock).mockResolvedValue(
        ok({
          dataSourceId: 123,
          imported: 50,
        })
      );

      const processingErrors = ['Error 1', 'Error 2', 'Error 3'];
      (mockIngestionService.processRawDataToTransactions as Mock).mockResolvedValue(
        ok({
          processed: 47,
          errors: processingErrors,
        })
      );

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        dataSourceId: 123,
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
      (mockIngestionService.importFromSource as Mock).mockResolvedValue(err(importError));

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

      (mockIngestionService.importFromSource as Mock).mockResolvedValue(
        ok({
          dataSourceId: 123,
          imported: 50,
        })
      );

      const processingError = new Error('Processing failed');
      (mockIngestionService.processRawDataToTransactions as Mock).mockResolvedValue(err(processingError));

      const result = await handler.execute(params);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toBe(processingError);
    });
  });

  describe('destroy', () => {
    it('should call providerManager.destroy', async () => {
      const { BlockchainProviderManager } = await import('@exitbook/providers');
      const mockDestroy = vi.fn();
      (BlockchainProviderManager as unknown as Mock).mockImplementation(() => ({
        destroy: mockDestroy,
      }));

      const newHandler = new ImportHandler(mockDatabase);
      newHandler.destroy();

      expect(mockDestroy).toHaveBeenCalled();
    });
  });
});
