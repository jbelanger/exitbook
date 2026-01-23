import * as ccxt from 'ccxt';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { IExchangeClient } from '../../../core/types.js';
import { createKrakenClient } from '../client.js';

// Mock ccxt
vi.mock('ccxt', () => {
  const mockKraken = vi.fn();
  return {
    kraken: mockKraken,
  };
});

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
  let mockFetchLedger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetchLedger = vi.fn();

    (ccxt.kraken as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return {
        fetchLedger: mockFetchLedger,
      };
    });

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
    ];

    mockFetchLedger.mockResolvedValueOnce(mockLedgerEntries);

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
    expect(mockFetchLedger).toHaveBeenCalledTimes(1);
  });

  test('streams multiple batches with correct pagination', async () => {
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

    mockFetchLedger.mockResolvedValueOnce(firstPageEntries).mockResolvedValueOnce(secondPageEntries);

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
    expect(batches[0]?.cursor.metadata?.offset).toBe(50);

    expect(batches[1]?.transactions).toHaveLength(25);
    expect(batches[1]?.isComplete).toBe(true);
    expect(batches[1]?.cursor.totalFetched).toBe(75);
    expect(batches[1]?.cursor.metadata?.offset).toBe(75);

    expect(mockFetchLedger).toHaveBeenCalledTimes(2);
    expect(mockFetchLedger).toHaveBeenNthCalledWith(1, undefined, undefined, 50, { ofs: 0 });
    expect(mockFetchLedger).toHaveBeenNthCalledWith(2, undefined, undefined, 50, { ofs: 50 });
  });

  test('handles empty account with sentinel cursor', async () => {
    mockFetchLedger.mockResolvedValueOnce([]);

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
    // Verify metadata.isComplete so ingestion knows this is complete (not resumable)
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

    const resumeEntries: ccxt.LedgerEntry[] = Array.from({ length: 25 }, (_, i) => ({
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
        balance: '100.00',
      },
    }));

    mockFetchLedger.mockResolvedValueOnce(resumeEntries);

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
    expect(batches[0]?.cursor.metadata?.offset).toBe(75);
    expect(mockFetchLedger).toHaveBeenCalledWith(undefined, 1704067200000, 50, { ofs: 50 });
  });

  test('handles network error on first batch', async () => {
    mockFetchLedger.mockRejectedValueOnce(new Error('Network timeout'));

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
    expect(errors[0]?.message).toBe('Network timeout');
  });

  test('handles network error after successful batch', async () => {
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

    mockFetchLedger.mockResolvedValueOnce(firstPageEntries).mockRejectedValueOnce(new Error('Network timeout'));

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
    expect(batches[0]?.cursor.metadata?.offset).toBe(50);

    // Streaming yields the raw error without wrapping
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('Network timeout');
  });

  test('handles validation error mid-batch', async () => {
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
    expect(batches[0]?.cursor.metadata?.offset).toBe(1);

    // Then yield error
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('Validation failed');
  });

  test('handles validation error on second page with correct offset math', async () => {
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

    // Second page: 10 valid entries, then 1 invalid (missing refid)
    const validEntriesPage2: ccxt.LedgerEntry[] = Array.from({ length: 10 }, (_, i) => ({
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

    const invalidEntry: ccxt.LedgerEntry = {
      id: 'LEDGER61',
      account: 'test-account',
      amount: 100,
      before: 0,
      after: 100,
      currency: 'USD',
      direction: 'in',
      fee: { cost: 0, currency: 'USD' },
      status: 'ok',
      timestamp: 1704067260000,
      datetime: '2024-01-01T00:01:00.000Z',
      type: 'deposit',
      info: {
        id: 'LEDGER61',
        // missing refid - will fail validation
        time: 1704067260,
        type: 'deposit',
        aclass: 'currency',
        asset: 'ZUSD',
        amount: '100.00',
        fee: '0.00',
        balance: '6100.00',
      },
    };

    mockFetchLedger.mockResolvedValueOnce(firstPageEntries).mockResolvedValueOnce([...validEntriesPage2, invalidEntry]);

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
    expect(batches[0]?.cursor.metadata?.offset).toBe(50);

    // Second batch: 10 successful entries from page 2 before validation error
    expect(batches[1]?.transactions).toHaveLength(10);
    expect(batches[1]?.cursor.totalFetched).toBe(60); // Cumulative
    // Critical: offset should be ofs (50) + successfulItems.length (10) = 60, NOT 50 + 11 (page size)
    expect(batches[1]?.cursor.metadata?.offset).toBe(60);

    // Then error
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('Validation failed');
  });

  test('tracks cumulative totalFetched across batches', async () => {
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
    // Exactly 50 entries (one full page)
    const exactPageEntries: ccxt.LedgerEntry[] = Array.from({ length: 50 }, (_, i) => ({
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

    mockFetchLedger.mockResolvedValueOnce(exactPageEntries).mockResolvedValueOnce([]); // Next page returns empty

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
    // Verify completion batch has metadata.isComplete
    expect(batches[1]?.cursor.metadata?.isComplete).toBe(true);
  });
});

describe('createKrakenClient - fetchBalance', () => {
  let client: IExchangeClient;
  let mockFetchBalance: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetchBalance = vi.fn();

    (ccxt.kraken as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return {
        fetchBalance: mockFetchBalance,
      };
    });

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
    const mockBalance = {
      XXBT: { free: 1.5, used: 0.1, total: 1.6 },
      ZUSD: { free: 1000, used: 0, total: 1000 },
      XETH: { free: 10, used: 2, total: 12 },
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
    expect(balances.USD).toBe('1000');
    expect(balances.ETH).toBe('12');
    expect(balances.info).toBeUndefined();
    expect(timestamp).toBeGreaterThan(0);
  });

  test('skips zero balances', async () => {
    const mockBalance = {
      XXBT: { free: 1.5, used: 0, total: 1.5 },
      ZUSD: { free: 0, used: 0, total: 0 },
      XETH: { free: 0, used: 0, total: 0 },
    };

    mockFetchBalance.mockResolvedValueOnce(mockBalance);

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances } = result.value;
    expect(balances.BTC).toBe('1.5');
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
    mockFetchBalance.mockRejectedValueOnce(new Error('API rate limit exceeded'));

    const result = await client.fetchBalance();

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;

    expect(result.error.message).toBeTruthy();
  });

  test('normalizes Kraken asset symbols', async () => {
    const mockBalance = {
      XXBT: { free: 1, used: 0, total: 1 },
      XETH: { free: 10, used: 0, total: 10 },
      ZUSD: { free: 1000, used: 0, total: 1000 },
      ZEUR: { free: 500, used: 0, total: 500 },
    };

    mockFetchBalance.mockResolvedValueOnce(mockBalance);

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances } = result.value;
    expect(balances.BTC).toBe('1');
    expect(balances.ETH).toBe('10');
    expect(balances.USD).toBe('1000');
    expect(balances.EUR).toBe('500');
    expect(balances.XXBT).toBeUndefined();
    expect(balances.ZUSD).toBeUndefined();
  });

  test('handles various Kraken asset formats', async () => {
    const mockBalance = {
      XXBT: { free: 1, used: 0, total: 1 },
      XBT: { free: 0.5, used: 0, total: 0.5 },
      XETH: { free: 10, used: 0, total: 10 },
      XXRP: { free: 100, used: 0, total: 100 },
      ZUSD: { free: 1000, used: 0, total: 1000 },
      ZEUR: { free: 500, used: 0, total: 500 },
      ZGBP: { free: 200, used: 0, total: 200 },
      XDOGE: { free: 1000, used: 0, total: 1000 }, // Should normalize to DOGE
      USDC: { free: 500, used: 0, total: 500 }, // No prefix, should stay USDC
    };

    mockFetchBalance.mockResolvedValueOnce(mockBalance);

    const result = await client.fetchBalance();

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { balances } = result.value;
    // XXBT and XBT should both normalize to BTC and be combined
    expect(balances.BTC).toBeDefined();
    expect(balances.ETH).toBe('10');
    expect(balances.XRP).toBe('100');
    expect(balances.USD).toBe('1000');
    expect(balances.EUR).toBe('500');
    expect(balances.GBP).toBe('200');
    expect(balances.DOGE).toBe('1000');
    expect(balances.USDC).toBe('500');
  });
});
