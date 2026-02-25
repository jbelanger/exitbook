/* eslint-disable unicorn/no-null -- needed by api response */
import type { CursorState } from '@exitbook/core';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { FetchBatchResult, IExchangeClient } from '../../../core/types.js';
import type { CoinbaseAccount, RawCoinbaseLedgerEntry } from '../schemas.js';

type CoinbaseCursorMetadata = CursorState['metadata'] & {
  accountId?: string | undefined;
};

// Mock the coinbase-auth module
vi.mock('../coinbase-auth.js', () => ({
  coinbaseGet: vi.fn(),
}));

// Import after mock setup
const { coinbaseGet } = await import('../coinbase-auth.js');
const { createCoinbaseClient } = await import('../client.js');

const mockCoinbaseGet = coinbaseGet as ReturnType<typeof vi.fn>;

function makeAccount(id: string, currency: string, balance = '0.00'): CoinbaseAccount {
  return {
    id,
    name: `${currency} Wallet`,
    type: 'wallet',
    currency: { code: currency },
    balance: { amount: balance, currency },
  };
}

function makeTransaction(
  id: string,
  type: string,
  amount: string,
  currency: string,
  createdAt: string
): RawCoinbaseLedgerEntry {
  return {
    id,
    type,
    status: 'completed',
    amount: { amount, currency },
    created_at: createdAt,
  };
}

function paginatedResponse<T>(data: T[], nextStartingAfter: string | null = null) {
  return {
    pagination: {
      ending_before: null,
      starting_after: null,
      next_starting_after: nextStartingAfter,
      limit: 100,
      order: 'asc',
      next_uri: null,
    },
    data,
  };
}

describe('createCoinbaseClient - Factory', () => {
  test('creates client with valid credentials', () => {
    const credentials = {
      apiKey: 'organizations/test-org/apiKeys/test-key',
      apiSecret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEITest123\n-----END EC PRIVATE KEY-----',
    };

    const result = createCoinbaseClient(credentials);
    expect(result.isOk()).toBe(true);
  });

  test('returns error with missing apiKey', () => {
    const credentials = {
      apiSecret: 'test-secret',
      apiKey: '',
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
      apiSecret: '',
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
      apiSecret: 'test-secret',
    };

    const result = createCoinbaseClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid coinbase credentials');
    }
  });

  test('returns error with malformed apiKey (missing /apiKeys/ path)', () => {
    const credentials = {
      apiKey: 'test-api-key',
      apiSecret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEITest123\n-----END EC PRIVATE KEY-----',
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
      apiSecret: '-----BEGIN PRIVATE KEY-----\nMHcCAQEEITest123\n-----END PRIVATE KEY-----',
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
      apiSecret: '-----BEGIN EC PRIVATE KEY-----\\nMHcCAQEEITest123\\n-----END EC PRIVATE KEY-----',
    };

    const result = createCoinbaseClient(credentials);
    expect(result.isOk()).toBe(true);
  });
});

describe('createCoinbaseClient - fetchBalance', () => {
  let client: IExchangeClient;

  beforeEach(() => {
    mockCoinbaseGet.mockReset();

    const result = createCoinbaseClient({
      apiKey: 'organizations/test-org/apiKeys/test-key',
      apiSecret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE...test...==\n-----END EC PRIVATE KEY-----',
    });

    if (result.isErr()) {
      throw new Error(`Failed to create client in test setup: ${result.error.message}`);
    }

    client = result.value;
  });

  test('fetches and returns balances', async () => {
    mockCoinbaseGet.mockResolvedValueOnce(
      ok(
        paginatedResponse([
          makeAccount('acc-btc', 'BTC', '0.6'),
          makeAccount('acc-usd', 'USD', '5000'),
          makeAccount('acc-eth', 'ETH', '6'),
        ])
      )
    );

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances, timestamp } = result.value;
    const balanceView = balances as {
      BTC?: string | undefined;
      ETH?: string | undefined;
      USD?: string | undefined;
    };
    expect(balanceView.BTC).toBe('0.6');
    expect(balanceView.USD).toBe('5000');
    expect(balanceView.ETH).toBe('6');
    expect(timestamp).toBeGreaterThan(0);
  });

  test('skips zero balances', async () => {
    mockCoinbaseGet.mockResolvedValueOnce(
      ok(
        paginatedResponse([
          makeAccount('acc-btc', 'BTC', '0.5'),
          makeAccount('acc-usd', 'USD', '0'),
          makeAccount('acc-eth', 'ETH', '0'),
        ])
      )
    );

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances } = result.value;
    const balanceView = balances as { BTC?: string | undefined; ETH?: string | undefined; USD?: string | undefined };
    expect(balanceView.BTC).toBe('0.5');
    expect(balanceView.USD).toBeUndefined();
    expect(balanceView.ETH).toBeUndefined();
  });

  test('handles empty balance response', async () => {
    mockCoinbaseGet.mockResolvedValueOnce(ok(paginatedResponse([])));

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances } = result.value;
    expect(Object.keys(balances)).toHaveLength(0);
  });

  test('handles API errors gracefully', async () => {
    mockCoinbaseGet.mockResolvedValueOnce(err(new Error('Unauthorized')));

    const result = await client.fetchBalance();

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error.message).toBeTruthy();
  });
});

describe('createCoinbaseClient - fetchTransactionDataStreaming', () => {
  let client: IExchangeClient;

  beforeEach(() => {
    mockCoinbaseGet.mockReset();

    const result = createCoinbaseClient({
      apiKey: 'organizations/test-org/apiKeys/test-key',
      apiSecret: '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEITest123\n-----END EC PRIVATE KEY-----',
    });

    if (result.isErr()) {
      throw new Error('Failed to create client in test setup');
    }

    client = result.value;
  });

  /** Helper: mock accounts call then transaction calls in sequence */
  function mockAccountsAndTransactions(
    accounts: CoinbaseAccount[],
    ...transactionPages: { data: RawCoinbaseLedgerEntry[]; nextCursor: string | null }[]
  ) {
    // First call is always fetchAllAccounts → GET /v2/accounts
    mockCoinbaseGet.mockResolvedValueOnce(ok(paginatedResponse(accounts)));

    // Subsequent calls are transaction pages
    for (const page of transactionPages) {
      mockCoinbaseGet.mockResolvedValueOnce(ok(paginatedResponse(page.data, page.nextCursor)));
    }
  }

  test('streams single account with single page', async () => {
    mockAccountsAndTransactions([makeAccount('account1', 'USD')], {
      data: [makeTransaction('LEDGER1', 'transaction', '100', 'USD', '2024-01-01T00:00:00.000Z')],
      nextCursor: null,
    });

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
    const firstPage = Array.from({ length: 100 }, (_, i) => {
      const id = `LEDGER${i + 1}`;
      return makeTransaction(id, 'transaction', '100', 'USD', new Date(1704067200000 + i * 1000).toISOString());
    });

    const secondPage = Array.from({ length: 50 }, (_, i) => {
      const id = `LEDGER${i + 101}`;
      return makeTransaction(id, 'transaction', '100', 'USD', new Date(1704067200000 + (i + 100) * 1000).toISOString());
    });

    mockAccountsAndTransactions(
      [makeAccount('account1', 'USD')],
      { data: firstPage, nextCursor: 'LEDGER100' },
      { data: secondPage, nextCursor: null }
    );

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
    mockAccountsAndTransactions(
      [makeAccount('account1', 'BTC'), makeAccount('account2', 'USD')],
      { data: [makeTransaction('BTC1', 'transaction', '0.1', 'BTC', '2024-01-01T00:00:00.000Z')], nextCursor: null },
      { data: [makeTransaction('USD1', 'transaction', '1000', 'USD', '2024-01-01T00:00:01.000Z')], nextCursor: null }
    );

    const batches: FetchBatchResult[] = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      } else {
        throw batchResult.error;
      }
    }

    expect(batches).toHaveLength(2);

    expect(batches[0]?.operationType).toBe('account1');
    expect(batches[0]?.transactions).toHaveLength(1);
    expect(batches[0]?.transactions[0]?.eventId).toBe('BTC1');
    expect(batches[0]?.isComplete).toBe(true);
    expect(batches[0]?.cursor.metadata?.isComplete).toBe(true);
    const batch0Metadata = batches[0]?.cursor.metadata as CoinbaseCursorMetadata;
    expect(batch0Metadata?.accountId).toBe('account1');

    expect(batches[1]?.operationType).toBe('account2');
    expect(batches[1]?.transactions).toHaveLength(1);
    expect(batches[1]?.transactions[0]?.eventId).toBe('USD1');
    expect(batches[1]?.isComplete).toBe(true);
    expect(batches[1]?.cursor.metadata?.isComplete).toBe(true);
    const batch1Metadata = batches[1]?.cursor.metadata as CoinbaseCursorMetadata;
    expect(batch1Metadata?.accountId).toBe('account2');
  });

  test('handles empty account with completion batch', async () => {
    mockAccountsAndTransactions([makeAccount('account1', 'USD')], { data: [], nextCursor: null });

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
    mockAccountsAndTransactions([makeAccount('account1', 'USD')], {
      data: [makeTransaction('LEDGER101', 'transaction', '100', 'USD', '2024-01-01T00:00:01.000Z')],
      nextCursor: null,
    });

    const cursor = {
      account1: {
        primary: { type: 'pageToken' as const, providerName: 'coinbase', value: 'LEDGER100' },
        lastTransactionId: 'LEDGER100',
        totalFetched: 100,
        metadata: { providerName: 'coinbase', updatedAt: Date.now(), accountId: 'account1' },
      },
    };

    const batches: FetchBatchResult[] = [];
    for await (const batchResult of client.fetchTransactionDataStreaming({ cursor })) {
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      } else {
        throw batchResult.error;
      }
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]?.cursor.totalFetched).toBe(101);

    // Verify the transaction page was called with starting_after
    // Call 0 = accounts, Call 1 = transactions
    expect(mockCoinbaseGet).toHaveBeenCalledTimes(2);
    const txCallPath = mockCoinbaseGet.mock.calls[1]![2] as string;
    expect(txCallPath).toContain('starting_after=LEDGER100');
  });

  test('checks for new transactions on previously completed accounts', async () => {
    mockAccountsAndTransactions(
      [makeAccount('account1', 'BTC'), makeAccount('account2', 'USD')],
      // account1: no new transactions
      { data: [], nextCursor: null },
      // account2: has new transactions
      { data: [makeTransaction('USD1', 'transaction', '1000', 'USD', '2024-01-01T00:00:01.000Z')], nextCursor: null }
    );

    const cursor = {
      account1: {
        primary: { type: 'pageToken' as const, providerName: 'coinbase', value: 'BTC100' },
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

    const batches: FetchBatchResult[] = [];
    for await (const batchResult of client.fetchTransactionDataStreaming({ cursor })) {
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      } else {
        throw batchResult.error;
      }
    }

    expect(batches).toHaveLength(2);
    expect(batches[0]?.operationType).toBe('account1');
    expect(batches[0]?.transactions).toHaveLength(0);
    expect(batches[0]?.isComplete).toBe(true);
    expect(batches[1]?.operationType).toBe('account2');
    expect(batches[1]?.transactions).toHaveLength(1);

    // Verify API calls: 1 accounts + 2 transaction pages (one per account)
    expect(mockCoinbaseGet).toHaveBeenCalledTimes(3);
  });

  test('handles validation error mid-page', async () => {
    const validTx = makeTransaction('LEDGER1', 'transaction', '100', 'USD', '2024-01-01T00:00:00.000Z');
    const invalidTx = {
      id: 'LEDGER2',
      type: 'transaction',
      status: 'ok',
      amount: 'not-an-object', // Invalid: amount should be { amount, currency }
      created_at: '2024-01-01T00:00:01.000Z',
    };

    // fetchAllAccounts
    mockCoinbaseGet.mockResolvedValueOnce(ok(paginatedResponse([makeAccount('account1', 'USD')])));
    // fetchTransactionPage - returns mixed valid/invalid
    mockCoinbaseGet.mockResolvedValueOnce(ok(paginatedResponse([validTx, invalidTx])));

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
    expect(batches[0]?.transactions[0]?.eventId).toBe('LEDGER1');
    expect(batches[0]?.cursor.totalFetched).toBe(1);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('Validation failed');
  });

  test('handles no accounts gracefully', async () => {
    mockCoinbaseGet.mockResolvedValueOnce(ok(paginatedResponse([])));

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
    expect(batches[0]?.operationType).toBe('coinbase:no-accounts');
    expect(batches[0]?.isComplete).toBe(true);
    expect(batches[0]?.cursor.metadata?.isComplete).toBe(true);
  });

  test('preserves Coinbase-specific correlation ID in providerData', async () => {
    const tradeTx: RawCoinbaseLedgerEntry = {
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
    };

    mockAccountsAndTransactions([makeAccount('account1', 'BTC')], { data: [tradeTx], nextCursor: null });

    const batches: FetchBatchResult[] = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      } else {
        throw batchResult.error;
      }
    }

    expect(batches).toHaveLength(1);
    const providerData = batches[0]?.transactions[0]?.providerData as {
      advanced_trade_fill?: { order_id?: string };
    };
    expect(providerData.advanced_trade_fill?.order_id).toBe('ORDER123');
  });

  test('preserves Coinbase-specific fee data in providerData from advanced_trade_fill', async () => {
    const tradeTx: RawCoinbaseLedgerEntry = {
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
    };

    mockAccountsAndTransactions([makeAccount('account1', 'USDC')], { data: [tradeTx], nextCursor: null });

    const batches: FetchBatchResult[] = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      } else {
        throw batchResult.error;
      }
    }

    expect(batches).toHaveLength(1);
    const providerData = batches[0]?.transactions[0]?.providerData as {
      advanced_trade_fill?: { commission?: string };
      amount: { currency: string };
    };
    expect(providerData.advanced_trade_fill?.commission).toBe('0.5');
    expect(providerData.amount.currency).toBe('USDC');
  });
});
