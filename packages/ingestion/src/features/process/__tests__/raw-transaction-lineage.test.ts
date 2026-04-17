import type { RawTransaction, TransactionDraft } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { buildProcessedTransactionWrites } from '../raw-transaction-lineage.js';

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
