import * as ccxt from 'ccxt';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { PartialImportError } from '../../core/errors.js';
import type { IExchangeClient } from '../../core/types.js';
import { createCoinbaseClient } from '../client.js';

// Mock ccxt
vi.mock('ccxt', () => {
  const mockCoinbaseAdvanced = vi.fn();
  return {
    coinbaseadvanced: mockCoinbaseAdvanced,
  };
});

describe('createCoinbaseClient - Factory', () => {
  test('creates client with valid credentials', () => {
    const credentials = {
      apiKey: 'organizations/test-org/apiKeys/test-key',
      secret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEITest123\n-----END EC PRIVATE KEY-----',
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
  let mockFetchAccounts: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetchLedger = vi.fn();
    mockFetchAccounts = vi.fn();

    // Reset the ccxt.coinbaseadvanced mock
    (ccxt.coinbaseadvanced as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      fetchLedger: mockFetchLedger,
      fetchAccounts: mockFetchAccounts,
    }));

    const result = createCoinbaseClient({
      apiKey: 'organizations/test-org/apiKeys/test-key',
      secret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEITest123\n-----END EC PRIVATE KEY-----',
    });

    if (result.isErr()) {
      throw new Error('Failed to create client in test setup');
    }

    client = result.value;
  });

  test('fetches single page of ledger entries', async () => {
    // Mock accounts - Coinbase fetches accounts first
    mockFetchAccounts.mockResolvedValueOnce([{ id: 'account1', currency: 'USD' }]);

    const mockLedgerEntries: ccxt.LedgerEntry[] = [
      {
        id: 'LEDGER1',
        account: 'account1',
        amount: 100,
        before: 0,
        after: 100,
        currency: 'USD',
        direction: 'in',
        fee: { cost: 0, currency: 'USD' },
        status: 'ok',
        timestamp: 1704067200000,
        datetime: '2024-01-01T00:00:00.000Z',
        type: 'transaction',
        info: {
          id: 'LEDGER1',
          type: 'transaction',
          status: 'ok',
          amount: { amount: '100', currency: 'USD' },
          created_at: '2024-01-01T00:00:00.000Z',
        },
      },
      {
        id: 'LEDGER2',
        account: 'account1',
        amount: -50,
        before: 100,
        after: 50,
        currency: 'USD',
        direction: 'out',
        fee: { cost: 0.5, currency: 'USD' },
        status: 'ok',
        timestamp: 1704067201000,
        datetime: '2024-01-01T00:00:01.000Z',
        type: 'transaction',
        info: {
          id: 'LEDGER2',
          type: 'transaction',
          status: 'ok',
          amount: { amount: '-50', currency: 'USD' },
          created_at: '2024-01-01T00:00:01.000Z',
        },
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

    // Verify fetchAccounts was called
    expect(mockFetchAccounts).toHaveBeenCalledTimes(1);
    // Verify fetchLedger was called once with account_id parameter
    expect(mockFetchLedger).toHaveBeenCalledTimes(1);
    expect(mockFetchLedger).toHaveBeenCalledWith(undefined, undefined, 100, { account_id: 'account1' });
  });

  test('preserves fractional amounts and applies direction sign', async () => {
    // Regression: Number#toFixed() (without precision) rounded these values to whole units,
    // breaking UNI balances after ADR-005. The Decimal workflow must keep the full precision.
    mockFetchAccounts.mockResolvedValueOnce([{ id: 'account1', currency: 'UNI' }]);

    const mockLedgerEntries: ccxt.LedgerEntry[] = [
      {
        id: 'LEDGER_FRACTIONAL_IN',
        account: 'account1',
        amount: 18.1129667,
        before: 0,
        after: 18.1129667,
        currency: 'UNI',
        direction: 'in',
        fee: { cost: 0.00012345, currency: 'UNI' },
        status: 'ok',
        timestamp: 1704067200000,
        datetime: '2024-01-01T00:00:00.000Z',
        type: 'trade',
        info: {
          id: 'LEDGER_FRACTIONAL_IN',
          type: 'trade',
          status: 'ok',
          amount: { amount: '18.1129667', currency: 'UNI' },
          created_at: '2024-01-01T00:00:00.000Z',
        },
      },
      {
        id: 'LEDGER_FRACTIONAL_OUT',
        account: 'account1',
        amount: -0.987654321,
        before: 18.1129667,
        after: 17.125312379,
        currency: 'UNI',
        direction: 'out',
        fee: { cost: 0.01234567, currency: 'UNI' },
        status: 'ok',
        timestamp: 1704067201000,
        datetime: '2024-01-01T00:00:01.000Z',
        type: 'transaction',
        info: {
          id: 'LEDGER_FRACTIONAL_OUT',
          type: 'transaction',
          status: 'ok',
          amount: { amount: '-0.987654321', currency: 'UNI' },
          created_at: '2024-01-01T00:00:01.000Z',
        },
      },
    ];

    mockFetchLedger.mockResolvedValueOnce(mockLedgerEntries);

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [inflow, outflow] = result.value;

    expect((inflow?.normalizedData as { amount?: string }).amount).toBe('18.1129667');
    const outflowData = outflow?.normalizedData as { amount?: string; fee?: string };
    expect(outflowData.amount).toBe('-0.987654321');
    expect(outflowData.fee).toBe('0.01234567');
  });

  test('extracts correlation ID from raw info for trade entries', async () => {
    // Mock accounts
    mockFetchAccounts.mockResolvedValueOnce([{ id: 'account1', currency: 'BTC' }]);

    // Simulate a trade: two ledger entries with same order_id in raw info
    const mockTradeEntries: ccxt.LedgerEntry[] = [
      {
        id: 'LEDGER_BTC_1',
        account: 'account1',
        amount: 0.1,
        before: 0,
        after: 0.1,
        currency: 'BTC',
        direction: 'in',
        fee: { cost: 0.0001, currency: 'BTC' },
        status: 'ok',
        timestamp: 1704067200000,
        datetime: '2024-01-01T00:00:00.000Z',
        type: 'trade',
        referenceId: undefined,
        info: {
          id: 'LEDGER_BTC_1',
          type: 'TRADE_FILL',
          status: 'ok',
          amount: { amount: '0.1', currency: 'BTC' },
          created_at: '2024-01-01T00:00:00.000Z',
          advanced_trade_fill: {
            order_id: 'ORDER123',
            trade_id: 'TRADE456',
            product_id: 'BTC-USD',
          },
        },
      },
      {
        id: 'LEDGER_USD_1',
        account: 'account2',
        amount: -5000,
        before: 10000,
        after: 5000,
        currency: 'USD',
        direction: 'out',
        fee: { cost: 10, currency: 'USD' },
        status: 'ok',
        timestamp: 1704067200000,
        datetime: '2024-01-01T00:00:00.000Z',
        type: 'trade',
        referenceId: undefined,
        info: {
          id: 'LEDGER_USD_1',
          type: 'TRADE_FILL',
          status: 'ok',
          amount: { amount: '-5000', currency: 'USD' },
          created_at: '2024-01-01T00:00:00.000Z',
          advanced_trade_fill: {
            order_id: 'ORDER123',
            trade_id: 'TRADE456',
            product_id: 'BTC-USD',
          },
        },
      },
    ];

    mockFetchLedger.mockResolvedValueOnce(mockTradeEntries);

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(2);

    // Both should have the same correlationId extracted from raw info
    const firstCorrelationId = (transactions[0]?.normalizedData as { correlationId?: string })?.correlationId;
    const secondCorrelationId = (transactions[1]?.normalizedData as { correlationId?: string })?.correlationId;

    expect(firstCorrelationId).toBe('ORDER123');
    expect(secondCorrelationId).toBe('ORDER123');
  });

  test('handles pagination with multiple pages', async () => {
    // Mock accounts - Coinbase fetches accounts first
    mockFetchAccounts.mockResolvedValueOnce([{ id: 'account1', currency: 'USD' }]);

    // Create 100 entries for first page (full page)
    const firstPageEntries: ccxt.LedgerEntry[] = Array.from({ length: 100 }, (_, i) => {
      const timestamp = 1704067200000 + i * 1000;
      const datetime = new Date(timestamp).toISOString();
      const id = `LEDGER${i + 1}`;
      return {
        id,
        account: 'account1',
        amount: 100,
        before: 0,
        after: 100,
        currency: 'USD',
        direction: 'in',
        fee: { cost: 0, currency: 'USD' },
        status: 'ok',
        timestamp,
        datetime,
        type: 'transaction',
        info: {
          id,
          type: 'transaction',
          status: 'ok',
          amount: { amount: '100', currency: 'USD' },
          created_at: datetime,
        },
      };
    });

    // Create 25 entries for second page (partial page)
    const secondPageEntries: ccxt.LedgerEntry[] = Array.from({ length: 25 }, (_, i) => {
      const timestamp = 1704067200000 + (i + 100) * 1000;
      const datetime = new Date(timestamp).toISOString();
      const id = `LEDGER${i + 101}`;
      return {
        id,
        account: 'account1',
        amount: 100,
        before: 0,
        after: 100,
        currency: 'USD',
        direction: 'in',
        fee: { cost: 0, currency: 'USD' },
        status: 'ok',
        timestamp,
        datetime,
        type: 'transaction',
        info: {
          id,
          type: 'transaction',
          status: 'ok',
          amount: { amount: '100', currency: 'USD' },
          created_at: datetime,
        },
      };
    });

    mockFetchLedger
      .mockResolvedValueOnce(firstPageEntries) // First page: 100 entries
      .mockResolvedValueOnce(secondPageEntries); // Second page: 25 entries (less than limit)

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(125);

    // Verify fetchLedger was called twice with account_id
    expect(mockFetchLedger).toHaveBeenCalledTimes(2);
    expect(mockFetchLedger).toHaveBeenNthCalledWith(1, undefined, undefined, 100, { account_id: 'account1' });
    // Second call uses timestamp from last item + 1ms
    expect(mockFetchLedger).toHaveBeenNthCalledWith(2, undefined, 1704067200000 + 99 * 1000 + 1, 100, {
      account_id: 'account1',
    });
  });

  test('handles empty results', async () => {
    // Mock accounts - Coinbase fetches accounts first
    mockFetchAccounts.mockResolvedValueOnce([{ id: 'account1', currency: 'USD' }]);
    mockFetchLedger.mockResolvedValueOnce([]);

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(0);
    expect(mockFetchLedger).toHaveBeenCalledTimes(1);
  });

  test('uses cursor to resume from last position', async () => {
    // Mock accounts - Coinbase fetches accounts first
    mockFetchAccounts.mockResolvedValueOnce([{ id: 'account1', currency: 'USD' }]);

    const cursor = { account1: 1704067200000 };
    const params = { cursor };

    mockFetchLedger.mockResolvedValueOnce([]);

    await client.fetchTransactionData(params);

    expect(mockFetchLedger).toHaveBeenCalledWith(undefined, 1704067200000, 100, { account_id: 'account1' });
  });

  test('handles network errors gracefully', async () => {
    mockFetchAccounts.mockRejectedValueOnce(new Error('Network timeout'));

    const result = await client.fetchTransactionData();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Network timeout');
    }
  });

  test('returns partial results when network error occurs mid-pagination', async () => {
    // Mock accounts - Coinbase fetches accounts first
    mockFetchAccounts.mockResolvedValueOnce([{ id: 'account1', currency: 'USD' }]);

    // First page succeeds with 100 entries
    const firstPageEntries: ccxt.LedgerEntry[] = Array.from({ length: 100 }, (_, i) => {
      const timestamp = 1704067200000 + i * 1000;
      const datetime = new Date(timestamp).toISOString();
      const id = `LEDGER${i + 1}`;
      return {
        id,
        account: 'account1',
        amount: 100,
        before: 0,
        after: 100,
        currency: 'USD',
        direction: 'in',
        fee: { cost: 0, currency: 'USD' },
        status: 'ok',
        timestamp,
        datetime,
        type: 'transaction',
        info: {
          id,
          type: 'transaction',
          status: 'ok',
          amount: { amount: '100', currency: 'USD' },
          created_at: datetime,
        },
      };
    });

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
      // Verify cursor for resumption (per account)
      expect(partialError.lastSuccessfulCursor?.account1).toBe(1704067200000 + 99 * 1000 + 1);
    }
  });

  test('handles validation errors with PartialImportError', async () => {
    // Mock accounts - Coinbase fetches accounts first
    mockFetchAccounts.mockResolvedValueOnce([{ id: 'account1', currency: 'USD' }]);

    const validEntry: ccxt.LedgerEntry = {
      id: 'LEDGER1',
      account: 'account1',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'in',
      fee: { cost: 0, currency: 'USD' },
      status: 'ok',
      timestamp: 1704067200000,
      datetime: '2024-01-01T00:00:00.000Z',
      type: 'transaction',
      info: {
        id: 'LEDGER1',
        type: 'transaction',
        status: 'ok',
        amount: { amount: '100', currency: 'USD' },
        created_at: '2024-01-01T00:00:00.000Z',
      },
    };

    const invalidEntry: ccxt.LedgerEntry = {
      id: 'LEDGER2',
      account: 'account1',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'invalid-direction', // Invalid direction
      fee: { cost: 0, currency: 'USD' },
      status: 'ok',
      timestamp: 1704067201000,
      datetime: '2024-01-01T00:00:01.000Z',
      type: 'transaction',
      info: {
        id: 'LEDGER2',
        type: 'transaction',
        status: 'ok',
        amount: { amount: '100', currency: 'USD' },
        created_at: '2024-01-01T00:00:01.000Z',
      },
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
    // Mock accounts - Coinbase fetches accounts first
    mockFetchAccounts.mockResolvedValueOnce([{ id: 'account1', currency: 'USD' }]);

    // First page: 100 valid entries
    const firstPageEntries: ccxt.LedgerEntry[] = Array.from({ length: 100 }, (_, i) => {
      const timestamp = 1704067200000 + i * 1000;
      const datetime = new Date(timestamp).toISOString();
      const id = `LEDGER${i + 1}`;
      return {
        id,
        account: 'account1',
        amount: 100,
        before: 0,
        after: 100,
        currency: 'USD',
        direction: 'in',
        fee: { cost: 0, currency: 'USD' },
        status: 'ok',
        timestamp,
        datetime,
        type: 'transaction',
        info: {
          id,
          type: 'transaction',
          status: 'ok',
          amount: { amount: '100', currency: 'USD' },
          created_at: datetime,
        },
      };
    });

    // Second page: starts with valid entry, then has invalid entry
    const validEntry: ccxt.LedgerEntry = {
      id: 'LEDGER101',
      account: 'account1',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'in',
      fee: { cost: 0, currency: 'USD' },
      status: 'ok',
      timestamp: 1704067300000,
      datetime: '2024-01-01T00:01:40.000Z',
      type: 'transaction',
      info: {
        id: 'LEDGER101',
        type: 'transaction',
        status: 'ok',
        amount: { amount: '100', currency: 'USD' },
        created_at: '2024-01-01T00:01:40.000Z',
      },
    };

    const invalidEntry: ccxt.LedgerEntry = {
      id: 'LEDGER102',
      account: 'account1',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'invalid-direction', // Invalid direction
      fee: { cost: 0, currency: 'USD' },
      status: 'ok',
      timestamp: 1704067301000,
      datetime: '2024-01-01T00:01:41.000Z',
      type: 'transaction',
      info: {
        id: 'LEDGER102',
        type: 'transaction',
        status: 'ok',
        amount: { amount: '100', currency: 'USD' },
        created_at: '2024-01-01T00:01:41.000Z',
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
      expect(partialError.message).toContain('Validation failed for item');
      // Should have 100 from first page + 1 from second page before failure
      expect(partialError.successfulItems).toHaveLength(101);
      expect(partialError.successfulItems[0]?.externalId).toBe('LEDGER1');
      expect(partialError.successfulItems[100]?.externalId).toBe('LEDGER101');
      // Verify cursor is set for resumption (per account)
      expect(partialError.lastSuccessfulCursor?.account1).toBe(1704067300000);
    }
  });

  test('updates cursor with latest timestamp', async () => {
    // Mock accounts - Coinbase fetches accounts first
    mockFetchAccounts.mockResolvedValueOnce([{ id: 'account1', currency: 'USD' }]);

    const mockLedgerEntries: ccxt.LedgerEntry[] = [
      {
        id: 'LEDGER1',
        account: 'account1',
        amount: 100,
        before: 0,
        after: 100,
        currency: 'USD',
        direction: 'in',
        fee: { cost: 0, currency: 'USD' },
        status: 'ok',
        timestamp: 1704067200000,
        datetime: '2024-01-01T00:00:00.000Z',
        type: 'transaction',
        info: {
          id: 'LEDGER1',
          type: 'transaction',
          status: 'ok',
          amount: { amount: '100', currency: 'USD' },
          created_at: '2024-01-01T00:00:00.000Z',
        },
      },
      {
        id: 'LEDGER2',
        account: 'account1',
        amount: 100,
        before: 100,
        after: 200,
        currency: 'USD',
        direction: 'in',
        fee: { cost: 0, currency: 'USD' },
        status: 'ok',
        timestamp: 1704067300000,
        datetime: '2024-01-01T00:01:40.000Z',
        type: 'transaction',
        info: {
          id: 'LEDGER2',
          type: 'transaction',
          status: 'ok',
          amount: { amount: '100', currency: 'USD' },
          created_at: '2024-01-01T00:01:40.000Z',
        },
      },
    ];

    mockFetchLedger.mockResolvedValueOnce(mockLedgerEntries);

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    // Latest cursor should be from LEDGER2 (per account)
    expect(transactions[1]?.cursor?.account1).toBe(1704067300000);
  });

  test('handles three-page pagination correctly', async () => {
    // Mock accounts - Coinbase fetches accounts first
    mockFetchAccounts.mockResolvedValueOnce([{ id: 'account1', currency: 'USD' }]);

    const page1 = Array.from({ length: 100 }, (_, i) => {
      const timestamp = 1704067200000 + i * 1000;
      const datetime = new Date(timestamp).toISOString();
      const id = `LEDGER${i + 1}`;
      return {
        id,
        account: 'account1',
        amount: 100,
        before: 0,
        after: 100,
        currency: 'USD',
        direction: 'in' as const,
        fee: { cost: 0, currency: 'USD' },
        status: 'ok' as const,
        timestamp,
        datetime,
        type: 'transaction' as const,
        info: {
          id,
          type: 'transaction',
          status: 'ok',
          amount: { amount: '100', currency: 'USD' },
          created_at: datetime,
        },
      };
    });

    const page2 = Array.from({ length: 100 }, (_, i) => {
      const timestamp = 1704067200000 + (i + 100) * 1000;
      const datetime = new Date(timestamp).toISOString();
      const id = `LEDGER${i + 101}`;
      return {
        id,
        account: 'account1',
        amount: 100,
        before: 0,
        after: 100,
        currency: 'USD',
        direction: 'in' as const,
        fee: { cost: 0, currency: 'USD' },
        status: 'ok' as const,
        timestamp,
        datetime,
        type: 'transaction' as const,
        info: {
          id,
          type: 'transaction',
          status: 'ok',
          amount: { amount: '100', currency: 'USD' },
          created_at: datetime,
        },
      };
    });

    const page3 = Array.from({ length: 10 }, (_, i) => {
      const timestamp = 1704067200000 + (i + 200) * 1000;
      const datetime = new Date(timestamp).toISOString();
      const id = `LEDGER${i + 201}`;
      return {
        id,
        account: 'account1',
        amount: 100,
        before: 0,
        after: 100,
        currency: 'USD',
        direction: 'in' as const,
        fee: { cost: 0, currency: 'USD' },
        status: 'ok' as const,
        timestamp,
        datetime,
        type: 'transaction' as const,
        info: {
          id,
          type: 'transaction',
          status: 'ok',
          amount: { amount: '100', currency: 'USD' },
          created_at: datetime,
        },
      };
    });

    mockFetchLedger.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2).mockResolvedValueOnce(page3);

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(210);
    expect(mockFetchLedger).toHaveBeenCalledTimes(3);
    expect(mockFetchLedger).toHaveBeenNthCalledWith(1, undefined, undefined, 100, { account_id: 'account1' });
    expect(mockFetchLedger).toHaveBeenNthCalledWith(2, undefined, 1704067200000 + 99 * 1000 + 1, 100, {
      account_id: 'account1',
    });
    expect(mockFetchLedger).toHaveBeenNthCalledWith(3, undefined, 1704067200000 + 199 * 1000 + 1, 100, {
      account_id: 'account1',
    });
  });
});

describe('createCoinbaseClient - fetchBalance', () => {
  let client: IExchangeClient;
  let mockFetchBalance: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetchBalance = vi.fn();

    (ccxt.coinbaseadvanced as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      fetchBalance: mockFetchBalance,
    }));

    const result = createCoinbaseClient({
      apiKey: 'organizations/test-org/apiKeys/test-key',
      secret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE...test...==\n-----END EC PRIVATE KEY-----',
    });

    if (result.isErr()) {
      throw new Error(`Failed to create client in test setup: ${result.error.message}`);
    }

    client = result.value;
  });

  test('fetches and returns balances', async () => {
    const mockBalance = {
      BTC: { free: 0.5, used: 0.1, total: 0.6 },
      USD: { free: 5000, used: 0, total: 5000 },
      ETH: { free: 5, used: 1, total: 6 },
      info: { someMetadata: 'value' },
      timestamp: 1704067200000,
      datetime: '2024-01-01T00:00:00.000Z',
    };

    mockFetchBalance.mockResolvedValueOnce(mockBalance);

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances, timestamp } = result.value;
    expect(balances.BTC).toBe('0.6');
    expect(balances.USD).toBe('5000');
    expect(balances.ETH).toBe('6');
    expect(balances.info).toBeUndefined();
    expect(timestamp).toBeGreaterThan(0);
  });

  test('skips zero balances', async () => {
    const mockBalance = {
      BTC: { free: 0.5, used: 0, total: 0.5 },
      USD: { free: 0, used: 0, total: 0 },
      ETH: { free: 0, used: 0, total: 0 },
    };

    mockFetchBalance.mockResolvedValueOnce(mockBalance);

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances } = result.value;
    expect(balances.BTC).toBe('0.5');
    expect(balances.USD).toBeUndefined();
    expect(balances.ETH).toBeUndefined();
  });

  test('handles empty balance response', async () => {
    const mockBalance = {
      info: {},
      timestamp: 1704067200000,
    };

    mockFetchBalance.mockResolvedValueOnce(mockBalance);

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances } = result.value;
    expect(Object.keys(balances)).toHaveLength(0);
  });

  test('handles API errors gracefully', async () => {
    mockFetchBalance.mockRejectedValueOnce(new Error('Unauthorized'));

    const result = await client.fetchBalance();

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error.message).toBeTruthy();
  });
});
