import * as ccxt from 'ccxt';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { PartialImportError } from '../../core/errors.ts';
import type { IExchangeClient } from '../../core/types.ts';
import { createCoinbaseClient } from '../client.ts';

// Mock ccxt
vi.mock('ccxt', () => {
  const mockCoinbase = vi.fn();
  return {
    coinbase: mockCoinbase,
  };
});

describe('createCoinbaseClient - Factory', () => {
  test('creates client with valid credentials', () => {
    const credentials = {
      apiKey: 'test-api-key',
      secret: 'test-secret',
    };

    const result = createCoinbaseClient(credentials);
    expect(result.isOk()).toBe(true);
  });

  test('returns error with missing apiKey', () => {
    const credentials = {
      secret: 'test-secret',
    };

    const result = createCoinbaseClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid coinbase credentials');
    }
  });

  test('returns error with missing secret', () => {
    const credentials = {
      apiKey: 'test-api-key',
    };

    const result = createCoinbaseClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid coinbase credentials');
    }
  });

  test('returns error with empty apiKey', () => {
    const credentials = {
      apiKey: '',
      secret: 'test-secret',
    };

    const result = createCoinbaseClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid coinbase credentials');
    }
  });
});

describe('createCoinbaseClient - fetchTransactionData', () => {
  let client: IExchangeClient;
  let mockFetchLedger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetchLedger = vi.fn();

    // Reset the ccxt.coinbase mock
    (ccxt.coinbase as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      fetchLedger: mockFetchLedger,
    }));

    const result = createCoinbaseClient({
      apiKey: 'test-api-key',
      secret: 'test-secret',
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
        currency: 'USD',
        direction: 'in',
        fee: { cost: 0, currency: 'USD' },
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
        currency: 'USD',
        direction: 'out',
        fee: { cost: 0.5, currency: 'USD' },
        status: 'ok',
        timestamp: 1704067201000,
        datetime: '2024-01-01T00:00:01.000Z',
        type: 'withdrawal',
        info: {},
      },
    ];

    // First call returns 2 entries (less than limit of 100), so pagination stops
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
    expect(mockFetchLedger).toHaveBeenCalledWith(undefined, undefined, 100);
  });

  test('handles pagination with multiple pages', async () => {
    // Create 100 entries for first page (full page)
    const firstPageEntries: ccxt.LedgerEntry[] = Array.from({ length: 100 }, (_, i) => ({
      id: `LEDGER${i + 1}`,
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'in',
      fee: { cost: 0, currency: 'USD' },
      status: 'ok',
      timestamp: 1704067200000 + i * 1000,
      datetime: new Date(1704067200000 + i * 1000).toISOString(),
      type: 'deposit',
      info: {},
    }));

    // Create 25 entries for second page (partial page)
    const secondPageEntries: ccxt.LedgerEntry[] = Array.from({ length: 25 }, (_, i) => ({
      id: `LEDGER${i + 101}`,
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'in',
      fee: { cost: 0, currency: 'USD' },
      status: 'ok',
      timestamp: 1704067200000 + (i + 100) * 1000,
      datetime: new Date(1704067200000 + (i + 100) * 1000).toISOString(),
      type: 'deposit',
      info: {},
    }));

    mockFetchLedger
      .mockResolvedValueOnce(firstPageEntries) // First page: 100 entries
      .mockResolvedValueOnce(secondPageEntries); // Second page: 25 entries (less than limit)

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(125);

    // Verify fetchLedger was called twice
    expect(mockFetchLedger).toHaveBeenCalledTimes(2);
    expect(mockFetchLedger).toHaveBeenNthCalledWith(1, undefined, undefined, 100);
    // Second call uses timestamp from last item + 1ms
    expect(mockFetchLedger).toHaveBeenNthCalledWith(2, undefined, 1704067200000 + 99 * 1000 + 1, 100);
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

    expect(mockFetchLedger).toHaveBeenCalledWith(undefined, 1704067200000, 100);
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
    // First page succeeds with 100 entries
    const firstPageEntries: ccxt.LedgerEntry[] = Array.from({ length: 100 }, (_, i) => ({
      id: `LEDGER${i + 1}`,
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'in',
      fee: { cost: 0, currency: 'USD' },
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
      expect(partialError.message).toContain('Fetch failed after processing 100 transactions');
      expect(partialError.successfulItems).toHaveLength(100);
      expect(partialError.successfulItems[0]?.externalId).toBe('LEDGER1');
      expect(partialError.successfulItems[99]?.externalId).toBe('LEDGER100');
      // Verify cursor for resumption
      expect(partialError.lastSuccessfulCursor?.ledger).toBe(1704067200000 + 99 * 1000 + 1);
    }
  });

  test('handles validation errors with PartialImportError', async () => {
    const validEntry: ccxt.LedgerEntry = {
      id: 'LEDGER1',
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'in',
      fee: { cost: 0, currency: 'USD' },
      status: 'ok',
      timestamp: 1704067200000,
      datetime: '2024-01-01T00:00:00.000Z',
      type: 'deposit',
      info: {},
    };

    const invalidEntry: ccxt.LedgerEntry = {
      id: 'LEDGER2',
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'invalid-direction', // Invalid direction
      fee: { cost: 0, currency: 'USD' },
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
    // First page: 100 valid entries
    const firstPageEntries: ccxt.LedgerEntry[] = Array.from({ length: 100 }, (_, i) => ({
      id: `LEDGER${i + 1}`,
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'in',
      fee: { cost: 0, currency: 'USD' },
      status: 'ok',
      timestamp: 1704067200000 + i * 1000,
      datetime: new Date(1704067200000 + i * 1000).toISOString(),
      type: 'deposit',
      info: {},
    }));

    // Second page: starts with valid entry, then has invalid entry
    const validEntry: ccxt.LedgerEntry = {
      id: 'LEDGER101',
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'in',
      fee: { cost: 0, currency: 'USD' },
      status: 'ok',
      timestamp: 1704067300000,
      datetime: '2024-01-01T00:01:40.000Z',
      type: 'deposit',
      info: {},
    };

    const invalidEntry: ccxt.LedgerEntry = {
      id: 'LEDGER102',
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'invalid-direction', // Invalid direction
      fee: { cost: 0, currency: 'USD' },
      status: 'ok',
      timestamp: 1704067301000,
      datetime: '2024-01-01T00:01:41.000Z',
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
      // Should have 100 from first page + 1 from second page before failure
      expect(partialError.successfulItems).toHaveLength(101);
      expect(partialError.successfulItems[0]?.externalId).toBe('LEDGER1');
      expect(partialError.successfulItems[100]?.externalId).toBe('LEDGER101');
      // Verify cursor is set for resumption
      expect(partialError.lastSuccessfulCursor?.ledger).toBe(1704067300000);
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
        currency: 'USD',
        direction: 'in',
        fee: { cost: 0, currency: 'USD' },
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
        currency: 'USD',
        direction: 'in',
        fee: { cost: 0, currency: 'USD' },
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
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: `LEDGER${i + 1}`,
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'in' as const,
      fee: { cost: 0, currency: 'USD' },
      status: 'ok' as const,
      timestamp: 1704067200000 + i * 1000,
      datetime: new Date(1704067200000 + i * 1000).toISOString(),
      type: 'deposit' as const,
      info: {},
    }));

    const page2 = Array.from({ length: 100 }, (_, i) => ({
      id: `LEDGER${i + 101}`,
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'in' as const,
      fee: { cost: 0, currency: 'USD' },
      status: 'ok' as const,
      timestamp: 1704067200000 + (i + 100) * 1000,
      datetime: new Date(1704067200000 + (i + 100) * 1000).toISOString(),
      type: 'deposit' as const,
      info: {},
    }));

    const page3 = Array.from({ length: 10 }, (_, i) => ({
      id: `LEDGER${i + 201}`,
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'in' as const,
      fee: { cost: 0, currency: 'USD' },
      status: 'ok' as const,
      timestamp: 1704067200000 + (i + 200) * 1000,
      datetime: new Date(1704067200000 + (i + 200) * 1000).toISOString(),
      type: 'deposit' as const,
      info: {},
    }));

    mockFetchLedger.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2).mockResolvedValueOnce(page3);

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(210);
    expect(mockFetchLedger).toHaveBeenCalledTimes(3);
    expect(mockFetchLedger).toHaveBeenNthCalledWith(1, undefined, undefined, 100);
    expect(mockFetchLedger).toHaveBeenNthCalledWith(2, undefined, 1704067200000 + 99 * 1000 + 1, 100);
    expect(mockFetchLedger).toHaveBeenNthCalledWith(3, undefined, 1704067200000 + 199 * 1000 + 1, 100);
  });
});
