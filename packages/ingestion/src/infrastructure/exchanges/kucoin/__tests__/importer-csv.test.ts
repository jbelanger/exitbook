import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { KucoinCsvImporter } from '../importer-csv.js';

vi.mock('node:fs/promises');

describe('KucoinCsvImporter - Metadata', () => {
  let importer: KucoinCsvImporter;
  const mockReaddir = vi.mocked(fs.readdir);
  const mockReadFile = vi.mocked(fs.readFile);

  beforeEach(() => {
    importer = new KucoinCsvImporter();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('sets importMethod as csv in result metadata', async () => {
    mockReaddir.mockResolvedValue(['Spot Orders_Filled Orders.csv'] as unknown as Dirent<Buffer<ArrayBufferLike>>[]);

    const csvContent = `UID,Account Type,Order ID,Order Time(UTC),Symbol,Side,Order Type,Order Price,Order Amount,Avg. Filled Price,Filled Amount,Filled Volume,Filled Volume (USDT),Filled Time(UTC),Fee,Fee Currency,Tax,Status
user123,Trading Account,ORDER001,2024-01-01 10:00:00,BTC-USDT,buy,limit,42000.00,0.1,42000.00,0.1,4200.00,4200.00,2024-01-01 10:01:00,0.42,USDT,,deal`;

    mockReadFile.mockResolvedValue(csvContent);

    const params = {
      csvDirectories: ['/test/csv'],
    };

    const result = await importer.import(params);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Verify importMethod is set in result metadata
    expect(result.value.metadata).toBeDefined();
    expect(result.value.metadata?.importMethod).toBe('csv');
  });

  test('does not include importMethod in individual transaction metadata', async () => {
    mockReaddir.mockResolvedValue(['Spot Orders_Filled Orders.csv'] as unknown as Dirent<Buffer<ArrayBufferLike>>[]);

    const csvContent = `UID,Account Type,Order ID,Order Time(UTC),Symbol,Side,Order Type,Order Price,Order Amount,Avg. Filled Price,Filled Amount,Filled Volume,Filled Volume (USDT),Filled Time(UTC),Fee,Fee Currency,Tax,Status
user123,Trading Account,ORDER001,2024-01-01 10:00:00,BTC-USDT,buy,limit,42000.00,0.1,42000.00,0.1,4200.00,4200.00,2024-01-01 10:01:00,0.42,USDT,,deal`;

    mockReadFile.mockResolvedValue(csvContent);

    const params = {
      csvDirectories: ['/test/csv'],
    };

    const result = await importer.import(params);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Verify each raw transaction does NOT have importMethod in individual metadata
    // (it should only be in the result metadata)
    expect(result.value.rawTransactions).toHaveLength(1);
    const transaction = result.value.rawTransactions[0];
    expect('importMethod' in (transaction ?? {})).toBe(false);
    expect(transaction?.providerName).toBe('kucoin');
    expect(transaction?.transactionTypeHint).toBe('spot_order');
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
    mockReaddir.mockResolvedValue(['Spot Orders_Filled Orders.csv'] as unknown as Dirent<Buffer<ArrayBufferLike>>[]);

    const csvContent = `UID,Account Type,Order ID,Order Time(UTC),Symbol,Side,Order Type,Order Price,Order Amount,Avg. Filled Price,Filled Amount,Filled Volume,Filled Volume (USDT),Filled Time(UTC),Fee,Fee Currency,Tax,Status
user123,Trading Account,ORDER001,2024-01-01 10:00:00,BTC-USDT,buy,limit,42000.00,0.1,42000.00,0.1,4200.00,4200.00,2024-01-01 10:01:00,0.42,USDT,,deal`;

    mockReadFile.mockResolvedValue(csvContent);

    const result = await importer.import({ csvDirectories: ['/test/csv'] });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transaction = result.value.rawTransactions[0];
    expect(transaction?.transactionTypeHint).toBe('spot_order');
    expect(transaction?.providerName).toBe('kucoin');
    // importMethod is only in result metadata, not individual transaction metadata
    expect(result.value.metadata?.importMethod).toBe('csv');
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
    mockReaddir.mockResolvedValue(['Spot Orders_Filled Orders.csv'] as unknown as Dirent<Buffer<ArrayBufferLike>>[]);

    const csvContent = `UID,Account Type,Order ID,Order Time(UTC),Symbol,Side,Order Type,Order Price,Order Amount,Avg. Filled Price,Filled Amount,Filled Volume,Filled Volume (USDT),Filled Time(UTC),Fee,Fee Currency,Tax,Status
user123,Trading Account,ORDER001,2024-01-01 10:00:00,BTC-USDT,buy,limit,42000.00,0.1,42000.00,0.1,4200.00,4200.00,2024-01-01 10:01:00,0.42,USDT,,deal`;

    mockReadFile.mockResolvedValue(csvContent);

    const result = await importer.import({ csvDirectories: ['/test/csv'] });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const rawData = result.value.rawTransactions[0]?.rawData as Record<string, unknown>;
    expect(rawData._rowType).toBe('spot_order');
  });
});
