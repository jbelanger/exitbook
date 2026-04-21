import { describe, expect, it } from 'vitest';

import type { TransactionViewItem } from '../../transactions-view-model.js';
import { buildTransactionStaticDetail, buildTransactionsStaticList } from '../transactions-static-renderer.js';
import { createTransactionsViewState } from '../transactions-view-state.js';

const ansiPattern = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g');

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, '');
}

function createTransactionViewItem(overrides: Partial<TransactionViewItem> = {}): TransactionViewItem {
  return {
    id: 42,
    platformKey: 'kraken',
    platformKind: 'exchange',
    txFingerprint: '1234567890abcdef-transaction',
    datetime: '2026-03-01T12:00:00.000Z',
    operationGroup: 'trade',
    operationLabel: 'trade/buy',
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
    annotations: [],
    diagnostics: [],
    userNotes: [],
    excludedFromAccounting: false,
    ...overrides,
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
        createTransactionViewItem({
          operationLabel: 'trade/swap',
          debitSummary: '250 CAD',
          creditSummary: '0.0035 BTC',
          feeSummary: '1.25 CAD',
          primaryMovementAsset: 'CAD',
          primaryMovementAmount: '250',
          primaryMovementDirection: 'out',
        }),
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
        createTransactionViewItem({
          operationGroup: 'transfer',
          operationLabel: 'transfer/deposit',
          debitSummary: undefined,
          creditSummary: '2 ETH',
          feeSummary: undefined,
          primaryMovementAsset: 'ETH',
          primaryMovementAmount: '2',
          primaryMovementDirection: 'in',
        }),
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
      fromOwnership: 'owned',
      to: '0x99361540189079095a96f7145b6db3b6bf0104ac',
      toOwnership: 'unknown',
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
    expect(stripAnsi(output)).toContain('Operation: trade/buy');
    expect(stripAnsi(output)).toContain('Debit: 48,250 USD');
    expect(stripAnsi(output)).toContain('Credit: 1.25 BTC');
    expect(stripAnsi(output)).toContain('Fees: 12.5 USD');
    expect(stripAnsi(output)).toContain('Primary movement: 1.25000000 BTC IN');
    expect(stripAnsi(output)).toContain('From: 0x15a2aa147781b08a0105d678386ea63e6ca06281 [owned]');
    expect(stripAnsi(output)).toContain('To: 0x99361540189079095a96f7145b6db3b6bf0104ac [unknown]');
    expect(stripAnsi(output)).toContain('+ 1.25 BTC · 1234567890:1');
    expect(stripAnsi(output)).toContain('+ 10.5 ADA [staking_reward] · fedcba0987:2');
  });

  it('renders cross-profile ownership inline when the endpoint belongs to another profile', () => {
    const output = buildTransactionStaticDetail({
      ...createTransactionViewItem(),
      from: '0xactiveprofilewallet',
      fromOwnership: 'owned',
      to: '0xotherprofilewallet',
      toOwnership: 'other-profile',
    });

    expect(stripAnsi(output)).toContain('From: 0xactiveprofilewallet [owned]');
    expect(stripAnsi(output)).toContain('To: 0xotherprofilewallet [other-profile]');
  });

  it('renders source lineage and full source data when present', () => {
    const output = buildTransactionStaticDetail({
      ...createTransactionViewItem(),
      sourceLineage: [
        {
          rawTransactionId: 700,
          providerName: 'kraken',
          eventId: 'evt-123',
          timestamp: '2026-03-01T12:00:00.000Z',
          processingStatus: 'processed',
          transactionTypeHint: 'trade',
          blockchainTransactionHash: undefined,
          sourceAddress: undefined,
        },
      ],
      sourceData: [
        {
          rawTransactionId: 700,
          providerName: 'kraken',
          eventId: 'evt-123',
          timestamp: '2026-03-01T12:00:00.000Z',
          processingStatus: 'processed',
          transactionTypeHint: 'trade',
          blockchainTransactionHash: undefined,
          sourceAddress: undefined,
          providerPayload: { amount: '1.25' },
          normalizedPayload: { normalized: true },
        },
      ],
    });

    expect(stripAnsi(output)).toContain('Source lineage (1)');
    expect(stripAnsi(output)).toContain('Source data (1)');
    expect(stripAnsi(output)).toContain('Raw #700');
    expect(stripAnsi(output)).toContain('provider=kraken');
    expect(stripAnsi(output)).toContain('event=evt-123');
    expect(stripAnsi(output)).toContain('providerPayload:');
    expect(stripAnsi(output)).toContain('"amount": "1.25"');
    expect(stripAnsi(output)).toContain('normalizedPayload:');
    expect(stripAnsi(output)).toContain('"normalized": true');
  });

  it('renders interpretation details when annotations are present', () => {
    const output = buildTransactionStaticDetail({
      ...createTransactionViewItem(),
      operationGroup: 'transfer',
      operationLabel: 'bridge/send',
      annotations: [
        {
          annotationFingerprint: 'annotation-1',
          accountId: 42,
          transactionId: 42,
          txFingerprint: '1234567890abcdef-transaction',
          kind: 'bridge_participant',
          tier: 'heuristic',
          target: { scope: 'transaction' },
          role: 'source',
          detectorId: 'heuristic-bridge-participant',
          derivedFromTxIds: [42, 99],
          provenanceInputs: ['timing', 'counterparty'],
          metadata: {
            counterpartTxFingerprint: 'arb-bridge-counterpart',
            sourceChain: 'ethereum',
            destinationChain: 'arbitrum',
          },
        },
      ],
    });

    expect(stripAnsi(output)).toContain('Operation: bridge/send');
    expect(stripAnsi(output)).toContain('Interpretation (1)');
    expect(stripAnsi(output)).toContain('bridge source [heuristic');
    expect(stripAnsi(output)).toContain('ethereum -> arbitrum');
    expect(stripAnsi(output)).toContain('counterpart arb-bridge');
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
