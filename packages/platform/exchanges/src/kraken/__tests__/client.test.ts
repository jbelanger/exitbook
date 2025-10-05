import * as ccxt from 'ccxt';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { PartialImportError } from '../../core/errors.ts';
import { KrakenClient } from '../client.ts';

// Mock ccxt
vi.mock('ccxt', () => {
  const mockKraken = vi.fn();
  return {
    kraken: mockKraken,
  };
});

describe('KrakenClient - Constructor', () => {
  test('creates client with valid credentials', () => {
    const credentials = {
      apiKey: 'test-api-key',
      secret: 'test-secret',
    };

    expect(() => new KrakenClient(credentials)).not.toThrow();
  });

  test('throws error with missing apiKey', () => {
    const credentials = {
      secret: 'test-secret',
    };

    expect(() => new KrakenClient(credentials)).toThrow('Invalid Kraken credentials');
  });

  test('throws error with missing secret', () => {
    const credentials = {
      apiKey: 'test-api-key',
    };

    expect(() => new KrakenClient(credentials)).toThrow('Invalid Kraken credentials');
  });

  test('throws error with empty apiKey', () => {
    const credentials = {
      apiKey: '',
      secret: 'test-secret',
    };

    expect(() => new KrakenClient(credentials)).toThrow('Invalid Kraken credentials');
  });
});

describe('KrakenClient - fetchTransactionData', () => {
  let client: KrakenClient;
  let mockFetchLedger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetchLedger = vi.fn();

    // Reset the ccxt.kraken mock
    (ccxt.kraken as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      fetchLedger: mockFetchLedger,
    }));

    client = new KrakenClient({
      apiKey: 'test-api-key',
      secret: 'test-secret',
    });
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
        info: {
          id: 'LEDGER1',
          refid: 'REF001',
          time: 1704067200,
          type: 'deposit',
          aclass: 'currency',
          asset: 'ZUSD',
          amount: '100.00',
          fee: '0.00',
          balance: '100.00',
        },
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
        info: {
          id: 'LEDGER2',
          refid: 'REF002',
          time: 1704067201,
          type: 'withdrawal',
          aclass: 'currency',
          asset: 'ZUSD',
          amount: '-50.00',
          fee: '0.50',
          balance: '49.50',
        },
      },
    ];

    // First call returns 2 entries (less than limit of 50), so pagination stops
    mockFetchLedger.mockResolvedValueOnce(mockLedgerEntries);

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(2);
    expect(transactions[0]?.externalId).toBe('LEDGER1');
    expect(transactions[1]?.externalId).toBe('LEDGER2');
    expect(transactions[0]?.metadata?.providerId).toBe('kraken');
    expect(transactions[0]?.metadata?.source).toBe('api');

    // Verify fetchLedger was called once
    expect(mockFetchLedger).toHaveBeenCalledTimes(1);
    expect(mockFetchLedger).toHaveBeenCalledWith(undefined, undefined, 50, { ofs: 0 });
  });

  test('handles pagination with multiple pages', async () => {
    // Create 50 entries for first page (full page)
    const firstPageEntries: ccxt.LedgerEntry[] = Array.from({ length: 50 }, (_, i) => ({
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
      info: {
        id: `LEDGER${i + 1}`,
        refid: `REF${String(i + 1).padStart(3, '0')}`,
        time: 1704067200 + i,
        type: 'deposit',
        aclass: 'currency',
        asset: 'ZUSD',
        amount: '100.00',
        fee: '0.00',
        balance: `${(i + 1) * 100}.00`,
      },
    }));

    // Create 25 entries for second page (partial page)
    const secondPageEntries: ccxt.LedgerEntry[] = Array.from({ length: 25 }, (_, i) => ({
      id: `LEDGER${i + 51}`,
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'in',
      fee: { cost: 0, currency: 'USD' },
      status: 'ok',
      timestamp: 1704067200000 + (i + 50) * 1000,
      datetime: new Date(1704067200000 + (i + 50) * 1000).toISOString(),
      type: 'deposit',
      info: {
        id: `LEDGER${i + 51}`,
        refid: `REF${String(i + 51).padStart(3, '0')}`,
        time: 1704067200 + i + 50,
        type: 'deposit',
        aclass: 'currency',
        asset: 'ZUSD',
        amount: '100.00',
        fee: '0.00',
        balance: `${(i + 51) * 100}.00`,
      },
    }));

    mockFetchLedger
      .mockResolvedValueOnce(firstPageEntries) // First page: 50 entries
      .mockResolvedValueOnce(secondPageEntries); // Second page: 25 entries (less than limit)

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(75);

    // Verify fetchLedger was called twice with correct offsets
    expect(mockFetchLedger).toHaveBeenCalledTimes(2);
    expect(mockFetchLedger).toHaveBeenNthCalledWith(1, undefined, undefined, 50, { ofs: 0 });
    expect(mockFetchLedger).toHaveBeenNthCalledWith(2, undefined, undefined, 50, { ofs: 50 });
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

    expect(mockFetchLedger).toHaveBeenCalledWith(undefined, 1704067200000, 50, { ofs: 0 });
  });

  test('resumes from cursor with offset', async () => {
    const cursor = { ledger: 1704067200000, offset: 100 };
    const params = { cursor };

    mockFetchLedger.mockResolvedValueOnce([]);

    await client.fetchTransactionData(params);

    // Should resume from offset 100
    expect(mockFetchLedger).toHaveBeenCalledWith(undefined, 1704067200000, 50, { ofs: 100 });
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
    // First page succeeds with 50 entries
    const firstPageEntries: ccxt.LedgerEntry[] = Array.from({ length: 50 }, (_, i) => ({
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
      info: {
        id: `LEDGER${i + 1}`,
        refid: `REF${String(i + 1).padStart(3, '0')}`,
        time: 1704067200 + i,
        type: 'deposit',
        aclass: 'currency',
        asset: 'ZUSD',
        amount: '100.00',
        fee: '0.00',
        balance: `${(i + 1) * 100}.00`,
      },
    }));

    mockFetchLedger
      .mockResolvedValueOnce(firstPageEntries) // First page succeeds
      .mockRejectedValueOnce(new Error('Network timeout')); // Second page fails

    const result = await client.fetchTransactionData();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(PartialImportError);
      const partialError = result.error as PartialImportError;
      expect(partialError.message).toContain('Fetch failed after processing 50 transactions');
      expect(partialError.successfulItems).toHaveLength(50);
      expect(partialError.successfulItems[0]?.externalId).toBe('LEDGER1');
      expect(partialError.successfulItems[49]?.externalId).toBe('LEDGER50');
      // Verify cursor includes offset for resumption
      expect(partialError.lastSuccessfulCursor?.offset).toBe(50);
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
      info: {
        id: 'LEDGER1',
        refid: 'REF001',
        time: 1704067200,
        type: 'deposit',
        aclass: 'currency',
        asset: 'ZUSD',
        amount: '100.00',
        fee: '0.00',
        balance: '100.00',
      },
    };

    const invalidEntry: ccxt.LedgerEntry = {
      id: 'LEDGER2',
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'in',
      fee: { cost: 0, currency: 'USD' },
      status: 'ok',
      timestamp: 1704067201000,
      datetime: '2024-01-01T00:00:01.000Z',
      type: 'deposit',
      info: {
        id: 'LEDGER2',
        // missing refid - will fail validation
        time: 1704067201,
        type: 'deposit',
        aclass: 'currency',
        asset: 'ZUSD',
        amount: '100.00',
        fee: '0.00',
        balance: '200.00',
      },
    };

    mockFetchLedger.mockResolvedValueOnce([validEntry, invalidEntry]);

    const result = await client.fetchTransactionData();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(PartialImportError);
      const partialError = result.error as PartialImportError;
      expect(partialError.message).toContain('Validation failed for ledger entry');
      expect(partialError.successfulItems).toHaveLength(1);
      expect(partialError.successfulItems[0]?.externalId).toBe('LEDGER1');
      expect(partialError.failedItem).toBeDefined();
    }
  });

  test('returns partial results when validation error occurs mid-pagination', async () => {
    // First page: 50 valid entries
    const firstPageEntries: ccxt.LedgerEntry[] = Array.from({ length: 50 }, (_, i) => ({
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
      info: {
        id: `LEDGER${i + 1}`,
        refid: `REF${String(i + 1).padStart(3, '0')}`,
        time: 1704067200 + i,
        type: 'deposit',
        aclass: 'currency',
        asset: 'ZUSD',
        amount: '100.00',
        fee: '0.00',
        balance: `${(i + 1) * 100}.00`,
      },
    }));

    // Second page: starts with valid entry, then has invalid entry
    const validEntry: ccxt.LedgerEntry = {
      id: 'LEDGER51',
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'in',
      fee: { cost: 0, currency: 'USD' },
      status: 'ok',
      timestamp: 1704067250000,
      datetime: '2024-01-01T00:00:50.000Z',
      type: 'deposit',
      info: {
        id: 'LEDGER51',
        refid: 'REF051',
        time: 1704067250,
        type: 'deposit',
        aclass: 'currency',
        asset: 'ZUSD',
        amount: '100.00',
        fee: '0.00',
        balance: '5100.00',
      },
    };

    const invalidEntry: ccxt.LedgerEntry = {
      id: 'LEDGER52',
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'in',
      fee: { cost: 0, currency: 'USD' },
      status: 'ok',
      timestamp: 1704067251000,
      datetime: '2024-01-01T00:00:51.000Z',
      type: 'deposit',
      info: {
        id: 'LEDGER52',
        // missing refid - will fail validation
        time: 1704067251,
        type: 'deposit',
        aclass: 'currency',
        asset: 'ZUSD',
        amount: '100.00',
        fee: '0.00',
        balance: '5200.00',
      },
    };

    mockFetchLedger
      .mockResolvedValueOnce(firstPageEntries) // First page: all valid
      .mockResolvedValueOnce([validEntry, invalidEntry]); // Second page: has invalid entry

    const result = await client.fetchTransactionData();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(PartialImportError);
      const partialError = result.error as PartialImportError;
      expect(partialError.message).toContain('Validation failed for ledger entry');
      // Should have 50 from first page + 1 from second page before failure
      expect(partialError.successfulItems).toHaveLength(51);
      expect(partialError.successfulItems[0]?.externalId).toBe('LEDGER1');
      expect(partialError.successfulItems[50]?.externalId).toBe('LEDGER51');
      // Verify cursor is set for resumption
      expect(partialError.lastSuccessfulCursor?.ledger).toBe(1704067250000);
      expect(partialError.lastSuccessfulCursor?.offset).toBe(50);
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
        info: {
          id: 'LEDGER1',
          refid: 'REF001',
          time: 1704067200,
          type: 'deposit',
          aclass: 'currency',
          asset: 'ZUSD',
          amount: '100.00',
          fee: '0.00',
          balance: '100.00',
        },
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
        info: {
          id: 'LEDGER2',
          refid: 'REF002',
          time: 1704067300,
          type: 'deposit',
          aclass: 'currency',
          asset: 'ZUSD',
          amount: '100.00',
          fee: '0.00',
          balance: '200.00',
        },
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
    const page1 = Array.from({ length: 50 }, (_, i) => ({
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
      info: {
        id: `LEDGER${i + 1}`,
        refid: `REF${String(i + 1).padStart(3, '0')}`,
        time: 1704067200 + i,
        type: 'deposit',
        aclass: 'currency',
        asset: 'ZUSD',
        amount: '100.00',
        fee: '0.00',
        balance: '100.00',
      },
    }));

    const page2 = Array.from({ length: 50 }, (_, i) => ({
      id: `LEDGER${i + 51}`,
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'in' as const,
      fee: { cost: 0, currency: 'USD' },
      status: 'ok' as const,
      timestamp: 1704067200000 + (i + 50) * 1000,
      datetime: new Date(1704067200000 + (i + 50) * 1000).toISOString(),
      type: 'deposit' as const,
      info: {
        id: `LEDGER${i + 51}`,
        refid: `REF${String(i + 51).padStart(3, '0')}`,
        time: 1704067200 + i + 50,
        type: 'deposit',
        aclass: 'currency',
        asset: 'ZUSD',
        amount: '100.00',
        fee: '0.00',
        balance: '100.00',
      },
    }));

    const page3 = Array.from({ length: 10 }, (_, i) => ({
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
      info: {
        id: `LEDGER${i + 101}`,
        refid: `REF${String(i + 101).padStart(3, '0')}`,
        time: 1704067200 + i + 100,
        type: 'deposit',
        aclass: 'currency',
        asset: 'ZUSD',
        amount: '100.00',
        fee: '0.00',
        balance: '100.00',
      },
    }));

    mockFetchLedger.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2).mockResolvedValueOnce(page3);

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(110);
    expect(mockFetchLedger).toHaveBeenCalledTimes(3);
    expect(mockFetchLedger).toHaveBeenNthCalledWith(1, undefined, undefined, 50, { ofs: 0 });
    expect(mockFetchLedger).toHaveBeenNthCalledWith(2, undefined, undefined, 50, { ofs: 50 });
    expect(mockFetchLedger).toHaveBeenNthCalledWith(3, undefined, undefined, 50, { ofs: 100 });
  });
});

describe('KrakenClient - extractTimestamp', () => {
  let client: KrakenClient;

  beforeEach(() => {
    client = new KrakenClient({
      apiKey: 'test-api-key',
      secret: 'test-secret',
    });
  });

  test('extracts timestamp from ledger entry', () => {
    const ledgerEntry = {
      id: 'LEDGER1',
      refid: 'REF001',
      time: 1704067200, // Unix timestamp in seconds
      type: 'deposit',
      aclass: 'currency',
      asset: 'ZUSD',
      amount: '100.00',
      fee: '0.00',
      balance: '100.00',
    };

    // @ts-expect-error - accessing private method for testing
    const result = client.extractTimestamp(ledgerEntry);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.getTime()).toBe(1704067200000); // Milliseconds
    }
  });

  test('handles decimal timestamp', () => {
    const ledgerEntry = {
      id: 'LEDGER1',
      refid: 'REF001',
      time: 1704067200.5, // With decimal
      type: 'deposit',
      aclass: 'currency',
      asset: 'ZUSD',
      amount: '100.00',
      fee: '0.00',
      balance: '100.00',
    };

    // @ts-expect-error - accessing private method for testing
    const result = client.extractTimestamp(ledgerEntry);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.getTime()).toBe(1704067200500); // With milliseconds
    }
  });
});

describe('KrakenClient - extractExternalId', () => {
  let client: KrakenClient;

  beforeEach(() => {
    client = new KrakenClient({
      apiKey: 'test-api-key',
      secret: 'test-secret',
    });
  });

  test('extracts external ID from ledger entry', () => {
    const ledgerEntry = {
      id: 'LEDGER123',
      refid: 'REF001',
      time: 1704067200,
      type: 'deposit',
      aclass: 'currency',
      asset: 'ZUSD',
      amount: '100.00',
      fee: '0.00',
      balance: '100.00',
    };

    // @ts-expect-error - accessing private method for testing
    const result = client.extractExternalId(ledgerEntry);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe('LEDGER123');
    }
  });
});
