/* eslint-disable @typescript-eslint/no-unsafe-assignment -- expect.any() is a vitest matcher that returns type any */

import * as ccxt from 'ccxt';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { PartialImportError } from '../../../core/errors.js';
import type { IExchangeClient } from '../../../core/types.js';
import { createKuCoinClient } from '../client.js';

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
  let mockFetchBalance: ReturnType<typeof vi.fn>;
  let mockFetchAccounts: ReturnType<typeof vi.fn>;
  let mockFetchMyTrades: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetchLedger = vi.fn();
    mockFetchBalance = vi.fn();
    mockFetchAccounts = vi.fn();
    mockFetchMyTrades = vi.fn();

    // Reset the ccxt.kucoin mock
    (ccxt.kucoin as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      fetchLedger: mockFetchLedger,
      fetchBalance: mockFetchBalance,
      fetchAccounts: mockFetchAccounts,
      fetchMyTrades: mockFetchMyTrades,
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

  test('fetches single page of ledger entries with 24-hour time window', async () => {
    const now = Date.now();
    const mockLedgerEntries: ccxt.LedgerEntry[] = [
      {
        id: 'LEDGER1',
        account: 'main',
        amount: 100,
        before: 0,
        after: 100,
        currency: 'USDT',
        direction: 'in',
        fee: { cost: 0, currency: 'USDT' },
        status: 'ok',
        timestamp: now - 1000,
        datetime: new Date(now - 1000).toISOString(),
        type: 'deposit',
        info: {},
      },
      {
        id: 'LEDGER2',
        account: 'main',
        amount: -50,
        before: 100,
        after: 50,
        currency: 'USDT',
        direction: 'out',
        fee: { cost: 0.5, currency: 'USDT' },
        status: 'ok',
        timestamp: now - 2000,
        datetime: new Date(now - 2000).toISOString(),
        type: 'withdrawal',
        info: {},
      },
    ];

    // Mock balance/accounts/trades for diagnostic code
    mockFetchBalance.mockResolvedValue({ total: { BTC: 1.0 } });
    mockFetchAccounts.mockResolvedValue([{ id: 'main', type: 'main' }]);
    mockFetchMyTrades.mockResolvedValue([]);

    // Mock ledger fetches - returns entries once, then empty to stop pagination
    mockFetchLedger
      .mockResolvedValueOnce([]) // Test fetch
      .mockResolvedValueOnce(mockLedgerEntries) // First batch with data
      .mockResolvedValue([]); // All subsequent calls return empty

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { transactions } = result.value;
    expect(transactions).toHaveLength(2);
    expect(transactions[0]?.externalId).toBe('LEDGER1');
    expect(transactions[1]?.externalId).toBe('LEDGER2');

    // Verify fetchLedger was called with until parameter
    expect(mockFetchLedger).toHaveBeenCalledWith(
      undefined,
      undefined,

      expect.any(Number),
      {
        until: expect.any(Number),
      }
    );
  });

  test('handles pagination with multiple 24-hour time windows', async () => {
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    // Create entries spanning 2 days
    const day1Entries: ccxt.LedgerEntry[] = Array.from({ length: 5 }, (_, i) => ({
      id: `DAY1_${i}`,
      account: 'main',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'in',
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok',
      timestamp: now - i * 1000,
      datetime: new Date(now - i * 1000).toISOString(),
      type: 'deposit',
      info: {},
    }));

    const day2Entries: ccxt.LedgerEntry[] = Array.from({ length: 3 }, (_, i) => ({
      id: `DAY2_${i}`,
      account: 'main',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'in',
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok',
      timestamp: now - ONE_DAY - i * 1000,
      datetime: new Date(now - ONE_DAY - i * 1000).toISOString(),
      type: 'deposit',
      info: {},
    }));

    // Mock diagnostic calls
    mockFetchBalance.mockResolvedValue({ total: { BTC: 1.0 } });
    mockFetchAccounts.mockResolvedValue([{ id: 'main', type: 'main' }]);
    mockFetchMyTrades.mockResolvedValue([]);

    mockFetchLedger
      .mockResolvedValueOnce([]) // Test fetch
      .mockResolvedValueOnce(day1Entries) // Day 1 data
      .mockResolvedValueOnce(day2Entries) // Day 2 data
      .mockResolvedValue([]); // All subsequent calls return empty

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { transactions } = result.value;
    expect(transactions).toHaveLength(8);
    expect(transactions[0]?.externalId).toBe('DAY1_0');
    expect(transactions[7]?.externalId).toBe('DAY2_2');
  });

  test('handles empty results', async () => {
    // Mock diagnostic calls
    mockFetchBalance.mockResolvedValue({ total: {} });
    mockFetchAccounts.mockResolvedValue([]);
    mockFetchMyTrades.mockResolvedValue([]);
    mockFetchLedger.mockResolvedValue([]); // All calls return empty

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.transactions).toHaveLength(0);
  });

  test('uses cursor to resume from last position with time window', async () => {
    const startTime = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days ago
    const cursor = {
      ledger: {
        primary: { type: 'timestamp' as const, value: Date.now() - 25 * 24 * 60 * 60 * 1000 },
        lastTransactionId: 'tx-1',
        totalFetched: 100,
        metadata: {
          providerName: 'kucoin',
          updatedAt: Date.now(),
          startTime,
          endTime: Date.now(),
        },
      },
    };
    const params = { cursor };

    // Mock diagnostic calls
    mockFetchBalance.mockResolvedValue({ total: { BTC: 1.0 } });
    mockFetchAccounts.mockResolvedValue([{ id: 'main', type: 'main' }]);
    mockFetchMyTrades.mockResolvedValue([]);
    mockFetchLedger.mockResolvedValue([]); // All calls return empty

    await client.fetchTransactionData(params);

    // Verify it resumed from the cursor's startTime
    expect(mockFetchLedger).toHaveBeenCalledWith(
      undefined,
      undefined,

      expect.any(Number),
      {
        until: expect.any(Number),
      }
    );
  });

  test('handles network errors gracefully', async () => {
    // Mock ledger call to fail immediately
    mockFetchLedger.mockRejectedValue(new Error('Network timeout'));

    const result = await client.fetchTransactionData();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Network timeout');
    }
  });

  test('returns partial results when network error occurs mid-pagination', async () => {
    const now = Date.now();
    const firstBatchEntries: ccxt.LedgerEntry[] = Array.from({ length: 10 }, (_, i) => ({
      id: `LEDGER${i + 1}`,
      account: 'main',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'in',
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok',
      timestamp: now - i * 1000,
      datetime: new Date(now - i * 1000).toISOString(),
      type: 'deposit',
      info: {},
    }));

    // Mock diagnostic calls
    mockFetchBalance.mockResolvedValue({ total: { BTC: 1.0 } });
    mockFetchAccounts.mockResolvedValue([{ id: 'main', type: 'main' }]);
    mockFetchMyTrades.mockResolvedValue([]);

    mockFetchLedger
      .mockResolvedValueOnce([]) // Test fetch
      .mockResolvedValueOnce(firstBatchEntries) // First batch succeeds
      .mockRejectedValueOnce(new Error('Network timeout')); // Second batch fails

    const result = await client.fetchTransactionData();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(PartialImportError);
      const partialError = result.error as PartialImportError;
      expect(partialError.message).toContain('Fetch failed after processing 10 transactions');
      expect(partialError.successfulItems).toHaveLength(10);
      expect(partialError.successfulItems[0]?.externalId).toBe('LEDGER1');
      expect(partialError.successfulItems[9]?.externalId).toBe('LEDGER10');
    }
  });

  test('handles validation errors with PartialImportError', async () => {
    const validEntry: ccxt.LedgerEntry = {
      id: 'LEDGER1',
      account: 'main',
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
      id: 'LEDGER2',
      account: 'main',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'invalid-direction' as unknown as ccxt.LedgerEntry['direction'], // Invalid direction
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok',
      timestamp: 1704067201000,
      datetime: '2024-01-01T00:00:01.000Z',
      type: 'deposit',
      info: {},
    };

    // Mock diagnostic calls
    mockFetchBalance.mockResolvedValue({ total: { BTC: 1.0 } });
    mockFetchAccounts.mockResolvedValue([{ id: 'main', type: 'main' }]);
    mockFetchMyTrades.mockResolvedValue([]);

    mockFetchLedger
      .mockResolvedValueOnce([]) // Test fetch
      .mockResolvedValueOnce([validEntry, invalidEntry]);

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
    const now = Date.now();
    // First batch: all valid
    const firstBatchEntries: ccxt.LedgerEntry[] = Array.from({ length: 10 }, (_, i) => ({
      id: `LEDGER${i + 1}`,
      account: 'main',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'in',
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok',
      timestamp: now - i * 1000,
      datetime: new Date(now - i * 1000).toISOString(),
      type: 'deposit',
      info: {},
    }));

    // Second batch: has invalid entry
    const validEntry: ccxt.LedgerEntry = {
      id: 'LEDGER11',
      account: 'main',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'in',
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok',
      timestamp: now - 11000,
      datetime: new Date(now - 11000).toISOString(),
      type: 'deposit',
      info: {},
    };

    const invalidEntry: ccxt.LedgerEntry = {
      id: 'LEDGER12',
      account: 'main',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USDT',
      direction: 'invalid-direction' as unknown as ccxt.LedgerEntry['direction'],
      fee: { cost: 0, currency: 'USDT' },
      status: 'ok',
      timestamp: now - 12000,
      datetime: new Date(now - 12000).toISOString(),
      type: 'deposit',
      info: {},
    };

    // Mock diagnostic calls
    mockFetchBalance.mockResolvedValue({ total: { BTC: 1.0 } });
    mockFetchAccounts.mockResolvedValue([{ id: 'main', type: 'main' }]);
    mockFetchMyTrades.mockResolvedValue([]);

    mockFetchLedger
      .mockResolvedValueOnce([]) // Test fetch
      .mockResolvedValueOnce(firstBatchEntries) // First batch: all valid
      .mockResolvedValueOnce([validEntry, invalidEntry]); // Second batch: has invalid

    const result = await client.fetchTransactionData();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(PartialImportError);
      const partialError = result.error as PartialImportError;
      expect(partialError.message).toContain('Validation failed for item');
      // Should have 10 from first batch + 1 from second batch before failure
      expect(partialError.successfulItems).toHaveLength(11);
      expect(partialError.successfulItems[0]?.externalId).toBe('LEDGER1');
      expect(partialError.successfulItems[10]?.externalId).toBe('LEDGER11');
    }
  });

  test('updates cursor with latest timestamp and time window metadata', async () => {
    const now = Date.now();
    const mockLedgerEntries: ccxt.LedgerEntry[] = [
      {
        id: 'LEDGER1',
        account: 'main',
        amount: 100,
        before: 0,
        after: 100,
        currency: 'USDT',
        direction: 'in',
        fee: { cost: 0, currency: 'USDT' },
        status: 'ok',
        timestamp: now - 1000,
        datetime: new Date(now - 1000).toISOString(),
        type: 'deposit',
        info: {},
      },
      {
        id: 'LEDGER2',
        account: 'main',
        amount: 100,
        before: 100,
        after: 200,
        currency: 'USDT',
        direction: 'in',
        fee: { cost: 0, currency: 'USDT' },
        status: 'ok',
        timestamp: now - 2000,
        datetime: new Date(now - 2000).toISOString(),
        type: 'deposit',
        info: {},
      },
    ];

    // Mock diagnostic calls
    mockFetchBalance.mockResolvedValue({ total: { BTC: 1.0 } });
    mockFetchAccounts.mockResolvedValue([{ id: 'main', type: 'main' }]);
    mockFetchMyTrades.mockResolvedValue([]);

    mockFetchLedger
      .mockResolvedValueOnce([]) // Test fetch
      .mockResolvedValueOnce(mockLedgerEntries)
      .mockResolvedValue([]); // All subsequent calls return empty

    const result = await client.fetchTransactionData();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { transactions, cursorUpdates } = result.value;
    expect(transactions).toHaveLength(2);
    expect(transactions[0]?.externalId).toBe('LEDGER1');
    expect(transactions[1]?.externalId).toBe('LEDGER2');

    // Verify cursor includes time window metadata
    expect(cursorUpdates.ledger?.metadata?.startTime).toBeDefined();
    expect(cursorUpdates.ledger?.metadata?.endTime).toBeDefined();
  });
});

describe('createKuCoinClient - fetchBalance', () => {
  let client: IExchangeClient;
  let mockFetchBalance: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetchBalance = vi.fn();

    (ccxt.kucoin as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      fetchBalance: mockFetchBalance,
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

  test('fetches and returns balances', async () => {
    const mockBalance = {
      BTC: { free: 1.5, used: 0.1, total: 1.6 },
      USDT: { free: 1000, used: 0, total: 1000 },
      ETH: { free: 10, used: 2, total: 12 },
      info: { someMetadata: 'value' },
      timestamp: 1704067200000,
      datetime: '2024-01-01T00:00:00.000Z',
    };

    mockFetchBalance.mockResolvedValueOnce(mockBalance);

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances, timestamp } = result.value;
    expect(balances.BTC).toBe('1.6');
    expect(balances.USDT).toBe('1000');
    expect(balances.ETH).toBe('12');
    expect(balances.info).toBeUndefined();
    expect(timestamp).toBeGreaterThan(0);
  });

  test('skips zero balances', async () => {
    const mockBalance = {
      BTC: { free: 1.5, used: 0, total: 1.5 },
      USDT: { free: 0, used: 0, total: 0 },
      ETH: { free: 0, used: 0, total: 0 },
    };

    mockFetchBalance.mockResolvedValueOnce(mockBalance);

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances } = result.value;
    expect(balances.BTC).toBe('1.5');
    expect(balances.USDT).toBeUndefined();
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
    mockFetchBalance.mockRejectedValueOnce(new Error('API rate limit exceeded'));

    const result = await client.fetchBalance();

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error.message).toBeTruthy();
  });
});
