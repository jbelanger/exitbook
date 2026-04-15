import type { CreateOverrideEventOptions, OverrideEvent, Transaction } from '@exitbook/core';
import { formatTransactionFingerprintRef } from '@exitbook/core';
import type { OverrideStore } from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import type { Currency } from '@exitbook/foundation';
import { err, ok, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { createPersistedTransaction } from '../../../shared/__tests__/transaction-test-utils.js';
import type { TransactionEditTarget } from '../transaction-edit-target.js';
import { TransactionsEditNoteHandler } from '../transactions-edit-note-handler.js';

const PROFILE_KEY = 'default';

function createTransaction(id: number, txFingerprintSeed = `ext-${id}`): Transaction {
  return createPersistedTransaction({
    id,
    accountId: 1,
    txFingerprint: `tx:v2:kraken:1:${txFingerprintSeed}`,
    platformKey: 'kraken',
    platformKind: 'exchange',
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
    profile_key: PROFILE_KEY,
    actor: 'user',
    source: 'cli',
    scope: 'transaction-user-note',
    payload: {
      type: 'transaction_user_note_override',
      action: 'set',
      tx_fingerprint: txFingerprint,
      message,
    },
  };
}

function toEditTarget(transaction: Transaction): TransactionEditTarget {
  return {
    accountId: transaction.accountId,
    platformKey: transaction.platformKey,
    transactionId: transaction.id,
    txFingerprint: transaction.txFingerprint,
    txRef: formatTransactionFingerprintRef(transaction.txFingerprint),
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
        profile_key: options.profileKey,
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
      .mockImplementation(async (_profileKey: string, scopes: OverrideEvent['scope'][]) =>
        ok(events.filter((event) => scopes.includes(event.scope)))
      ),
  };
}

describe('TransactionsEditNoteHandler', () => {
  it('appends a transaction note override when setting a new note', async () => {
    const transaction = createTransaction(42, 'trade-42');
    const materializeTransactionUserNoteOverrides = vi.fn().mockResolvedValue(ok(1));
    const mockDb = {
      transactions: {
        materializeTransactionUserNoteOverrides,
      },
    } as unknown as Pick<DataSession, 'transactions'>;
    const mockOverrideStore = createMockOverrideStore();

    const handler = new TransactionsEditNoteHandler(mockDb, mockOverrideStore);
    const result = await handler.setNote({
      profileKey: PROFILE_KEY,
      target: toEditTarget(transaction),
      message: 'Moved to hardware wallet',
      reason: 'manual reminder',
    });

    expect(assertOk(result)).toMatchObject({
      action: 'set',
      changed: true,
      note: 'Moved to hardware wallet',
      reason: 'manual reminder',
      transaction: {
        platformKey: 'kraken',
        txFingerprint: 'tx:v2:kraken:1:trade-42',
        txRef: formatTransactionFingerprintRef('tx:v2:kraken:1:trade-42'),
      },
    });
    expect(mockOverrideStore.append).toHaveBeenCalledWith({
      profileKey: PROFILE_KEY,
      scope: 'transaction-user-note',
      payload: {
        type: 'transaction_user_note_override',
        action: 'set',
        tx_fingerprint: 'tx:v2:kraken:1:trade-42',
        message: 'Moved to hardware wallet',
      },
      reason: 'manual reminder',
    });
    expect(materializeTransactionUserNoteOverrides).toHaveBeenCalledWith({
      transactionIds: [42],
      userNoteByFingerprint: new Map([
        [
          'tx:v2:kraken:1:trade-42',
          {
            message: 'Moved to hardware wallet',
            createdAt: '2026-03-15T12:05:00.000Z',
            author: 'user',
          },
        ],
      ]),
    });
  });

  it('does not append when the stored note already matches', async () => {
    const transaction = createTransaction(42, 'trade-42');
    const materializeTransactionUserNoteOverrides = vi.fn().mockResolvedValue(ok(0));
    const mockDb = {
      transactions: {
        materializeTransactionUserNoteOverrides,
      },
    } as unknown as Pick<DataSession, 'transactions'>;
    const mockOverrideStore = createMockOverrideStore([
      createTransactionNoteEvent('tx:v2:kraken:1:trade-42', 'Moved to hardware wallet'),
    ]);

    const handler = new TransactionsEditNoteHandler(mockDb, mockOverrideStore);
    const result = await handler.setNote({
      profileKey: PROFILE_KEY,
      target: toEditTarget(transaction),
      message: 'Moved to hardware wallet',
    });

    expect(assertOk(result)).toMatchObject({
      action: 'set',
      changed: false,
      note: 'Moved to hardware wallet',
      transaction: {
        txRef: formatTransactionFingerprintRef('tx:v2:kraken:1:trade-42'),
      },
    });
    expect(mockOverrideStore.append).not.toHaveBeenCalled();
    expect(materializeTransactionUserNoteOverrides).not.toHaveBeenCalled();
  });

  it('appends a clear event when clearing an existing note', async () => {
    const transaction = createTransaction(42, 'trade-42');
    const materializeTransactionUserNoteOverrides = vi.fn().mockResolvedValue(ok(1));
    const mockDb = {
      transactions: {
        materializeTransactionUserNoteOverrides,
      },
    } as unknown as Pick<DataSession, 'transactions'>;
    const mockOverrideStore = createMockOverrideStore([
      createTransactionNoteEvent('tx:v2:kraken:1:trade-42', 'Moved to hardware wallet'),
    ]);

    const handler = new TransactionsEditNoteHandler(mockDb, mockOverrideStore);
    const result = await handler.clearNote({
      profileKey: PROFILE_KEY,
      target: toEditTarget(transaction),
      reason: 'no longer needed',
    });

    expect(assertOk(result)).toMatchObject({
      action: 'clear',
      changed: true,
      reason: 'no longer needed',
      transaction: {
        txRef: formatTransactionFingerprintRef('tx:v2:kraken:1:trade-42'),
      },
    });
    expect(mockOverrideStore.append).toHaveBeenCalledWith({
      profileKey: PROFILE_KEY,
      scope: 'transaction-user-note',
      payload: {
        type: 'transaction_user_note_override',
        action: 'clear',
        tx_fingerprint: 'tx:v2:kraken:1:trade-42',
      },
      reason: 'no longer needed',
    });
    expect(materializeTransactionUserNoteOverrides).toHaveBeenCalledWith({
      transactionIds: [42],
      userNoteByFingerprint: new Map(),
    });
  });

  it('returns changed=false when clearing a missing note', async () => {
    const transaction = createTransaction(42, 'trade-42');
    const materializeTransactionUserNoteOverrides = vi.fn().mockResolvedValue(ok(1));
    const mockDb = {
      transactions: {
        materializeTransactionUserNoteOverrides,
      },
    } as unknown as Pick<DataSession, 'transactions'>;
    const mockOverrideStore = createMockOverrideStore();

    const handler = new TransactionsEditNoteHandler(mockDb, mockOverrideStore);
    const result = await handler.clearNote({
      profileKey: PROFILE_KEY,
      target: toEditTarget(transaction),
    });

    expect(assertOk(result)).toMatchObject({
      action: 'clear',
      changed: false,
      transaction: {
        txRef: formatTransactionFingerprintRef('tx:v2:kraken:1:trade-42'),
      },
    });
    expect(mockOverrideStore.append).not.toHaveBeenCalled();
    expect(materializeTransactionUserNoteOverrides).not.toHaveBeenCalled();
  });

  it('returns an error when note materialization fails', async () => {
    const transaction = createTransaction(42, 'trade-42');
    const mockDb = {
      transactions: {
        materializeTransactionUserNoteOverrides: vi.fn().mockResolvedValue(err(new Error('materialize failed'))),
      },
    } as unknown as Pick<DataSession, 'transactions'>;
    const mockOverrideStore = createMockOverrideStore();

    const handler = new TransactionsEditNoteHandler(mockDb, mockOverrideStore);
    const result = await handler.setNote({
      profileKey: PROFILE_KEY,
      target: toEditTarget(transaction),
      message: 'Missing',
    });

    expect(assertErr(result).message).toContain('Failed to materialize transaction user note override');
  });
});
