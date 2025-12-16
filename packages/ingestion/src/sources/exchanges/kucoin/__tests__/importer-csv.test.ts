import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';

import { type Result } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { assertOk, consumeImportStream } from '../../../../shared/test-utils/importer-test-utils.js';
import type { ImportBatchResult, ImportParams } from '../../../../shared/types/importers.js';
import { KucoinCsvImporter } from '../importer-csv.js';

vi.mock('node:fs/promises');

/**
 * Create a mock Dirent object for testing
 */
function createMockDirent(name: string, isFile = true): Dirent {
  return {
    name,
    isFile: () => isFile,
    isDirectory: () => !isFile,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    parentPath: '',
    path: '',
  } as unknown as Dirent;
}

describe('KucoinCsvImporter - Streaming Import', () => {
  let importer: KucoinCsvImporter;
  const mockReaddir = vi.mocked(fs.readdir);
  const mockReadFile = vi.mocked(fs.readFile);

  beforeEach(() => {
    importer = new KucoinCsvImporter();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('successfully streams transactions from CSV file', async () => {
    mockReaddir.mockResolvedValue([createMockDirent('Spot Orders_Filled Orders.csv')] as unknown as Dirent<
      Buffer<ArrayBufferLike>
    >[]);

    const csvContent = `UID,Account Type,Order ID,Order Time(UTC),Symbol,Side,Order Type,Order Price,Order Amount,Avg. Filled Price,Filled Amount,Filled Volume,Filled Volume (USDT),Filled Time(UTC),Fee,Fee Currency,Tax,Status
user123,mainAccount,ORDER001,2024-01-01 10:00:00,BTC-USDT,buy,limit,42000.00,0.1,42000.00,0.1,4200.00,4200.00,2024-01-01 10:01:00,0.42,USDT,,deal`;

    mockReadFile.mockResolvedValue(csvContent);

    const params: ImportParams = {
      sourceName: 'kucoin',
      sourceType: 'exchange-csv' as const,
      csvDirectory: '/test/csv',
    };

    const result = await consumeImportStream(importer, params);

    const value = assertOk(result);
    expect(value.rawTransactions).toHaveLength(1);
    expect(Object.keys(value.cursorUpdates)).toHaveLength(1);
  });

  test('sets cursor metadata with file information', async () => {
    mockReaddir.mockResolvedValue([createMockDirent('Spot Orders_Filled Orders.csv')] as unknown as Dirent<
      Buffer<ArrayBufferLike>
    >[]);

    const csvContent = `UID,Account Type,Order ID,Order Time(UTC),Symbol,Side,Order Type,Order Price,Order Amount,Avg. Filled Price,Filled Amount,Filled Volume,Filled Volume (USDT),Filled Time(UTC),Fee,Fee Currency,Tax,Status
user123,mainAccount,ORDER001,2024-01-01 10:00:00,BTC-USDT,buy,limit,42000.00,0.1,42000.00,0.1,4200.00,4200.00,2024-01-01 10:01:00,0.42,USDT,,deal`;

    mockReadFile.mockResolvedValue(csvContent);

    const params: ImportParams = {
      sourceName: 'kucoin',
      sourceType: 'exchange-csv' as const,
      csvDirectory: '/test/csv',
    };

    const result = await consumeImportStream(importer, params);

    const value = assertOk(result);

    const cursorState = Object.values(value.cursorUpdates)[0];
    expect(cursorState).toBeDefined();
    expect(cursorState?.metadata).toBeDefined();
    expect(cursorState?.metadata?.providerName).toBe('kucoin');
    expect(cursorState?.metadata?.isComplete).toBe(true);
    expect(cursorState?.metadata?.fileName).toBe('Spot Orders_Filled Orders.csv');
    expect(cursorState?.metadata?.rowCount).toBe(1);
  });

  test('does not include legacy metadata in individual transactions', async () => {
    mockReaddir.mockResolvedValue([createMockDirent('Spot Orders_Filled Orders.csv')] as unknown as Dirent<
      Buffer<ArrayBufferLike>
    >[]);

    const csvContent = `UID,Account Type,Order ID,Order Time(UTC),Symbol,Side,Order Type,Order Price,Order Amount,Avg. Filled Price,Filled Amount,Filled Volume,Filled Volume (USDT),Filled Time(UTC),Fee,Fee Currency,Tax,Status
user123,mainAccount,ORDER001,2024-01-01 10:00:00,BTC-USDT,buy,limit,42000.00,0.1,42000.00,0.1,4200.00,4200.00,2024-01-01 10:01:00,0.42,USDT,,deal`;

    mockReadFile.mockResolvedValue(csvContent);

    const params: ImportParams = {
      sourceName: 'kucoin',
      sourceType: 'exchange-csv' as const,
      csvDirectory: '/test/csv',
    };

    const result = await consumeImportStream(importer, params);

    const value = assertOk(result);
    expect(value.rawTransactions).toHaveLength(1);
    const transaction = value.rawTransactions[0];

    // Verify transaction has standard fields but not legacy metadata
    expect('importMethod' in (transaction ?? {})).toBe(false);
    expect(transaction?.providerName).toBe('kucoin');
    expect(transaction?.transactionTypeHint).toBe('spot_order');
  });

  test('resumes from cursor and skips completed files', async () => {
    const completedFilePath = '/test/csv/Spot Orders_Filled Orders.csv';

    mockReaddir.mockResolvedValue([createMockDirent('Spot Orders_Filled Orders.csv')] as unknown as Dirent<
      Buffer<ArrayBufferLike>
    >[]);

    const params: ImportParams = {
      sourceName: 'kucoin',
      sourceType: 'exchange-csv' as const,
      csvDirectory: '/test/csv',
      cursor: {
        [`csv:kucoin:${completedFilePath}`]: {
          primary: {
            type: 'pageToken' as const,
            value: completedFilePath,
            providerName: 'kucoin',
          },
          lastTransactionId: 'ORDER001',
          totalFetched: 1,
          metadata: {
            providerName: 'kucoin',
            updatedAt: Date.now(),
            isComplete: true,
            filePath: completedFilePath,
            fileName: 'Spot Orders_Filled Orders.csv',
            rowCount: 1,
          },
        },
      },
    };

    const result = await consumeImportStream(importer, params);

    const value = assertOk(result);

    // Should skip the completed file
    expect(value.rawTransactions).toHaveLength(0);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  test('yields multiple batches for multiple CSV files', async () => {
    mockReaddir.mockResolvedValue([
      createMockDirent('Spot Orders_Filled Orders.csv'),
      createMockDirent('Deposits.csv'),
    ] as unknown as Dirent<Buffer<ArrayBufferLike>>[]);

    mockReadFile.mockImplementation((filePath) => {
      const path = filePath as string;
      if (path.includes('Spot Orders')) {
        return Promise.resolve(`UID,Account Type,Order ID,Order Time(UTC),Symbol,Side,Order Type,Order Price,Order Amount,Avg. Filled Price,Filled Amount,Filled Volume,Filled Volume (USDT),Filled Time(UTC),Fee,Fee Currency,Tax,Status
user123,mainAccount,ORDER001,2024-01-01 10:00:00,BTC-USDT,buy,limit,42000.00,0.1,42000.00,0.1,4200.00,4200.00,2024-01-01 10:01:00,0.42,USDT,,deal`);
      }
      return Promise.resolve(`UID,Account Type,Time(UTC),Coin,Amount,Fee,Hash,Deposit Address,Transfer Network,Status,Remarks
user123,mainAccount,2024-01-01 09:00:00,BTC,1.0,0.001,hash123,bc1q...,Bitcoin,success,`);
    });

    const params: ImportParams = {
      sourceName: 'kucoin',
      sourceType: 'exchange-csv' as const,
      csvDirectory: '/test/csv',
    };

    const result = await consumeImportStream(importer, params);

    const value = assertOk(result);

    // Should have transactions from both files
    expect(value.rawTransactions.length).toBeGreaterThan(1);
    // Should have cursor updates for both files
    expect(Object.keys(value.cursorUpdates).length).toBeGreaterThan(1);
  });
});

describe('KucoinCsvImporter - Transaction Type Metadata', () => {
  let importer: KucoinCsvImporter;
  const mockReaddir = vi.mocked(fs.readdir);
  const mockReadFile = vi.mocked(fs.readFile);

  beforeEach(() => {
    importer = new KucoinCsvImporter();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('sets correct metadata for spot orders', async () => {
    mockReaddir.mockResolvedValue([createMockDirent('Spot Orders_Filled Orders.csv')] as unknown as Dirent<
      Buffer<ArrayBufferLike>
    >[]);

    const csvContent = `UID,Account Type,Order ID,Order Time(UTC),Symbol,Side,Order Type,Order Price,Order Amount,Avg. Filled Price,Filled Amount,Filled Volume,Filled Volume (USDT),Filled Time(UTC),Fee,Fee Currency,Tax,Status
user123,mainAccount,ORDER001,2024-01-01 10:00:00,BTC-USDT,buy,limit,42000.00,0.1,42000.00,0.1,4200.00,4200.00,2024-01-01 10:01:00,0.42,USDT,,deal`;

    mockReadFile.mockResolvedValue(csvContent);

    const result = await consumeImportStream(importer, {
      sourceName: 'kucoin',
      sourceType: 'exchange-csv' as const,
      csvDirectory: '/test/csv',
    });

    const value = assertOk(result);

    const transaction = value.rawTransactions[0];
    expect(transaction?.transactionTypeHint).toBe('spot_order');
    expect(transaction?.providerName).toBe('kucoin');
  });

  test('sets correct metadata for deposits', async () => {
    mockReaddir.mockResolvedValue([createMockDirent('Deposits.csv')] as unknown as Dirent<Buffer<ArrayBufferLike>>[]);

    const csvContent = `UID,Account Type,Time(UTC),Coin,Amount,Fee,Hash,Deposit Address,Transfer Network,Status,Remarks
user123,mainAccount,2024-01-01 09:00:00,BTC,1.0,0.001,hash123,bc1q...,Bitcoin,success,`;

    mockReadFile.mockResolvedValue(csvContent);

    const result = await consumeImportStream(importer, {
      sourceName: 'kucoin',
      sourceType: 'exchange-csv' as const,
      csvDirectory: '/test/csv',
    });

    const value = assertOk(result);

    const transaction = value.rawTransactions[0];
    expect(transaction?.transactionTypeHint).toBe('deposit');
    expect(transaction?.providerName).toBe('kucoin');
  });

  test('sets correct metadata for withdrawals', async () => {
    mockReaddir.mockResolvedValue([createMockDirent('Withdrawals.csv')] as unknown as Dirent<
      Buffer<ArrayBufferLike>
    >[]);

    const csvContent = `UID,Account Type,Time(UTC),Coin,Amount,Fee,Hash,Withdrawal Address/Account,Transfer Network,Status,Remarks
user123,mainAccount,2024-01-02 10:00:00,BTC,0.5,0.0005,hash456,bc1q...,Bitcoin,success,`;

    mockReadFile.mockResolvedValue(csvContent);

    const result = await consumeImportStream(importer, {
      sourceName: 'kucoin',
      sourceType: 'exchange-csv' as const,
      csvDirectory: '/test/csv',
    });

    const value = assertOk(result);

    const transaction = value.rawTransactions[0];
    expect(transaction?.transactionTypeHint).toBe('withdrawal');
    expect(transaction?.providerName).toBe('kucoin');
  });
});

describe('KucoinCsvImporter - Row Type Marking', () => {
  let importer: KucoinCsvImporter;
  const mockReaddir = vi.mocked(fs.readdir);
  const mockReadFile = vi.mocked(fs.readFile);

  beforeEach(() => {
    importer = new KucoinCsvImporter();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('adds _rowType to spot order data', async () => {
    mockReaddir.mockResolvedValue([createMockDirent('Spot Orders_Filled Orders.csv')] as unknown as Dirent<
      Buffer<ArrayBufferLike>
    >[]);

    const csvContent = `UID,Account Type,Order ID,Order Time(UTC),Symbol,Side,Order Type,Order Price,Order Amount,Avg. Filled Price,Filled Amount,Filled Volume,Filled Volume (USDT),Filled Time(UTC),Fee,Fee Currency,Tax,Status
user123,mainAccount,ORDER001,2024-01-01 10:00:00,BTC-USDT,buy,limit,42000.00,0.1,42000.00,0.1,4200.00,4200.00,2024-01-01 10:01:00,0.42,USDT,,deal`;

    mockReadFile.mockResolvedValue(csvContent);

    const result = await consumeImportStream(importer, {
      sourceName: 'kucoin',
      sourceType: 'exchange-csv' as const,
      csvDirectory: '/test/csv',
    });

    const value = assertOk(result);
    expect(value.rawTransactions).toHaveLength(1);
    const rawData = value.rawTransactions[0]?.providerData as Record<string, unknown> | undefined;
    expect(rawData?._rowType).toBe('spot_order');
  });

  test('adds _rowType to deposit data', async () => {
    mockReaddir.mockResolvedValue([createMockDirent('Deposits.csv')] as unknown as Dirent<Buffer<ArrayBufferLike>>[]);

    const csvContent = `UID,Account Type,Time(UTC),Coin,Amount,Fee,Hash,Deposit Address,Transfer Network,Status,Remarks
user123,mainAccount,2024-01-01 09:00:00,BTC,1.0,0.001,hash123,bc1q...,Bitcoin,success,`;

    mockReadFile.mockResolvedValue(csvContent);

    const result = await consumeImportStream(importer, {
      sourceName: 'kucoin',
      sourceType: 'exchange-csv' as const,
      csvDirectory: '/test/csv',
    });

    const value = assertOk(result);
    const rawData = value.rawTransactions[0]?.providerData as Record<string, unknown> | undefined;
    expect(rawData?._rowType).toBe('deposit');
  });

  test('adds _rowType to withdrawal data', async () => {
    mockReaddir.mockResolvedValue([createMockDirent('Withdrawals.csv')] as unknown as Dirent<
      Buffer<ArrayBufferLike>
    >[]);

    const csvContent = `UID,Account Type,Time(UTC),Coin,Amount,Fee,Hash,Withdrawal Address/Account,Transfer Network,Status,Remarks
user123,mainAccount,2024-01-02 10:00:00,BTC,0.5,0.0005,hash456,bc1q...,Bitcoin,success,`;

    mockReadFile.mockResolvedValue(csvContent);

    const result = await consumeImportStream(importer, {
      sourceName: 'kucoin',
      sourceType: 'exchange-csv' as const,
      csvDirectory: '/test/csv',
    });

    const value = assertOk(result);
    const rawData = value.rawTransactions[0]?.providerData as Record<string, unknown> | undefined;
    expect(rawData?._rowType).toBe('withdrawal');
  });
});

describe('KucoinCsvImporter - Error Handling', () => {
  let importer: KucoinCsvImporter;
  const mockReaddir = vi.mocked(fs.readdir);
  const mockReadFile = vi.mocked(fs.readFile);

  beforeEach(() => {
    importer = new KucoinCsvImporter();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('returns error when csvDirectory is not provided', async () => {
    const params: ImportParams = {
      sourceName: 'kucoin',
      sourceType: 'exchange-csv' as const,
      csvDirectory: undefined,
    };

    const batches: Result<ImportBatchResult, Error>[] = [];
    for await (const batch of importer.importStreaming(params)) {
      batches.push(batch);
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]?.isErr()).toBe(true);
    if (batches[0]?.isErr()) {
      expect(batches[0].error.message).toContain('CSV directory is required');
    }
  });

  test('handles directory read errors gracefully', async () => {
    mockReaddir.mockRejectedValue(new Error('Directory not found'));

    const params: ImportParams = {
      sourceName: 'kucoin',
      sourceType: 'exchange-csv' as const,
      csvDirectory: '/test/invalid',
    };

    const result = await consumeImportStream(importer, params);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Failed to process directory');
    }
  });

  test('handles CSV parsing errors gracefully by skipping unreadable files', async () => {
    mockReaddir.mockResolvedValue([createMockDirent('Spot Orders_Filled Orders.csv')] as unknown as Dirent<
      Buffer<ArrayBufferLike>
    >[]);
    mockReadFile.mockRejectedValue(new Error('File read error'));

    const params: ImportParams = {
      sourceName: 'kucoin',
      sourceType: 'exchange-csv' as const,
      csvDirectory: '/test/csv',
    };

    const result = await consumeImportStream(importer, params);

    // When a file can't be read, it's logged and skipped, not returned as an error
    const value = assertOk(result);

    // No transactions should be imported from the unreadable file
    expect(value.rawTransactions).toHaveLength(0);
  });
});
