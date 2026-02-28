import { type Currency, type UniversalTransactionData, parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { TransactionCandidate, TransactionLink } from '../types.js';

/**
 * Creates a TransactionCandidate with sensible defaults for testing.
 * Override only the fields relevant to the test.
 */
export function createCandidate(overrides: Partial<TransactionCandidate> = {}): TransactionCandidate {
  return {
    id: 1,
    sourceName: 'kraken',
    sourceType: 'exchange',
    timestamp: new Date('2024-01-01T12:00:00Z'),
    assetId: 'test:btc',
    assetSymbol: 'BTC' as Currency,
    amount: parseDecimal('1.0'),
    direction: 'out',
    ...overrides,
  };
}

/**
 * Creates a TransactionLink with sensible defaults for testing.
 * Provide id, sourceTransactionId, targetTransactionId, assetSymbol, sourceAmount, targetAmount;
 * everything else defaults to a confirmed BTC exchange_to_blockchain link.
 */
export function createLink(params: {
  assetSymbol: string;
  id: number;
  sourceAmount: Decimal;
  sourceTransactionId: number;
  targetAmount: Decimal;
  targetTransactionId: number;
}): TransactionLink {
  return {
    id: params.id,
    sourceTransactionId: params.sourceTransactionId,
    targetTransactionId: params.targetTransactionId,
    assetSymbol: params.assetSymbol as Currency,
    sourceAssetId: params.assetSymbol,
    targetAssetId: params.assetSymbol,
    sourceAmount: params.sourceAmount,
    targetAmount: params.targetAmount,
    linkType: 'exchange_to_blockchain',
    confidenceScore: parseDecimal('0.95'),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('0.9995'),
      timingValid: true,
      timingHours: 1,
    },
    status: 'confirmed',
    reviewedBy: 'auto',
    reviewedAt: new Date('2024-01-01T12:00:00Z'),
    createdAt: new Date('2024-01-01T12:00:00Z'),
    updatedAt: new Date('2024-01-01T12:00:00Z'),
  };
}

/**
 * Creates a minimal UniversalTransactionData for testing.
 * Only requires essential fields; the rest are set to sensible defaults.
 */
export function createTransaction(params: {
  blockchain?: { is_confirmed: boolean; name: string; transaction_hash: string };
  datetime: string;
  from?: string;
  id: number;
  inflows?: { amount: string; assetSymbol: string }[];
  outflows?: { amount: string; assetSymbol: string }[];
  source: string;
  sourceType?: 'blockchain' | 'exchange';
  to?: string;
}): UniversalTransactionData {
  const sourceType = params.sourceType ?? (params.blockchain ? 'blockchain' : 'exchange');
  return {
    id: params.id,
    accountId: 1,
    externalId: `${params.source}-${params.id}`,
    datetime: params.datetime,
    timestamp: new Date(params.datetime).getTime(),
    source: params.source,
    sourceType,
    status: 'success',
    from: params.from,
    to: params.to,
    movements: {
      inflows: params.inflows
        ? params.inflows.map((m) => ({
            assetId: `test:${m.assetSymbol.toLowerCase()}`,
            assetSymbol: m.assetSymbol as Currency,
            grossAmount: parseDecimal(m.amount),
          }))
        : [],
      outflows: params.outflows
        ? params.outflows.map((m) => ({
            assetId: `test:${m.assetSymbol.toLowerCase()}`,
            assetSymbol: m.assetSymbol as Currency,
            grossAmount: parseDecimal(m.amount),
          }))
        : [],
    },
    fees: [],
    operation: {
      category: 'transfer',
      type: 'transfer',
    },
    blockchain: params.blockchain,
  };
}
