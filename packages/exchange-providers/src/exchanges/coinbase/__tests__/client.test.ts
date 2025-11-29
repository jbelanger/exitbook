import * as ccxt from 'ccxt';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { FetchBatchResult, IExchangeClient } from '../../../core/types.js';
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

  test('returns error with malformed apiKey (missing /apiKeys/ path)', () => {
    const credentials = {
      apiKey: 'test-api-key', // Missing organizations/{org_id}/apiKeys/{key_id} format
      secret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEITest123\n-----END EC PRIVATE KEY-----',
    };

    const result = createCoinbaseClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid Coinbase API key format');
      expect(result.error.message).toContain('/apiKeys/');
    }
  });

  test('returns error with non-ECDSA private key', () => {
    const credentials = {
      apiKey: 'organizations/test-org/apiKeys/test-key',
      secret: '-----BEGIN PRIVATE KEY-----\nMHcCAQEEITest123\n-----END PRIVATE KEY-----', // Not EC PRIVATE KEY
    };

    const result = createCoinbaseClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid Coinbase private key format');
      expect(result.error.message).toContain('ECDSA');
    }
  });

  test('normalizes PEM key with escaped newlines', () => {
    const credentials = {
      apiKey: 'organizations/test-org/apiKeys/test-key',
      secret: '-----BEGIN EC PRIVATE KEY-----\\nMHcCAQEEITest123\\n-----END EC PRIVATE KEY-----', // Escaped newlines
    };

    const result = createCoinbaseClient(credentials);
    // Should succeed - normalization handles escaped newlines
    expect(result.isOk()).toBe(true);
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

describe('createCoinbaseClient - fetchTransactionDataStreaming', () => {
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

  test('streams single account with single page', async () => {
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
    ];

    mockFetchLedger.mockResolvedValueOnce(mockLedgerEntries);

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches: FetchBatchResult[] = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      } else {
        throw batchResult.error;
      }
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]?.transactions).toHaveLength(1);
    expect(batches[0]?.operationType).toBe('account1');
    expect(batches[0]?.isComplete).toBe(true);
    expect(batches[0]?.cursor.metadata?.isComplete).toBe(true);
    expect(batches[0]?.cursor.totalFetched).toBe(1);
  });

  test('streams single account with multiple pages', async () => {
    mockFetchAccounts.mockResolvedValueOnce([{ id: 'account1', currency: 'USD' }]);

    // First page: 100 entries (full page)
    const firstPage: ccxt.LedgerEntry[] = Array.from({ length: 100 }, (_, i) => {
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

    // Second page: 50 entries (partial page)
    const secondPage: ccxt.LedgerEntry[] = Array.from({ length: 50 }, (_, i) => {
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

    mockFetchLedger.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches: FetchBatchResult[] = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      } else {
        throw batchResult.error;
      }
    }

    expect(batches).toHaveLength(2);
    expect(batches[0]?.transactions).toHaveLength(100);
    expect(batches[0]?.isComplete).toBe(false);
    expect(batches[0]?.cursor.metadata?.isComplete).toBeUndefined();
    expect(batches[0]?.cursor.totalFetched).toBe(100);

    expect(batches[1]?.transactions).toHaveLength(50);
    expect(batches[1]?.isComplete).toBe(true);
    expect(batches[1]?.cursor.metadata?.isComplete).toBe(true);
    expect(batches[1]?.cursor.totalFetched).toBe(150);
  });

  test('streams multiple accounts independently', async () => {
    mockFetchAccounts.mockResolvedValueOnce([
      { id: 'account1', currency: 'BTC' },
      { id: 'account2', currency: 'USD' },
    ]);

    const btcEntries: ccxt.LedgerEntry[] = [
      {
        id: 'BTC1',
        account: 'account1',
        amount: 0.1,
        before: 0,
        after: 0.1,
        currency: 'BTC',
        direction: 'in',
        fee: { cost: 0, currency: 'BTC' },
        status: 'ok',
        timestamp: 1704067200000,
        datetime: '2024-01-01T00:00:00.000Z',
        type: 'transaction',
        info: {
          id: 'BTC1',
          type: 'transaction',
          status: 'ok',
          amount: { amount: '0.1', currency: 'BTC' },
          created_at: '2024-01-01T00:00:00.000Z',
        },
      },
    ];

    const usdEntries: ccxt.LedgerEntry[] = [
      {
        id: 'USD1',
        account: 'account2',
        amount: 1000,
        before: 0,
        after: 1000,
        currency: 'USD',
        direction: 'in',
        fee: { cost: 0, currency: 'USD' },
        status: 'ok',
        timestamp: 1704067201000,
        datetime: '2024-01-01T00:00:01.000Z',
        type: 'transaction',
        info: {
          id: 'USD1',
          type: 'transaction',
          status: 'ok',
          amount: { amount: '1000', currency: 'USD' },
          created_at: '2024-01-01T00:00:01.000Z',
        },
      },
    ];

    mockFetchLedger.mockResolvedValueOnce(btcEntries).mockResolvedValueOnce(usdEntries);

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches: FetchBatchResult[] = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      } else {
        throw batchResult.error;
      }
    }

    expect(batches).toHaveLength(2);

    // First batch: account1 (BTC)
    expect(batches[0]?.operationType).toBe('account1');
    expect(batches[0]?.transactions).toHaveLength(1);
    expect(batches[0]?.transactions[0]?.externalId).toBe('BTC1');
    expect(batches[0]?.isComplete).toBe(true);
    expect(batches[0]?.cursor.metadata?.isComplete).toBe(true);
    expect(batches[0]?.cursor.metadata?.accountId).toBe('account1');

    // Second batch: account2 (USD)
    expect(batches[1]?.operationType).toBe('account2');
    expect(batches[1]?.transactions).toHaveLength(1);
    expect(batches[1]?.transactions[0]?.externalId).toBe('USD1');
    expect(batches[1]?.isComplete).toBe(true);
    expect(batches[1]?.cursor.metadata?.isComplete).toBe(true);
    expect(batches[1]?.cursor.metadata?.accountId).toBe('account2');
  });

  test('handles empty account with completion batch', async () => {
    mockFetchAccounts.mockResolvedValueOnce([{ id: 'account1', currency: 'USD' }]);
    mockFetchLedger.mockResolvedValueOnce([]);

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches: FetchBatchResult[] = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      } else {
        throw batchResult.error;
      }
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]?.transactions).toHaveLength(0);
    expect(batches[0]?.operationType).toBe('account1');
    expect(batches[0]?.isComplete).toBe(true);
    expect(batches[0]?.cursor.metadata?.isComplete).toBe(true);
    expect(batches[0]?.cursor.lastTransactionId).toContain('none');
  });

  test('resumes from cursor', async () => {
    mockFetchAccounts.mockResolvedValueOnce([{ id: 'account1', currency: 'USD' }]);

    const cursor = {
      account1: {
        primary: { type: 'timestamp' as const, value: 1704067200000 },
        lastTransactionId: 'LEDGER100',
        totalFetched: 100,
        metadata: { providerName: 'coinbase', updatedAt: Date.now(), accountId: 'account1' },
      },
    };

    const resumeEntries: ccxt.LedgerEntry[] = [
      {
        id: 'LEDGER101',
        account: 'account1',
        amount: 100,
        before: 0,
        after: 100,
        currency: 'USD',
        direction: 'in',
        fee: { cost: 0, currency: 'USD' },
        status: 'ok',
        timestamp: 1704067201000,
        datetime: '2024-01-01T00:00:01.000Z',
        type: 'transaction',
        info: {
          id: 'LEDGER101',
          type: 'transaction',
          status: 'ok',
          amount: { amount: '100', currency: 'USD' },
          created_at: '2024-01-01T00:00:01.000Z',
        },
      },
    ];

    mockFetchLedger.mockResolvedValueOnce(resumeEntries);

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches: FetchBatchResult[] = [];
    for await (const batchResult of client.fetchTransactionDataStreaming({ cursor })) {
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      } else {
        throw batchResult.error;
      }
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]?.cursor.totalFetched).toBe(101); // 100 + 1 new
    expect(mockFetchLedger).toHaveBeenCalledWith(undefined, 1704067200000, 100, { account_id: 'account1' });
  });

  test('skips accounts marked as complete', async () => {
    mockFetchAccounts.mockResolvedValueOnce([
      { id: 'account1', currency: 'BTC' },
      { id: 'account2', currency: 'USD' },
    ]);

    const cursor = {
      account1: {
        primary: { type: 'timestamp' as const, value: 1704067200000 },
        lastTransactionId: 'BTC100',
        totalFetched: 100,
        metadata: {
          providerName: 'coinbase',
          updatedAt: Date.now(),
          accountId: 'account1',
          isComplete: true,
        },
      },
    };

    const usdEntries: ccxt.LedgerEntry[] = [
      {
        id: 'USD1',
        account: 'account2',
        amount: 1000,
        before: 0,
        after: 1000,
        currency: 'USD',
        direction: 'in',
        fee: { cost: 0, currency: 'USD' },
        status: 'ok',
        timestamp: 1704067201000,
        datetime: '2024-01-01T00:00:01.000Z',
        type: 'transaction',
        info: {
          id: 'USD1',
          type: 'transaction',
          status: 'ok',
          amount: { amount: '1000', currency: 'USD' },
          created_at: '2024-01-01T00:00:01.000Z',
        },
      },
    ];

    mockFetchLedger.mockResolvedValueOnce(usdEntries);

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches: FetchBatchResult[] = [];
    for await (const batchResult of client.fetchTransactionDataStreaming({ cursor })) {
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      } else {
        throw batchResult.error;
      }
    }

    // Should only have one batch for account2, account1 was skipped
    expect(batches).toHaveLength(1);
    expect(batches[0]?.operationType).toBe('account2');

    // Verify fetchLedger was only called for account2
    expect(mockFetchLedger).toHaveBeenCalledTimes(1);
    expect(mockFetchLedger).toHaveBeenCalledWith(undefined, undefined, 100, { account_id: 'account2' });
  });

  test('handles validation error mid-page', async () => {
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

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches: FetchBatchResult[] = [];
    const errors: Error[] = [];

    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      } else {
        errors.push(batchResult.error);
      }
    }

    // Should have 1 successful batch with valid item, then 1 error
    expect(batches).toHaveLength(1);
    expect(batches[0]?.transactions).toHaveLength(1);
    expect(batches[0]?.transactions[0]?.externalId).toBe('LEDGER1');
    expect(batches[0]?.cursor.totalFetched).toBe(1);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('Validation failed');
  });

  test('handles no accounts gracefully', async () => {
    mockFetchAccounts.mockResolvedValueOnce([]);

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches: FetchBatchResult[] = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      } else {
        throw batchResult.error;
      }
    }

    // Should yield completion batch to mark source as checked (prevents re-checks)
    expect(batches).toHaveLength(1);
    expect(batches[0]?.transactions).toHaveLength(0);
    expect(batches[0]?.operationType).toBe('coinbase:no-accounts');
    expect(batches[0]?.isComplete).toBe(true);
    expect(batches[0]?.cursor.metadata?.isComplete).toBe(true);
    expect(mockFetchLedger).not.toHaveBeenCalled();
  });

  test('handles account without id', async () => {
    mockFetchAccounts.mockResolvedValueOnce([
      { id: undefined, currency: 'BTC' },
      { id: 'account2', currency: 'USD' },
    ]);

    const usdEntries: ccxt.LedgerEntry[] = [
      {
        id: 'USD1',
        account: 'account2',
        amount: 1000,
        before: 0,
        after: 1000,
        currency: 'USD',
        direction: 'in',
        fee: { cost: 0, currency: 'USD' },
        status: 'ok',
        timestamp: 1704067201000,
        datetime: '2024-01-01T00:00:01.000Z',
        type: 'transaction',
        info: {
          id: 'USD1',
          type: 'transaction',
          status: 'ok',
          amount: { amount: '1000', currency: 'USD' },
          created_at: '2024-01-01T00:00:01.000Z',
        },
      },
    ];

    mockFetchLedger.mockResolvedValueOnce(usdEntries);

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches: FetchBatchResult[] = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      } else {
        throw batchResult.error;
      }
    }

    // Should only have one batch for account2, account without ID was skipped
    expect(batches).toHaveLength(1);
    expect(batches[0]?.operationType).toBe('account2');
    expect(mockFetchLedger).toHaveBeenCalledTimes(1);
  });

  test('preserves Coinbase-specific correlation ID extraction', async () => {
    mockFetchAccounts.mockResolvedValueOnce([{ id: 'account1', currency: 'BTC' }]);

    const mockTradeEntry: ccxt.LedgerEntry = {
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
    };

    mockFetchLedger.mockResolvedValueOnce([mockTradeEntry]);

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches: FetchBatchResult[] = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      } else {
        throw batchResult.error;
      }
    }

    expect(batches).toHaveLength(1);
    const correlationId = (batches[0]?.transactions[0]?.normalizedData as { correlationId?: string })?.correlationId;
    expect(correlationId).toBe('ORDER123');
  });

  test('preserves Coinbase-specific fee extraction from advanced_trade_fill', async () => {
    mockFetchAccounts.mockResolvedValueOnce([{ id: 'account1', currency: 'USDC' }]);

    const mockTradeEntry: ccxt.LedgerEntry = {
      id: 'TRADE1',
      account: 'account1',
      amount: -100,
      before: 1000,
      after: 900,
      currency: 'USDC',
      direction: 'out',
      fee: { cost: 0, currency: 'USDC' },
      status: 'ok',
      timestamp: 1704067200000,
      datetime: '2024-01-01T00:00:00.000Z',
      type: 'advanced_trade_fill',
      info: {
        id: 'TRADE1',
        type: 'TRADE_FILL',
        status: 'ok',
        amount: { amount: '-100', currency: 'USDC' },
        created_at: '2024-01-01T00:00:00.000Z',
        advanced_trade_fill: {
          order_id: 'ORDER123',
          product_id: 'BTC-USDC',
          commission: '0.5',
        },
      },
    };

    mockFetchLedger.mockResolvedValueOnce([mockTradeEntry]);

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches: FetchBatchResult[] = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      } else {
        throw batchResult.error;
      }
    }

    expect(batches).toHaveLength(1);
    const normalizedData = batches[0]?.transactions[0]?.normalizedData as { fee?: string; feeCurrency?: string };
    expect(normalizedData.fee).toBe('0.5');
    expect(normalizedData.feeCurrency).toBe('USDC');
  });
});
