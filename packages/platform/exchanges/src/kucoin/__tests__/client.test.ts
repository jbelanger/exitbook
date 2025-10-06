import * as ccxt from 'ccxt';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { PartialImportError } from '../../core/errors.ts';
import type { IExchangeClient } from '../../core/types.ts';
import { createKuCoinClient } from '../client.ts';

// Mock ccxt
vi.mock('ccxt', () => {
  const mockKuCoin = vi.fn();
  return {
    kucoin: mockKuCoin,
  };
});

describe('createKuCoinClient - Factory', () => {
  test('creates client with valid credentials', () => {
    const credentials = {
      apiKey: 'test-api-key',
      secret: 'test-secret',
      passphrase: 'test-passphrase',
    };

    const result = createKuCoinClient(credentials);
    expect(result.isOk()).toBe(true);
  });

  test('returns error with missing apiKey', () => {
    const credentials = {
      secret: 'test-secret',
      passphrase: 'test-passphrase',
    };

    const result = createKuCoinClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid kucoin credentials');
    }
  });

  test('returns error with missing secret', () => {
    const credentials = {
      apiKey: 'test-api-key',
      passphrase: 'test-passphrase',
    };

    const result = createKuCoinClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid kucoin credentials');
    }
  });

  test('returns error with missing passphrase', () => {
    const credentials = {
      apiKey: 'test-api-key',
      secret: 'test-secret',
    };

    const result = createKuCoinClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid kucoin credentials');
    }
  });

  test('returns error with empty apiKey', () => {
    const credentials = {
      apiKey: '',
      secret: 'test-secret',
      passphrase: 'test-passphrase',
    };

    const result = createKuCoinClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid kucoin credentials');
    }
  });

  test('returns error with empty passphrase', () => {
    const credentials = {
      apiKey: 'test-api-key',
      secret: 'test-secret',
      passphrase: '',
    };

    const result = createKuCoinClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid kucoin credentials');
    }
  });
});

describe('createKuCoinClient - fetchTransactionData', () => {
  let client: IExchangeClient;
  let mockFetchLedger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetchLedger = vi.fn();

    // Reset the ccxt.kucoin mock
    (ccxt.kucoin as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      fetchLedger: mockFetchLedger,
    }));

    const result = createKuCoinClient({
      apiKey: 'test-api-key',
      secret: 'test-secret',
      passphrase: 'test-passphrase',
    });

    if (result.isErr()) {
      throw new Error('Failed to create client in test setup');
    }

    client = result.value;
  });

  test('fetches single page of ledger entries', async () => {
    const mockLedgerEntries: ccxt.LedgerEntry[] = [
      {
        id: 'LEDGER1',
        account: 'test-account',
        amount: 100,
        before: 0,
        after: 100,
        currency: 'USDT',
        direction: 'in',
        fee: { cost: 0, currency: 'USDT' },
        status: 'ok',
        timestamp: 1704067200000,
        datetime: '2024-01-01T00:00:00.000Z',
        type: 'deposit',
        info: {},
      },
      {
        id: 'LEDGER2',
        account: 'test-account',
        amount: -50,
        before: 100,
        after: 50,
        currency: 'USDT',
        direction: 'out',
        fee: { cost: 0.5, currency: 'USDT' },
        status: 'ok',
        timestamp: 1704067201000,
        datetime: '2024-01-01T00:00:01.000Z',
        type: 'withdrawal',
        info: {},
      },
    ];

    // First call returns 2 entries (less than limit of 500), so pagination stops
    mockFetchLedger.mockResolvedValueOnce(mockLedgerEntries);

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(2);
    expect(transactions[0]?.externalId).toBe('LEDGER1');
    expect(transactions[1]?.externalId).toBe('LEDGER2');

    // Verify fetchLedger was called once
    expect(mockFetchLedger).toHaveBeenCalledTimes(1);
    expect(mockFetchLedger).toHaveBeenCalledWith(undefined, undefined, 500);
  });

  test('handles pagination with multiple pages', async () => {
    // Create 500 entries for first page (full page)
    const firstPageEntries: ccxt.LedgerEntry[] = Array.from({ length: 500 }, (_, i) => ({
      id: `LEDGER${i + 1}`,
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'in' as const,
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok',
      timestamp: 1704067200000 + i * 1000,
      datetime: new Date(1704067200000 + i * 1000).toISOString(),
      type: 'deposit',
      info: {},
    }));

    // Create 250 entries for second page (partial page)
    const secondPageEntries: ccxt.LedgerEntry[] = Array.from({ length: 250 }, (_, i) => ({
      id: `LEDGER${i + 501}`,
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'in' as const,
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok',
      timestamp: 1704067200000 + (i + 500) * 1000,
      datetime: new Date(1704067200000 + (i + 500) * 1000).toISOString(),
      type: 'deposit',
      info: {},
    }));

    mockFetchLedger
      .mockResolvedValueOnce(firstPageEntries) // First page: 500 entries
      .mockResolvedValueOnce(secondPageEntries); // Second page: 250 entries (less than limit)

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(750);

    // Verify fetchLedger was called twice with correct since parameter
    expect(mockFetchLedger).toHaveBeenCalledTimes(2);
    expect(mockFetchLedger).toHaveBeenNthCalledWith(1, undefined, undefined, 500);
    // Second call should use the last timestamp from first page + 1ms
    expect(mockFetchLedger).toHaveBeenNthCalledWith(2, undefined, 1704067200000 + 499 * 1000 + 1, 500);
  });

  test('handles empty results', async () => {
    mockFetchLedger.mockResolvedValueOnce([]);

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(0);
    expect(mockFetchLedger).toHaveBeenCalledTimes(1);
  });

  test('uses cursor to resume from last position', async () => {
    const cursor = { ledger: 1704067200000 };
    const params = { cursor };

    mockFetchLedger.mockResolvedValueOnce([]);

    await client.fetchTransactionData(params);

    expect(mockFetchLedger).toHaveBeenCalledWith(undefined, 1704067200000, 500);
  });

  test('handles network errors gracefully', async () => {
    mockFetchLedger.mockRejectedValueOnce(new Error('Network timeout'));

    const result = await client.fetchTransactionData();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Network timeout');
    }
  });

  test('returns partial results when network error occurs mid-pagination', async () => {
    // First page succeeds with 500 entries
    const firstPageEntries: ccxt.LedgerEntry[] = Array.from({ length: 500 }, (_, i) => ({
      id: `LEDGER${i + 1}`,
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'in' as const,
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok',
      timestamp: 1704067200000 + i * 1000,
      datetime: new Date(1704067200000 + i * 1000).toISOString(),
      type: 'deposit',
      info: {},
    }));

    mockFetchLedger
      .mockResolvedValueOnce(firstPageEntries) // First page succeeds
      .mockRejectedValueOnce(new Error('Network timeout')); // Second page fails

    const result = await client.fetchTransactionData();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(PartialImportError);
      const partialError = result.error as PartialImportError;
      expect(partialError.message).toContain('Fetch failed after processing 500 transactions');
      expect(partialError.successfulItems).toHaveLength(500);
      expect(partialError.successfulItems[0]?.externalId).toBe('LEDGER1');
      expect(partialError.successfulItems[499]?.externalId).toBe('LEDGER500');
      // Verify cursor is set for resumption
      expect(partialError.lastSuccessfulCursor?.ledger).toBe(1704067200000 + 499 * 1000);
    }
  });

  test('handles validation errors with PartialImportError', async () => {
    const validEntry: ccxt.LedgerEntry = {
      id: 'LEDGER1',
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'in',
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok',
      timestamp: 1704067200000,
      datetime: '2024-01-01T00:00:00.000Z',
      type: 'deposit',
      info: {},
    };

    const invalidEntry: ccxt.LedgerEntry = {
      id: undefined as unknown as string, // Missing id - will fail validation
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'in',
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok',
      timestamp: 1704067201000,
      datetime: '2024-01-01T00:00:01.000Z',
      type: 'deposit',
      info: {},
    };

    mockFetchLedger.mockResolvedValueOnce([validEntry, invalidEntry]);

    const result = await client.fetchTransactionData();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(PartialImportError);
      const partialError = result.error as PartialImportError;
      expect(partialError.message).toContain('Validation failed for item');
      expect(partialError.successfulItems).toHaveLength(1);
      expect(partialError.successfulItems[0]?.externalId).toBe('LEDGER1');
      expect(partialError.failedItem).toBeDefined();
    }
  });

  test('returns partial results when validation error occurs mid-pagination', async () => {
    // First page: 500 valid entries
    const firstPageEntries: ccxt.LedgerEntry[] = Array.from({ length: 500 }, (_, i) => ({
      id: `LEDGER${i + 1}`,
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'in' as const,
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok',
      timestamp: 1704067200000 + i * 1000,
      datetime: new Date(1704067200000 + i * 1000).toISOString(),
      type: 'deposit',
      info: {},
    }));

    // Second page: starts with valid entry, then has invalid entry
    const validEntry: ccxt.LedgerEntry = {
      id: 'LEDGER501',
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'in',
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok',
      timestamp: 1704067700000,
      datetime: '2024-01-01T00:08:20.000Z',
      type: 'deposit',
      info: {},
    };

    const invalidEntry: ccxt.LedgerEntry = {
      id: undefined as unknown as string, // Missing id - will fail validation
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'in',
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok',
      timestamp: 1704067701000,
      datetime: '2024-01-01T00:08:21.000Z',
      type: 'deposit',
      info: {},
    };

    mockFetchLedger
      .mockResolvedValueOnce(firstPageEntries) // First page: all valid
      .mockResolvedValueOnce([validEntry, invalidEntry]); // Second page: has invalid entry

    const result = await client.fetchTransactionData();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(PartialImportError);
      const partialError = result.error as PartialImportError;
      expect(partialError.message).toContain('Validation failed for item');
      // Should have 500 from first page + 1 from second page before failure
      expect(partialError.successfulItems).toHaveLength(501);
      expect(partialError.successfulItems[0]?.externalId).toBe('LEDGER1');
      expect(partialError.successfulItems[500]?.externalId).toBe('LEDGER501');
      // Verify cursor is set for resumption
      expect(partialError.lastSuccessfulCursor?.ledger).toBe(1704067700000);
    }
  });

  test('updates cursor with latest timestamp', async () => {
    const mockLedgerEntries: ccxt.LedgerEntry[] = [
      {
        id: 'LEDGER1',
        account: 'test-account',
        amount: 100,
        before: 0,
        after: 100,
        currency: 'USDT',
        direction: 'in',
        fee: { cost: 0, currency: 'USDT' },
        status: 'ok',
        timestamp: 1704067200000,
        datetime: '2024-01-01T00:00:00.000Z',
        type: 'deposit',
        info: {},
      },
      {
        id: 'LEDGER2',
        account: 'test-account',
        amount: 100,
        before: 100,
        after: 200,
        currency: 'USDT',
        direction: 'in',
        fee: { cost: 0, currency: 'USDT' },
        status: 'ok',
        timestamp: 1704067300000,
        datetime: '2024-01-01T00:01:40.000Z',
        type: 'deposit',
        info: {},
      },
    ];

    mockFetchLedger.mockResolvedValueOnce(mockLedgerEntries);

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    // Latest cursor should be from LEDGER2
    expect(transactions[1]?.cursor?.ledger).toBe(1704067300000);
  });

  test('handles three-page pagination correctly', async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => ({
      id: `LEDGER${i + 1}`,
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'in' as const,
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok' as const,
      timestamp: 1704067200000 + i * 1000,
      datetime: new Date(1704067200000 + i * 1000).toISOString(),
      type: 'deposit' as const,
      info: {},
    }));

    const page2 = Array.from({ length: 500 }, (_, i) => ({
      id: `LEDGER${i + 501}`,
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'in' as const,
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok' as const,
      timestamp: 1704067200000 + (i + 500) * 1000,
      datetime: new Date(1704067200000 + (i + 500) * 1000).toISOString(),
      type: 'deposit' as const,
      info: {},
    }));

    const page3 = Array.from({ length: 100 }, (_, i) => ({
      id: `LEDGER${i + 1001}`,
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'in' as const,
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok' as const,
      timestamp: 1704067200000 + (i + 1000) * 1000,
      datetime: new Date(1704067200000 + (i + 1000) * 1000).toISOString(),
      type: 'deposit' as const,
      info: {},
    }));

    mockFetchLedger.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2).mockResolvedValueOnce(page3);

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(1100);
    expect(mockFetchLedger).toHaveBeenCalledTimes(3);
    expect(mockFetchLedger).toHaveBeenNthCalledWith(1, undefined, undefined, 500);
    expect(mockFetchLedger).toHaveBeenNthCalledWith(2, undefined, 1704067200000 + 499 * 1000 + 1, 500);
    expect(mockFetchLedger).toHaveBeenNthCalledWith(3, undefined, 1704067200000 + 999 * 1000 + 1, 500);
  });

  test('correctly handles cursor resumption after partial import', async () => {
    // Simulate resuming after a partial import that stopped at LEDGER500
    const resumeCursor = { ledger: 1704067200000 + 499 * 1000 + 1 };
    const params = { cursor: resumeCursor };

    const resumeEntries: ccxt.LedgerEntry[] = Array.from({ length: 100 }, (_, i) => ({
      id: `LEDGER${i + 501}`,
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'in' as const,
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok',
      timestamp: 1704067200000 + (i + 500) * 1000,
      datetime: new Date(1704067200000 + (i + 500) * 1000).toISOString(),
      type: 'deposit',
      info: {},
    }));

    mockFetchLedger.mockResolvedValueOnce(resumeEntries);

    const result = await client.fetchTransactionData(params);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(100);
    expect(result.value[0]?.externalId).toBe('LEDGER501');
    expect(mockFetchLedger).toHaveBeenCalledWith(undefined, 1704067200000 + 499 * 1000 + 1, 500);
  });
});
