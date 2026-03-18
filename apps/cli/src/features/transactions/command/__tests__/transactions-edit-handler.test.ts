import type { CreateOverrideEventOptions, Currency, OverrideEvent, Transaction } from '@exitbook/core';
import { ok, parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import type { DataContext, OverrideStore } from '@exitbook/data';
import { describe, expect, it, vi } from 'vitest';

import { createPersistedTransaction } from '../../../shared/__tests__/transaction-test-utils.js';
import { TransactionsEditHandler } from '../transactions-edit-handler.js';

function createTransaction(id: number, txFingerprintSeed = `ext-${id}`): Transaction {
  return createPersistedTransaction({
    id,
    accountId: 1,
    txFingerprint: `tx:v2:kraken:1:${txFingerprintSeed}`,
    source: 'kraken',
    sourceType: 'exchange',
    datetime: '2024-01-01T00:00:00.000Z',
    timestamp: Date.parse('2024-01-01T00:00:00.000Z'),
    status: 'success',
    movements: {
      inflows: [
        {
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('1.0'),
        },
      ],
      outflows: [],
    },
    fees: [],
    operation: {
      category: 'transfer',
      type: 'deposit',
    },
  });
}

function createTransactionNoteEvent(txFingerprint: string, message: string): OverrideEvent {
  return {
    id: `note:${txFingerprint}`,
    created_at: '2026-03-15T12:00:00.000Z',
    actor: 'user',
    source: 'cli',
    scope: 'transaction-note',
    payload: {
      type: 'transaction_note_override',
      action: 'set',
      tx_fingerprint: txFingerprint,
      message,
    },
  };
}

function createMockOverrideStore(
  initialEvents: OverrideEvent[] = []
): Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'> {
  const events = [...initialEvents];
  return {
    append: vi.fn().mockImplementation(async (options: CreateOverrideEventOptions) => {
      const event: OverrideEvent = {
        id: `override-event-${events.length + 1}`,
        created_at: '2026-03-15T12:05:00.000Z',
        actor: 'user',
        source: 'cli',
        scope: options.scope,
        payload: options.payload,
      };
      events.push(event);
      return ok(event);
    }),
    exists: vi.fn().mockImplementation(() => events.length > 0),
    readByScopes: vi
      .fn()
      .mockImplementation(async (scopes: OverrideEvent['scope'][]) =>
        ok(events.filter((event) => scopes.includes(event.scope)))
      ),
  };
}

describe('TransactionsEditHandler', () => {
  it('appends a transaction note override when setting a new note', async () => {
    const transaction = createTransaction(42, 'trade-42');
    const materializeTransactionNoteOverrides = vi.fn().mockResolvedValue(ok(1));
    const mockDb = {
      transactions: {
        findById: vi.fn().mockResolvedValue(ok(transaction)),
        materializeTransactionNoteOverrides,
      },
    } as unknown as Pick<DataContext, 'transactions'>;
    const mockOverrideStore = createMockOverrideStore();

    const handler = new TransactionsEditHandler(mockDb, mockOverrideStore);
    const result = await handler.setNote({
      transactionId: 42,
      message: 'Moved to hardware wallet',
      reason: 'manual reminder',
    });

    expect(assertOk(result)).toMatchObject({
      action: 'set',
      changed: true,
      transactionId: 42,
      txFingerprint: 'tx:v2:kraken:1:trade-42',
      note: 'Moved to hardware wallet',
      reason: 'manual reminder',
      source: 'kraken',
    });
    expect(mockOverrideStore.append).toHaveBeenCalledWith({
      scope: 'transaction-note',
      payload: {
        type: 'transaction_note_override',
        action: 'set',
        tx_fingerprint: 'tx:v2:kraken:1:trade-42',
        message: 'Moved to hardware wallet',
      },
      reason: 'manual reminder',
    });
    expect(materializeTransactionNoteOverrides).toHaveBeenCalledWith({
      transactionIds: [42],
      notesByFingerprint: new Map([['tx:v2:kraken:1:trade-42', 'Moved to hardware wallet']]),
    });
  });

  it('does not append when the stored note already matches', async () => {
    const transaction = createTransaction(42, 'trade-42');
    const materializeTransactionNoteOverrides = vi.fn().mockResolvedValue(ok(0));
    const mockDb = {
      transactions: {
        findById: vi.fn().mockResolvedValue(ok(transaction)),
        materializeTransactionNoteOverrides,
      },
    } as unknown as Pick<DataContext, 'transactions'>;
    const mockOverrideStore = createMockOverrideStore([
      createTransactionNoteEvent('tx:v2:kraken:1:trade-42', 'Moved to hardware wallet'),
    ]);

    const handler = new TransactionsEditHandler(mockDb, mockOverrideStore);
    const result = await handler.setNote({
      transactionId: 42,
      message: 'Moved to hardware wallet',
    });

    expect(assertOk(result)).toMatchObject({
      action: 'set',
      changed: false,
      transactionId: 42,
      note: 'Moved to hardware wallet',
    });
    expect(mockOverrideStore.append).not.toHaveBeenCalled();
    expect(materializeTransactionNoteOverrides).not.toHaveBeenCalled();
  });

  it('appends a clear event when clearing an existing note', async () => {
    const transaction = createTransaction(42, 'trade-42');
    const materializeTransactionNoteOverrides = vi.fn().mockResolvedValue(ok(1));
    const mockDb = {
      transactions: {
        findById: vi.fn().mockResolvedValue(ok(transaction)),
        materializeTransactionNoteOverrides,
      },
    } as unknown as Pick<DataContext, 'transactions'>;
    const mockOverrideStore = createMockOverrideStore([
      createTransactionNoteEvent('tx:v2:kraken:1:trade-42', 'Moved to hardware wallet'),
    ]);

    const handler = new TransactionsEditHandler(mockDb, mockOverrideStore);
    const result = await handler.clearNote({
      transactionId: 42,
      reason: 'no longer needed',
    });

    expect(assertOk(result)).toMatchObject({
      action: 'clear',
      changed: true,
      transactionId: 42,
      reason: 'no longer needed',
    });
    expect(mockOverrideStore.append).toHaveBeenCalledWith({
      scope: 'transaction-note',
      payload: {
        type: 'transaction_note_override',
        action: 'clear',
        tx_fingerprint: 'tx:v2:kraken:1:trade-42',
      },
      reason: 'no longer needed',
    });
    expect(materializeTransactionNoteOverrides).toHaveBeenCalledWith({
      transactionIds: [42],
      notesByFingerprint: new Map(),
    });
  });

  it('returns changed=false when clearing a missing note', async () => {
    const transaction = createTransaction(42, 'trade-42');
    const materializeTransactionNoteOverrides = vi.fn().mockResolvedValue(ok(1));
    const mockDb = {
      transactions: {
        findById: vi.fn().mockResolvedValue(ok(transaction)),
        materializeTransactionNoteOverrides,
      },
    } as unknown as Pick<DataContext, 'transactions'>;
    const mockOverrideStore = createMockOverrideStore();

    const handler = new TransactionsEditHandler(mockDb, mockOverrideStore);
    const result = await handler.clearNote({
      transactionId: 42,
    });

    expect(assertOk(result)).toMatchObject({
      action: 'clear',
      changed: false,
      transactionId: 42,
    });
    expect(mockOverrideStore.append).not.toHaveBeenCalled();
    expect(materializeTransactionNoteOverrides).not.toHaveBeenCalled();
  });

  it('returns an error when the transaction does not exist', async () => {
    const mockDb = {
      transactions: {
        findById: vi.fn().mockResolvedValue(ok(undefined)),
        materializeTransactionNoteOverrides: vi.fn(),
      },
    } as unknown as Pick<DataContext, 'transactions'>;
    const mockOverrideStore = createMockOverrideStore();

    const handler = new TransactionsEditHandler(mockDb, mockOverrideStore);
    const result = await handler.setNote({
      transactionId: 999,
      message: 'Missing',
    });

    expect(assertErr(result).message).toContain('Transaction not found: 999');
  });
});
