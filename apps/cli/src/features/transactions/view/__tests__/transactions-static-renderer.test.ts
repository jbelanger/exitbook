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

  it('shows the active account filter in the list header', () => {
    const state = createTransactionsViewState([createTransactionViewItem()], { accountFilter: 'wallet-main' }, 1);

    const output = buildTransactionsStaticList(state);

    expect(stripAnsi(output)).toContain('Transactions (wallet-main)');
  });

  it('labels the shortened selector in detail as Transaction ref', () => {
    const output = buildTransactionStaticDetail({
      ...createTransactionViewItem(),
      platformKind: 'blockchain',
      from: '0x15a2aa147781b08a0105d678386ea63e6ca06281',
      fromOwnership: 'tracked',
      to: '0x99361540189079095a96f7145b6db3b6bf0104ac',
      toOwnership: 'untracked',
      inflows: [
        {
          movementFingerprint: 'movement:1234567890abcdef1234567890abcdef:1',
          movementRole: 'principal',
          assetSymbol: 'BTC',
          amount: '1.25',
        },
        {
          movementFingerprint: 'movement:fedcba0987654321fedcba0987654321:2',
          movementRole: 'staking_reward',
          assetSymbol: 'ADA',
          amount: '10.5',
        },
      ],
    });

    expect(stripAnsi(output)).toContain('Transaction ref: 1234567890');
    expect(stripAnsi(output)).toContain('Fingerprint: 1234567890abcdef-transaction');
    expect(stripAnsi(output)).toContain('Debit: 48,250 USD');
    expect(stripAnsi(output)).toContain('Credit: 1.25 BTC');
    expect(stripAnsi(output)).toContain('Fees: 12.5 USD');
    expect(stripAnsi(output)).toContain('Primary movement: 1.25000000 BTC IN');
    expect(stripAnsi(output)).toContain('From: 0x15a2aa147781b08a0105d678386ea63e6ca06281 [tracked]');
    expect(stripAnsi(output)).toContain('To: 0x99361540189079095a96f7145b6db3b6bf0104ac [untracked]');
    expect(stripAnsi(output)).toContain('+ 1.25 BTC · 1234567890:1');
    expect(stripAnsi(output)).toContain('+ 10.5 ADA [staking_reward] · fedcba0987:2');
  });

  it('renders linked raw source data when present', () => {
    const output = buildTransactionStaticDetail({
      ...createTransactionViewItem(),
      rawSources: [
        {
          accountId: 1,
          blockchainTransactionHash: undefined,
          createdAt: new Date('2026-03-01T12:10:00.000Z'),
          eventId: 'evt-123',
          id: 700,
          normalizedData: { normalized: true },
          processedAt: new Date('2026-03-01T12:10:01.000Z'),
          processingStatus: 'processed',
          providerData: { amount: '1.25' },
          providerName: 'kraken',
          sourceAddress: undefined,
          timestamp: Date.parse('2026-03-01T12:00:00.000Z'),
          transactionTypeHint: 'trade',
        },
      ],
    });

    expect(stripAnsi(output)).toContain('Source data (1)');
    expect(stripAnsi(output)).toContain('Raw #700');
    expect(stripAnsi(output)).toContain('provider=kraken');
    expect(stripAnsi(output)).toContain('event=evt-123');
    expect(stripAnsi(output)).toContain('providerData:');
    expect(stripAnsi(output)).toContain('"amount": "1.25"');
    expect(stripAnsi(output)).toContain('normalizedData:');
    expect(stripAnsi(output)).toContain('"normalized": true');
  });

  it('renders related investigation context when present', () => {
    const output = buildTransactionStaticDetail({
      ...createTransactionViewItem(),
      relatedContext: {
        fromAccount: {
          accountName: 'wallet-main',
          accountRef: 'abc1234567',
          platformKey: 'ethereum',
        },
        openGapRefs: ['gap1234567', 'gap7654321'],
        sameHashSiblingTransactionCount: 3,
        sameHashSiblingTransactionRefs: ['tx11111111', 'tx22222222', 'tx33333333'],
        sharedFromTransactionCount: 6,
        sharedFromTransactionRefs: ['from111111', 'from222222', 'from333333', 'from444444', 'from555555'],
        toAccount: {
          accountRef: 'def1234567',
          platformKey: 'arbitrum',
        },
      },
    });

    expect(stripAnsi(output)).toContain('Related context');
    expect(stripAnsi(output)).toContain('From account: wallet-main (abc1234567) ethereum');
    expect(stripAnsi(output)).toContain('To account: (def1234567) arbitrum');
    expect(stripAnsi(output)).toContain('Open gap refs: gap1234567, gap7654321');
    expect(stripAnsi(output)).toContain('Same-hash sibling txs: tx11111111, tx22222222, tx33333333');
    expect(stripAnsi(output)).toContain(
      'Same from endpoint txs: from111111, from222222, from333333, from444444, from555555 (6 total)'
    );
  });
});
