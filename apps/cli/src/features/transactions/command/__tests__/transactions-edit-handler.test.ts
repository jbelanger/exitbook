import type { Currency, OverrideEvent, UniversalTransactionData } from '@exitbook/core';
import { ok, parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import type { OverrideStore } from '@exitbook/data';
import { describe, expect, it, vi } from 'vitest';

import type { CommandDatabase } from '../../../shared/command-runtime.js';
import { TransactionsEditHandler } from '../transactions-edit-handler.js';

function createTransaction(id: number, externalId = `ext-${id}`): UniversalTransactionData {
  return {
    id,
    accountId: 1,
    externalId,
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
  };
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

function createStoredOverrideEvent(): OverrideEvent {
  return {
    id: 'override-event-1',
    created_at: '2026-03-15T12:05:00.000Z',
    actor: 'user',
    source: 'cli',
    scope: 'transaction-note',
    payload: {
      type: 'transaction_note_override',
      action: 'set',
      tx_fingerprint: 'tx:v2:kraken:1:trade-42',
      message: 'Moved to hardware wallet',
    },
  };
}

function createMockOverrideStore(): Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'> {
  return {
    append: vi.fn(),
    exists: vi.fn(),
    readByScopes: vi.fn(),
  };
}

describe('TransactionsEditHandler', () => {
  it('appends a transaction note override when setting a new note', async () => {
    const transaction = createTransaction(42, 'trade-42');
    const mockDb = {
      transactions: {
        findById: vi.fn().mockResolvedValue(ok(transaction)),
      },
    } as unknown as Pick<CommandDatabase, 'transactions'>;
    const mockOverrideStore = createMockOverrideStore();
    vi.mocked(mockOverrideStore.exists).mockReturnValue(false);
    vi.mocked(mockOverrideStore.append).mockResolvedValue(ok(createStoredOverrideEvent()));

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
      externalId: 'trade-42',
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
  });

  it('does not append when the stored note already matches', async () => {
    const transaction = createTransaction(42, 'trade-42');
    const mockDb = {
      transactions: {
        findById: vi.fn().mockResolvedValue(ok(transaction)),
      },
    } as unknown as Pick<CommandDatabase, 'transactions'>;
    const mockOverrideStore = createMockOverrideStore();
    vi.mocked(mockOverrideStore.exists).mockReturnValue(true);
    vi.mocked(mockOverrideStore.readByScopes).mockResolvedValue(
      ok([createTransactionNoteEvent('tx:v2:kraken:1:trade-42', 'Moved to hardware wallet')])
    );

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
  });

  it('appends a clear event when clearing an existing note', async () => {
    const transaction = createTransaction(42, 'trade-42');
    const mockDb = {
      transactions: {
        findById: vi.fn().mockResolvedValue(ok(transaction)),
      },
    } as unknown as Pick<CommandDatabase, 'transactions'>;
    const mockOverrideStore = createMockOverrideStore();
    vi.mocked(mockOverrideStore.exists).mockReturnValue(true);
    vi.mocked(mockOverrideStore.readByScopes).mockResolvedValue(
      ok([createTransactionNoteEvent('tx:v2:kraken:1:trade-42', 'Moved to hardware wallet')])
    );
    vi.mocked(mockOverrideStore.append).mockResolvedValue(ok(createStoredOverrideEvent()));

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
  });

  it('returns changed=false when clearing a missing note', async () => {
    const transaction = createTransaction(42, 'trade-42');
    const mockDb = {
      transactions: {
        findById: vi.fn().mockResolvedValue(ok(transaction)),
      },
    } as unknown as Pick<CommandDatabase, 'transactions'>;
    const mockOverrideStore = createMockOverrideStore();
    vi.mocked(mockOverrideStore.exists).mockReturnValue(false);

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
  });

  it('returns an error when the transaction does not exist', async () => {
    const mockDb = {
      transactions: {
        findById: vi.fn().mockResolvedValue(ok(undefined)),
      },
    } as unknown as Pick<CommandDatabase, 'transactions'>;
    const mockOverrideStore = createMockOverrideStore();
    vi.mocked(mockOverrideStore.exists).mockReturnValue(false);

    const handler = new TransactionsEditHandler(mockDb, mockOverrideStore);
    const result = await handler.setNote({
      transactionId: 999,
      message: 'Missing',
    });

    expect(assertErr(result).message).toContain('Transaction not found: 999');
  });
});
