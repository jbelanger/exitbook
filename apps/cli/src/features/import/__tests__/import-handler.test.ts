import type { KyselyDB } from '@exitbook/data';
import type { TransactionImportService, TransactionProcessService } from '@exitbook/ingestion';
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

vi.mock('@exitbook/ingestion', () => ({
  ImporterFactory: vi.fn(),
  DataSourceRepository: vi.fn(),
  ProcessorFactory: vi.fn(),
  RawDataRepository: vi.fn(),
  TransactionImportService: vi.fn(),
  TransactionProcessService: vi.fn(),
  TransactionRepository: vi.fn(),
}));

describe('ImportHandler', () => {
  let mockDatabase: KyselyDB;
  let mockImportService: Partial<TransactionImportService>;
  let mockProcessService: Partial<TransactionProcessService>;
  let handler: ImportHandler;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock database
    mockDatabase = {} as KyselyDB;

    // Mock import and process services
    mockImportService = {
      importFromSource: vi.fn(),
    };

    mockProcessService = {
      processRawDataToTransactions: vi.fn(),
    };

    // Setup service mocks to return our mock instances
    const { TransactionImportService, TransactionProcessService } = await import('@exitbook/ingestion');
    (TransactionImportService as unknown as Mock).mockImplementation(() => mockImportService);
    (TransactionProcessService as unknown as Mock).mockImplementation(() => mockProcessService);

    handler = new ImportHandler(mockDatabase);
  });

  describe('execute', () => {
    it('should successfully import blockchain data', async () => {
      const params: ImportHandlerParams = {
        sourceName: 'bitcoin',
        sourceType: 'blockchain',
        address: 'bc1qtest',
      };

      (mockImportService.importFromSource as Mock).mockResolvedValue(
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

      expect(mockImportService.importFromSource).toHaveBeenCalledWith('bitcoin', 'blockchain', {
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

      (mockImportService.importFromSource as Mock).mockResolvedValue(
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

      expect(mockImportService.importFromSource).toHaveBeenCalledWith('kraken', 'exchange', {
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

      (mockImportService.importFromSource as Mock).mockResolvedValue(
        ok({
          dataSourceId: 789,
          imported: 75,
        })
      );

      const result = await handler.execute(params);

      expect(result.isOk()).toBe(true);
      expect(mockImportService.importFromSource).toHaveBeenCalledWith('kucoin', 'exchange', {
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

      (mockImportService.importFromSource as Mock).mockResolvedValue(
        ok({
          dataSourceId: 123,
          imported: 50,
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
        dataSourceId: 123,
        imported: 50,
        processed: 50,
        processingErrors: [],
      });

      expect(mockProcessService.processRawDataToTransactions).toHaveBeenCalledWith('bitcoin', 'blockchain', {
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

      (mockImportService.importFromSource as Mock).mockResolvedValue(
        ok({
          dataSourceId: 123,
          imported: 50,
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
      (mockImportService.importFromSource as Mock).mockResolvedValue(err(importError));

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

      (mockImportService.importFromSource as Mock).mockResolvedValue(
        ok({
          dataSourceId: 123,
          imported: 50,
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
