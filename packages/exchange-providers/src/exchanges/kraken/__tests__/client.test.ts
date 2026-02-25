import type { CursorState } from '@exitbook/core';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { IExchangeClient } from '../../../core/types.js';
import { createKrakenClient } from '../client.js';

type KrakenCursorMetadata = CursorState['metadata'] & {
  offset?: number | undefined;
};

// Mock kraken-auth
vi.mock('../kraken-auth.js', () => ({
  krakenPost: vi.fn(),
}));

import { krakenPost } from '../kraken-auth.js';

const mockKrakenPost = krakenPost as ReturnType<typeof vi.fn>;

interface LedgerOverrides {
  refid?: string | undefined;
  time?: number | undefined;
  type?: string | undefined;
  subtype?: string | undefined;
  aclass?: string | undefined;
  asset?: string | undefined;
  amount?: string | undefined;
  fee?: string | undefined;
  balance?: string | undefined;
}

function makeLedgerEntry(id: string, overrides: LedgerOverrides = {}) {
  return {
    id,
    refid: overrides.refid ?? `REF-${id}`,
    time: overrides.time ?? 1704067200,
    type: overrides.type ?? 'deposit',
    aclass: overrides.aclass ?? 'currency',
    asset: overrides.asset ?? 'ZUSD',
    amount: overrides.amount ?? '100.00',
    fee: overrides.fee ?? '0.00',
    balance: overrides.balance ?? '100.00',
  };
}

function makeLedgerResponse(entries: Record<string, unknown>[]) {
  const ledger: Record<string, Record<string, unknown>> = {};
  for (const entry of entries) {
    const { id, ...rest } = entry as { id: string } & Record<string, unknown>;
    ledger[id] = rest;
  }
  return { ledger, count: entries.length };
}

describe('createKrakenClient - Factory', () => {
  test('creates client with valid credentials', () => {
    const credentials = {
      apiKey: 'test-api-key',
      apiSecret: 'test-secret',
    };

    const result = createKrakenClient(credentials);
    expect(result.isOk()).toBe(true);
  });

  test('returns error with missing apiKey', () => {
    const credentials = {
      apiSecret: 'test-secret',
      apiKey: '',
    };

    const result = createKrakenClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid kraken credentials');
    }
  });

  test('returns error with missing secret', () => {
    const credentials = {
      apiKey: 'test-api-key',
      apiSecret: '',
    };

    const result = createKrakenClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid kraken credentials');
    }
  });

  test('returns error with empty apiKey', () => {
    const credentials = {
      apiKey: '',
      apiSecret: 'test-secret',
    };

    const result = createKrakenClient(credentials);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid kraken credentials');
    }
  });
});

describe('createKrakenClient - fetchTransactionDataStreaming', () => {
  let client: IExchangeClient;

  beforeEach(() => {
    mockKrakenPost.mockReset();

    const result = createKrakenClient({
      apiKey: 'test-api-key',
      apiSecret: 'test-secret',
    });

    if (result.isErr()) {
      throw new Error('Failed to create client in test setup');
    }

    client = result.value;
  });

  test('streams single batch of ledger entries', async () => {
    const entries = [makeLedgerEntry('LEDGER1', { refid: 'REF001', time: 1704067200 })];

    mockKrakenPost.mockResolvedValueOnce(ok(makeLedgerResponse(entries)));

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      expect(batchResult.isOk()).toBe(true);
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      }
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]?.transactions).toHaveLength(1);
    expect(batches[0]?.transactions[0]?.eventId).toBe('LEDGER1');
    expect(batches[0]?.operationType).toBe('ledger');
    expect(batches[0]?.isComplete).toBe(true);
    expect(batches[0]?.cursor.totalFetched).toBe(1);
    expect(mockKrakenPost).toHaveBeenCalledTimes(1);
  });

  test('streams multiple batches with correct pagination', async () => {
    const firstPageEntries = Array.from({ length: 50 }, (_, i) =>
      makeLedgerEntry(`LEDGER${i + 1}`, {
        refid: `REF${String(i + 1).padStart(3, '0')}`,
        time: 1704067200 + i,
        balance: `${(i + 1) * 100}.00`,
      })
    );

    const secondPageEntries = Array.from({ length: 25 }, (_, i) =>
      makeLedgerEntry(`LEDGER${i + 51}`, {
        refid: `REF${String(i + 51).padStart(3, '0')}`,
        time: 1704067200 + i + 50,
        balance: `${(i + 51) * 100}.00`,
      })
    );

    mockKrakenPost
      .mockResolvedValueOnce(ok(makeLedgerResponse(firstPageEntries)))
      .mockResolvedValueOnce(ok(makeLedgerResponse(secondPageEntries)));

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      expect(batchResult.isOk()).toBe(true);
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      }
    }

    expect(batches).toHaveLength(2);
    expect(batches[0]?.transactions).toHaveLength(50);
    expect(batches[0]?.isComplete).toBe(false);
    expect(batches[0]?.cursor.totalFetched).toBe(50);
    expect((batches[0]?.cursor.metadata as KrakenCursorMetadata)?.offset).toBe(50);

    expect(batches[1]?.transactions).toHaveLength(25);
    expect(batches[1]?.isComplete).toBe(true);
    expect(batches[1]?.cursor.totalFetched).toBe(75);
    expect((batches[1]?.cursor.metadata as KrakenCursorMetadata)?.offset).toBe(75);

    expect(mockKrakenPost).toHaveBeenCalledTimes(2);
    expect(mockKrakenPost).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      { apiKey: 'test-api-key', apiSecret: 'test-secret' },
      'Ledgers',
      { ofs: 0 }
    );
    expect(mockKrakenPost).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      { apiKey: 'test-api-key', apiSecret: 'test-secret' },
      'Ledgers',
      { ofs: 50 }
    );
  });

  test('handles empty account with sentinel cursor', async () => {
    mockKrakenPost.mockResolvedValueOnce(ok({ ledger: {}, count: 0 }));

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      expect(batchResult.isOk()).toBe(true);
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      }
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]?.transactions).toHaveLength(0);
    expect(batches[0]?.isComplete).toBe(true);
    expect(batches[0]?.cursor.lastTransactionId).toBe('kraken:ledger:none');
    expect(batches[0]?.cursor.totalFetched).toBe(0);
    expect(batches[0]?.cursor.metadata?.isComplete).toBe(true);
  });

  test('resumes from cursor with offset', async () => {
    const cursor = {
      ledger: {
        primary: { type: 'timestamp' as const, value: 1704067200000 },
        lastTransactionId: 'LEDGER50',
        totalFetched: 50,
        metadata: { providerName: 'kraken', updatedAt: Date.now(), offset: 50 },
      },
    };

    const resumeEntries = Array.from({ length: 25 }, (_, i) =>
      makeLedgerEntry(`LEDGER${i + 51}`, {
        refid: `REF${String(i + 51).padStart(3, '0')}`,
        time: 1704067200 + i + 50,
      })
    );

    mockKrakenPost.mockResolvedValueOnce(ok(makeLedgerResponse(resumeEntries)));

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches = [];
    for await (const batchResult of client.fetchTransactionDataStreaming({ cursor })) {
      expect(batchResult.isOk()).toBe(true);
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      }
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]?.transactions).toHaveLength(25);
    expect(batches[0]?.cursor.totalFetched).toBe(75);
    expect((batches[0]?.cursor.metadata as KrakenCursorMetadata)?.offset).toBe(75);
    expect(mockKrakenPost).toHaveBeenCalledWith(
      expect.any(Object),
      { apiKey: 'test-api-key', apiSecret: 'test-secret' },
      'Ledgers',
      { ofs: 50 }
    );
  });

  test('handles network error on first batch', async () => {
    mockKrakenPost.mockResolvedValueOnce(err(new Error('Network timeout')));

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches = [];
    const errors = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      if (batchResult.isErr()) {
        errors.push(batchResult.error);
      } else {
        batches.push(batchResult.value);
      }
    }

    expect(batches).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('Kraken API error: Network timeout');
  });

  test('handles network error after successful batch', async () => {
    const firstPageEntries = Array.from({ length: 50 }, (_, i) =>
      makeLedgerEntry(`LEDGER${i + 1}`, {
        refid: `REF${String(i + 1).padStart(3, '0')}`,
        time: 1704067200 + i,
        balance: `${(i + 1) * 100}.00`,
      })
    );

    mockKrakenPost
      .mockResolvedValueOnce(ok(makeLedgerResponse(firstPageEntries)))
      .mockResolvedValueOnce(err(new Error('Network timeout')));

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches = [];
    const errors = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      if (batchResult.isErr()) {
        errors.push(batchResult.error);
      } else {
        batches.push(batchResult.value);
      }
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]?.transactions).toHaveLength(50);
    expect(batches[0]?.cursor.totalFetched).toBe(50);
    expect((batches[0]?.cursor.metadata as KrakenCursorMetadata)?.offset).toBe(50);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('Kraken API error: Network timeout');
  });

  test('handles validation error mid-batch', async () => {
    const validEntry = makeLedgerEntry('LEDGER1', { refid: 'REF001', time: 1704067200 });
    const invalidEntry = {
      id: 'LEDGER2',
      // missing refid - will fail validation
      time: 1704067201,
      type: 'deposit',
      aclass: 'currency',
      asset: 'ZUSD',
      amount: '100.00',
      fee: '0.00',
      balance: '200.00',
    };

    mockKrakenPost.mockResolvedValueOnce(ok(makeLedgerResponse([validEntry, invalidEntry])));

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches = [];
    const errors = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      if (batchResult.isErr()) {
        errors.push(batchResult.error);
      } else {
        batches.push(batchResult.value);
      }
    }

    // Should yield successful batch first
    expect(batches).toHaveLength(1);
    expect(batches[0]?.transactions).toHaveLength(1);
    expect(batches[0]?.transactions[0]?.eventId).toBe('LEDGER1');
    expect(batches[0]?.cursor.totalFetched).toBe(1);
    expect((batches[0]?.cursor.metadata as KrakenCursorMetadata)?.offset).toBe(1);

    // Then yield error
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('Validation failed');
  });

  test('handles validation error on second page with correct offset math', async () => {
    // First page: 50 valid entries
    const firstPageEntries = Array.from({ length: 50 }, (_, i) =>
      makeLedgerEntry(`LEDGER${i + 1}`, {
        refid: `REF${String(i + 1).padStart(3, '0')}`,
        time: 1704067200 + i,
        balance: `${(i + 1) * 100}.00`,
      })
    );

    // Second page: 10 valid entries, then 1 invalid (missing refid)
    const validEntriesPage2 = Array.from({ length: 10 }, (_, i) =>
      makeLedgerEntry(`LEDGER${i + 51}`, {
        refid: `REF${String(i + 51).padStart(3, '0')}`,
        time: 1704067200 + i + 50,
        balance: `${(i + 51) * 100}.00`,
      })
    );

    const invalidEntry = {
      id: 'LEDGER61',
      // missing refid - will fail validation
      time: 1704067260,
      type: 'deposit',
      aclass: 'currency',
      asset: 'ZUSD',
      amount: '100.00',
      fee: '0.00',
      balance: '6100.00',
    };

    mockKrakenPost
      .mockResolvedValueOnce(ok(makeLedgerResponse(firstPageEntries)))
      .mockResolvedValueOnce(ok(makeLedgerResponse([...validEntriesPage2, invalidEntry])));

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches = [];
    const errors = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      if (batchResult.isErr()) {
        errors.push(batchResult.error);
      } else {
        batches.push(batchResult.value);
      }
    }

    // Should have 2 successful batches before error
    expect(batches).toHaveLength(2);

    // First batch: 50 entries from page 1
    expect(batches[0]?.transactions).toHaveLength(50);
    expect(batches[0]?.cursor.totalFetched).toBe(50);
    expect((batches[0]?.cursor.metadata as KrakenCursorMetadata)?.offset).toBe(50);

    // Second batch: 10 successful entries from page 2 before validation error
    expect(batches[1]?.transactions).toHaveLength(10);
    expect(batches[1]?.cursor.totalFetched).toBe(60); // Cumulative
    expect((batches[1]?.cursor.metadata as KrakenCursorMetadata)?.offset).toBe(60);

    // Then error
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('Validation failed');
  });

  test('tracks cumulative totalFetched across batches', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) =>
      makeLedgerEntry(`LEDGER${i + 1}`, {
        refid: `REF${String(i + 1).padStart(3, '0')}`,
        time: 1704067200 + i,
      })
    );

    const page2 = Array.from({ length: 50 }, (_, i) =>
      makeLedgerEntry(`LEDGER${i + 51}`, {
        refid: `REF${String(i + 51).padStart(3, '0')}`,
        time: 1704067200 + i + 50,
      })
    );

    const page3 = Array.from({ length: 10 }, (_, i) =>
      makeLedgerEntry(`LEDGER${i + 101}`, {
        refid: `REF${String(i + 101).padStart(3, '0')}`,
        time: 1704067200 + i + 100,
      })
    );

    mockKrakenPost
      .mockResolvedValueOnce(ok(makeLedgerResponse(page1)))
      .mockResolvedValueOnce(ok(makeLedgerResponse(page2)))
      .mockResolvedValueOnce(ok(makeLedgerResponse(page3)));

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      expect(batchResult.isOk()).toBe(true);
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      }
    }

    expect(batches).toHaveLength(3);
    expect(batches[0]?.cursor.totalFetched).toBe(50);
    expect(batches[1]?.cursor.totalFetched).toBe(100);
    expect(batches[2]?.cursor.totalFetched).toBe(110);
  });

  test('marks exact multiple of limit as complete', async () => {
    const exactPageEntries = Array.from({ length: 50 }, (_, i) =>
      makeLedgerEntry(`LEDGER${i + 1}`, {
        refid: `REF${String(i + 1).padStart(3, '0')}`,
        time: 1704067200 + i,
        balance: `${(i + 1) * 100}.00`,
      })
    );

    mockKrakenPost
      .mockResolvedValueOnce(ok(makeLedgerResponse(exactPageEntries)))
      .mockResolvedValueOnce(ok({ ledger: {}, count: 0 })); // Next page returns empty

    if (!client.fetchTransactionDataStreaming) {
      throw new Error('fetchTransactionDataStreaming not implemented');
    }

    const batches = [];
    for await (const batchResult of client.fetchTransactionDataStreaming()) {
      expect(batchResult.isOk()).toBe(true);
      if (batchResult.isOk()) {
        batches.push(batchResult.value);
      }
    }

    // Should have 2 batches: one with 50 entries (not complete), one completion batch
    expect(batches).toHaveLength(2);
    expect(batches[0]?.transactions).toHaveLength(50);
    expect(batches[0]?.isComplete).toBe(false);
    expect(batches[1]?.transactions).toHaveLength(0);
    expect(batches[1]?.isComplete).toBe(true);
    expect(batches[1]?.cursor.metadata?.isComplete).toBe(true);
  });
});

describe('createKrakenClient - fetchBalance', () => {
  let client: IExchangeClient;

  beforeEach(() => {
    mockKrakenPost.mockReset();

    const result = createKrakenClient({
      apiKey: 'test-api-key',
      apiSecret: 'test-secret',
    });

    if (result.isErr()) {
      throw new Error('Failed to create client in test setup');
    }

    client = result.value;
  });

  test('fetches and normalizes balances', async () => {
    mockKrakenPost.mockResolvedValueOnce(
      ok({
        XXBT: { balance: '1.6', hold_trade: '0.1' },
        ZUSD: { balance: '1000', hold_trade: '0' },
        XETH: { balance: '12', hold_trade: '2' },
      })
    );

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances, timestamp } = result.value;
    const balanceView = balances as {
      BTC?: string | undefined;
      ETH?: string | undefined;
      info?: unknown;
      USD?: string | undefined;
    };
    expect(balanceView.BTC).toBe('1.6');
    expect(balanceView.USD).toBe('1000');
    expect(balanceView.ETH).toBe('12');
    expect(balanceView.info).toBeUndefined();
    expect(timestamp).toBeGreaterThan(0);
  });

  test('skips zero balances', async () => {
    mockKrakenPost.mockResolvedValueOnce(
      ok({
        XXBT: { balance: '1.5', hold_trade: '0' },
        ZUSD: { balance: '0', hold_trade: '0' },
        XETH: { balance: '0', hold_trade: '0' },
      })
    );

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances } = result.value;
    const balanceView = balances as { BTC?: string | undefined; ETH?: string | undefined; USD?: string | undefined };
    expect(balanceView.BTC).toBe('1.5');
    expect(balanceView.USD).toBeUndefined();
    expect(balanceView.ETH).toBeUndefined();
  });

  test('handles empty balance response', async () => {
    mockKrakenPost.mockResolvedValueOnce(ok({}));

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances } = result.value;
    expect(Object.keys(balances)).toHaveLength(0);
  });

  test('handles API errors gracefully', async () => {
    mockKrakenPost.mockResolvedValueOnce(err(new Error('API rate limit exceeded')));

    const result = await client.fetchBalance();

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error.message).toBeTruthy();
  });

  test('normalizes Kraken asset symbols', async () => {
    mockKrakenPost.mockResolvedValueOnce(
      ok({
        XXBT: { balance: '1', hold_trade: '0' },
        XETH: { balance: '10', hold_trade: '0' },
        ZUSD: { balance: '1000', hold_trade: '0' },
        ZEUR: { balance: '500', hold_trade: '0' },
      })
    );

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances } = result.value;
    const balanceView = balances as {
      BTC?: string | undefined;
      ETH?: string | undefined;
      EUR?: string | undefined;
      USD?: string | undefined;
      XXBT?: string | undefined;
      ZUSD?: string | undefined;
    };
    expect(balanceView.BTC).toBe('1');
    expect(balanceView.ETH).toBe('10');
    expect(balanceView.USD).toBe('1000');
    expect(balanceView.EUR).toBe('500');
    expect(balanceView.XXBT).toBeUndefined();
    expect(balanceView.ZUSD).toBeUndefined();
  });

  test('handles various Kraken asset formats', async () => {
    mockKrakenPost.mockResolvedValueOnce(
      ok({
        XXBT: { balance: '1', hold_trade: '0' },
        XBT: { balance: '0.5', hold_trade: '0' },
        XETH: { balance: '10', hold_trade: '0' },
        XXRP: { balance: '100', hold_trade: '0' },
        ZUSD: { balance: '1000', hold_trade: '0' },
        ZEUR: { balance: '500', hold_trade: '0' },
        ZGBP: { balance: '200', hold_trade: '0' },
        XDOGE: { balance: '1000', hold_trade: '0' },
        USDC: { balance: '500', hold_trade: '0' },
      })
    );

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances } = result.value;
    const balanceView = balances as {
      BTC?: string | undefined;
      DOGE?: string | undefined;
      ETH?: string | undefined;
      EUR?: string | undefined;
      GBP?: string | undefined;
      USD?: string | undefined;
      USDC?: string | undefined;
      XRP?: string | undefined;
    };
    expect(balanceView.BTC).toBeDefined();
    expect(balanceView.ETH).toBe('10');
    expect(balanceView.XRP).toBe('100');
    expect(balanceView.USD).toBe('1000');
    expect(balanceView.EUR).toBe('500');
    expect(balanceView.GBP).toBe('200');
    expect(balanceView.DOGE).toBe('1000');
    expect(balanceView.USDC).toBe('500');
  });
});
