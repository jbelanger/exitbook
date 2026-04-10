import { describe, expect, it } from 'vitest';

import type { TransactionViewItem } from '../../transactions-view-model.js';
import { buildTransactionStaticDetail, buildTransactionsStaticList } from '../transactions-static-renderer.js';
import { createTransactionsViewState } from '../transactions-view-state.js';

const ansiPattern = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g');

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, '');
}

function createTransactionViewItem(): TransactionViewItem {
  return {
    id: 42,
    platformKey: 'kraken',
    platformKind: 'exchange',
    txFingerprint: '1234567890abcdef-transaction',
    datetime: '2026-03-01T12:00:00.000Z',
    operationCategory: 'trade',
    operationType: 'buy',
    primaryAsset: 'BTC',
    primaryAmount: '1.25000000',
    primaryDirection: 'in',
    inflows: [],
    outflows: [],
    fees: [],
    priceStatus: 'all',
    blockchain: undefined,
    from: undefined,
    to: undefined,
    notes: [],
    excludedFromAccounting: false,
    isSpam: false,
  };
}

describe('transactions static renderer', () => {
  it('labels the transaction list ref column as TX-REF', () => {
    const state = createTransactionsViewState([createTransactionViewItem()], {}, 1);

    const output = buildTransactionsStaticList(state);

    expect(stripAnsi(output)).toContain('TX-REF');
  });

  it('labels the shortened selector in detail as Transaction ref', () => {
    const output = buildTransactionStaticDetail(createTransactionViewItem());

    expect(stripAnsi(output)).toContain('Transaction ref: 1234567890');
    expect(stripAnsi(output)).toContain('Fingerprint: 1234567890abcdef-transaction');
  });
});
