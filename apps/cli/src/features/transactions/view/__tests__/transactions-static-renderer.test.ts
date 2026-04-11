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
    debitSummary: '48,250 USD',
    creditSummary: '1.25 BTC',
    feeSummary: '12.5 USD',
    primaryMovementAsset: 'BTC',
    primaryMovementAmount: '1.25000000',
    primaryMovementDirection: 'in',
    inflows: [],
    outflows: [],
    fees: [],
    priceStatus: 'all',
    blockchain: undefined,
    from: undefined,
    to: undefined,
    diagnostics: [],
    userNotes: [],
    excludedFromAccounting: false,
    hasSpamDiagnostic: false,
  };
}

describe('transactions static renderer', () => {
  it('labels the transaction list ref column as TX-REF', () => {
    const state = createTransactionsViewState([createTransactionViewItem()], {}, 1);

    const output = buildTransactionsStaticList(state);

    expect(stripAnsi(output)).toContain('TX-REF');
    expect(stripAnsi(output)).toContain('DEBIT');
    expect(stripAnsi(output)).toContain('CREDIT');
    expect(stripAnsi(output)).toContain('FEES');
  });

  it('renders debit, credit, and fee summaries for two-sided trades', () => {
    const state = createTransactionsViewState(
      [
        {
          ...createTransactionViewItem(),
          operationType: 'swap',
          debitSummary: '250 CAD',
          creditSummary: '0.0035 BTC',
          feeSummary: '1.25 CAD',
          primaryMovementAsset: 'CAD',
          primaryMovementAmount: '250',
          primaryMovementDirection: 'out',
        },
      ],
      {},
      1
    );

    const output = buildTransactionsStaticList(state);

    expect(stripAnsi(output)).toContain('250 CAD');
    expect(stripAnsi(output)).toContain('0.0035 BTC');
    expect(stripAnsi(output)).toContain('1.25 CAD');
  });

  it('renders em dashes for empty debit, credit, or fee columns', () => {
    const state = createTransactionsViewState(
      [
        {
          ...createTransactionViewItem(),
          operationCategory: 'transfer',
          operationType: 'deposit',
          debitSummary: undefined,
          creditSummary: '2 ETH',
          feeSummary: undefined,
          primaryMovementAsset: 'ETH',
          primaryMovementAmount: '2',
          primaryMovementDirection: 'in',
        },
      ],
      {},
      1
    );

    const output = buildTransactionsStaticList(state);

    expect(stripAnsi(output)).toContain('2 ETH');
    expect(stripAnsi(output)).toContain('—');
  });

  it('labels the shortened selector in detail as Transaction ref', () => {
    const output = buildTransactionStaticDetail(createTransactionViewItem());

    expect(stripAnsi(output)).toContain('Transaction ref: 1234567890');
    expect(stripAnsi(output)).toContain('Fingerprint: 1234567890abcdef-transaction');
    expect(stripAnsi(output)).toContain('Debit: 48,250 USD');
    expect(stripAnsi(output)).toContain('Credit: 1.25 BTC');
    expect(stripAnsi(output)).toContain('Fees: 12.5 USD');
    expect(stripAnsi(output)).toContain('Primary movement: 1.25000000 BTC IN');
  });
});
