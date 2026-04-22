import type { Transaction } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import {
  hasTransactionTransferDirectionOverride,
  hasTransactionTransferIntent,
  hasTransactionTransferReceiveIntent,
  hasTransactionTransferSendIntent,
} from '../transaction-transfer-intent.js';

function createTransaction(operation: Transaction['operation']): Pick<Transaction, 'operation'> {
  return { operation };
}

describe('transaction-transfer-intent', () => {
  it('uses raw transfer fallbacks when no interpretation override exists', () => {
    expect(hasTransactionTransferSendIntent(createTransaction({ category: 'transfer', type: 'withdrawal' }))).toBe(
      true
    );
    expect(hasTransactionTransferReceiveIntent(createTransaction({ category: 'transfer', type: 'deposit' }))).toBe(
      true
    );
    expect(hasTransactionTransferIntent(createTransaction({ category: 'transfer', type: 'transfer' }))).toBe(true);
  });

  it('treats bridge and asset migration labels as transfer intent overrides', () => {
    const transaction = createTransaction({ category: 'trade', type: 'buy' });

    expect(hasTransactionTransferSendIntent(transaction, { label: 'bridge/send' })).toBe(true);
    expect(hasTransactionTransferReceiveIntent(transaction, { label: 'bridge/send' })).toBe(false);
    expect(hasTransactionTransferDirectionOverride(transaction, { label: 'bridge/send' })).toBe(true);

    expect(hasTransactionTransferReceiveIntent(transaction, { label: 'asset migration/receive' })).toBe(true);
    expect(hasTransactionTransferSendIntent(transaction, { label: 'asset migration/receive' })).toBe(false);
    expect(hasTransactionTransferIntent(transaction, { label: 'asset migration/receive' })).toBe(true);
  });

  it('does not infer transfer intent from unrelated interpreted labels', () => {
    const transaction = createTransaction({ category: 'trade', type: 'buy' });

    expect(hasTransactionTransferDirectionOverride(transaction, { label: 'staking/reward' })).toBe(false);
    expect(hasTransactionTransferSendIntent(transaction, { label: 'staking/reward' })).toBe(false);
    expect(hasTransactionTransferReceiveIntent(transaction, { label: 'staking/reward' })).toBe(false);
    expect(hasTransactionTransferIntent(transaction, { label: 'staking/reward' })).toBe(false);
  });
});
