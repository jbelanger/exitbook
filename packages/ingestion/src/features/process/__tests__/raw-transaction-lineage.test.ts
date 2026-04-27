import type { RawTransaction, TransactionDraft } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import type { AccountingJournalDraft, SourceActivityDraft } from '@exitbook/ledger';
import { describe, expect, it } from 'vitest';

import { buildAccountingLedgerWrites, buildProcessedTransactionWrites } from '../raw-transaction-lineage.js';

function createRawTransaction(overrides: Partial<RawTransaction> & { eventId: string; id: number }): RawTransaction {
  return {
    accountId: overrides.accountId ?? 1,
    blockchainTransactionHash: overrides.blockchainTransactionHash,
    createdAt: overrides.createdAt ?? new Date('2026-03-01T00:00:00.000Z'),
    eventId: overrides.eventId,
    id: overrides.id,
    normalizedData: overrides.normalizedData ?? {},
    processedAt: overrides.processedAt,
    processingStatus: overrides.processingStatus ?? 'pending',
    providerData: overrides.providerData ?? {},
    providerName: overrides.providerName ?? 'test-provider',
    sourceAddress: overrides.sourceAddress,
    timestamp: overrides.timestamp ?? Date.parse('2026-03-01T00:00:00.000Z'),
    transactionTypeHint: overrides.transactionTypeHint,
  };
}

function createExchangeTransactionDraft(componentEventIds: string[]): TransactionDraft {
  return {
    datetime: '2026-03-01T12:00:00.000Z',
    fees: [],
    identityMaterial: { componentEventIds },
    movements: {
      inflows: [
        {
          assetId: 'asset:btc',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('1'),
          netAmount: parseDecimal('1'),
        },
      ],
      outflows: [],
    },
    operation: { category: 'trade', type: 'buy' },
    platformKey: 'kraken',
    platformKind: 'exchange',
    status: 'success',
    timestamp: Date.parse('2026-03-01T12:00:00.000Z'),
  };
}

function createBlockchainTransactionDraft(transactionHash: string, platformKey = 'ethereum'): TransactionDraft {
  return {
    blockchain: {
      is_confirmed: true,
      name: platformKey,
      transaction_hash: transactionHash,
    },
    datetime: '2026-03-01T12:00:00.000Z',
    fees: [],
    movements: {
      inflows: [
        {
          assetId: 'blockchain:ethereum:native',
          assetSymbol: 'ETH' as Currency,
          grossAmount: parseDecimal('1'),
          netAmount: parseDecimal('1'),
        },
      ],
      outflows: [],
    },
    operation: { category: 'transfer', type: 'deposit' },
    platformKey,
    platformKind: 'blockchain',
    status: 'success',
    timestamp: Date.parse('2026-03-01T12:00:00.000Z'),
  };
}

function createExchangeLedgerSourceActivity(): SourceActivityDraft {
  return {
    ownerAccountId: 1,
    sourceActivityOrigin: 'provider_event',
    sourceActivityStableKey: 'provider-event-group:ref-1',
    sourceActivityFingerprint: 'source_activity:v1:exchange-ref-1',
    platformKey: 'kraken',
    platformKind: 'exchange',
    activityStatus: 'success',
    activityDatetime: '2026-03-01T12:00:00.000Z',
    activityTimestampMs: Date.parse('2026-03-01T12:00:00.000Z'),
  };
}

function createExchangeLedgerJournal(sourceActivity: SourceActivityDraft): AccountingJournalDraft {
  return {
    sourceActivityFingerprint: sourceActivity.sourceActivityFingerprint,
    journalStableKey: 'primary',
    journalKind: 'trade',
    postings: [
      {
        postingStableKey: 'movement:in:exchange:kraken:btc:1',
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC' as Currency,
        quantity: parseDecimal('1'),
        role: 'principal',
        balanceCategory: 'liquid',
        sourceComponentRefs: [
          {
            component: {
              sourceActivityFingerprint: sourceActivity.sourceActivityFingerprint,
              componentKind: 'exchange_fill',
              componentId: 'evt-1',
              assetId: 'exchange:kraken:btc',
            },
            quantity: parseDecimal('1'),
          },
        ],
      },
      {
        postingStableKey: 'fee:exchange:kraken:usd:1',
        assetId: 'exchange:kraken:usd',
        assetSymbol: 'USD' as Currency,
        quantity: parseDecimal('-2'),
        role: 'fee',
        balanceCategory: 'liquid',
        settlement: 'balance',
        sourceComponentRefs: [
          {
            component: {
              sourceActivityFingerprint: sourceActivity.sourceActivityFingerprint,
              componentKind: 'exchange_fee',
              componentId: 'evt-2',
              assetId: 'exchange:kraken:usd',
            },
            quantity: parseDecimal('2'),
          },
        ],
      },
    ],
  };
}

describe('buildProcessedTransactionWrites', () => {
  it('binds exchange transactions by component event ids', () => {
    const writes = assertOk(
      buildProcessedTransactionWrites({
        platformKey: 'kraken',
        platformKind: 'exchange-api',
        rawTransactions: [
          createRawTransaction({ eventId: 'evt-1', id: 11 }),
          createRawTransaction({ eventId: 'evt-2', id: 12 }),
        ],
        transactions: [createExchangeTransactionDraft(['evt-1', 'evt-2'])],
      })
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]?.rawTransactionIds).toEqual([11, 12]);
    expect(writes[0]?.transaction.identityMaterial).toEqual({ componentEventIds: ['evt-1', 'evt-2'] });
  });

  it('binds blockchain transactions by transaction hash', () => {
    const writes = assertOk(
      buildProcessedTransactionWrites({
        platformKey: 'ethereum',
        platformKind: 'blockchain',
        rawTransactions: [
          createRawTransaction({ blockchainTransactionHash: '0xabc', eventId: 'evt-1', id: 21 }),
          createRawTransaction({ blockchainTransactionHash: '0xabc', eventId: 'evt-2', id: 22 }),
          createRawTransaction({ blockchainTransactionHash: '0xdef', eventId: 'evt-3', id: 23 }),
        ],
        transactions: [createBlockchainTransactionDraft('0xabc')],
      })
    );

    expect(writes[0]?.rawTransactionIds).toEqual([21, 22]);
  });

  it('binds NEAR transactions across receipt-linked balance changes', () => {
    const writes = assertOk(
      buildProcessedTransactionWrites({
        platformKey: 'near',
        platformKind: 'blockchain',
        rawTransactions: [
          createRawTransaction({
            blockchainTransactionHash: 'near-tx-1',
            eventId: 'tx-event',
            id: 31,
            normalizedData: {
              eventId: 'tx-event',
              id: 'near-tx-1',
              receiverAccountId: 'receiver.near',
              signerAccountId: 'signer.near',
              streamType: 'transactions',
              timestamp: Date.parse('2026-03-01T12:00:00.000Z'),
              transactionHash: 'near-tx-1',
            },
          }),
          createRawTransaction({
            blockchainTransactionHash: 'near-tx-1',
            eventId: 'receipt-event',
            id: 32,
            normalizedData: {
              eventId: 'receipt-event',
              id: 'near-tx-1',
              predecessorAccountId: 'signer.near',
              receiptId: 'receipt-1',
              receiverAccountId: 'receiver.near',
              streamType: 'receipts',
              timestamp: Date.parse('2026-03-01T12:00:01.000Z'),
              transactionHash: 'near-tx-1',
            },
          }),
          createRawTransaction({
            blockchainTransactionHash: undefined,
            eventId: 'balance-change-event',
            id: 33,
            normalizedData: {
              absoluteNonstakedAmount: '100',
              absoluteStakedAmount: '0',
              affectedAccountId: 'wallet.near',
              blockHeight: '12345',
              cause: 'RECEIPT',
              direction: 'INBOUND',
              eventId: 'balance-change-event',
              id: 'near-tx-1',
              receiptId: 'receipt-1',
              streamType: 'balance-changes',
              timestamp: Date.parse('2026-03-01T12:00:02.000Z'),
              transactionHash: undefined,
            },
          }),
        ],
        transactions: [createBlockchainTransactionDraft('near-tx-1', 'near')],
      })
    );

    expect(writes[0]?.rawTransactionIds).toEqual([31, 32, 33]);
  });
});

describe('buildAccountingLedgerWrites', () => {
  it('binds exchange source activities by provider event source components', () => {
    const sourceActivity = createExchangeLedgerSourceActivity();
    const journal = createExchangeLedgerJournal(sourceActivity);

    const writes = assertOk(
      buildAccountingLedgerWrites({
        platformKind: 'exchange-api',
        rawTransactions: [
          createRawTransaction({ eventId: 'evt-1', id: 41 }),
          createRawTransaction({ eventId: 'evt-2', id: 42 }),
          createRawTransaction({ eventId: 'evt-zero-amount', id: 43 }),
        ],
        ledgerDrafts: [
          {
            sourceActivity,
            journals: [journal],
            sourceEventIds: ['evt-1', 'evt-2', 'evt-zero-amount'],
          },
        ],
      })
    );

    expect(writes).toEqual([
      {
        sourceActivity,
        journals: [journal],
        rawTransactionIds: [41, 42, 43],
      },
    ]);
  });

  it('rejects exchange ledger source components that point at another source activity', () => {
    const sourceActivity = createExchangeLedgerSourceActivity();
    const journal = createExchangeLedgerJournal(sourceActivity);
    const mismatchedJournal: AccountingJournalDraft = {
      ...journal,
      postings: [
        {
          ...journal.postings[0]!,
          sourceComponentRefs: [
            {
              component: {
                sourceActivityFingerprint: 'source_activity:v1:other',
                componentKind: 'exchange_fill',
                componentId: 'evt-1',
                assetId: 'exchange:kraken:btc',
              },
              quantity: parseDecimal('1'),
            },
          ],
        },
      ],
    };

    const result = buildAccountingLedgerWrites({
      platformKind: 'exchange-api',
      rawTransactions: [createRawTransaction({ eventId: 'evt-1', id: 41 })],
      ledgerDrafts: [
        {
          sourceActivity,
          journals: [mismatchedJournal],
        },
      ],
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('expected source_activity:v1:exchange-ref-1');
    }
  });
});
