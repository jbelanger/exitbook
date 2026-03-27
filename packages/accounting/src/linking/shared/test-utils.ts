import type { Transaction, TransactionLink } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import { materializeTestTransaction, seedTxFingerprint } from '../../__tests__/test-utils.js';
import type { LinkableMovement } from '../matching/linkable-movement.js';

/**
 * Creates a LinkableMovement with sensible defaults for testing.
 * Override only the fields relevant to the test.
 */
export function createLinkableMovement(overrides: Partial<LinkableMovement> = {}): LinkableMovement {
  const id = overrides.id ?? 1;
  return {
    id,
    transactionId: id,
    accountId: 1,
    platformKey: 'kraken',
    platformKind: 'exchange',
    assetId: 'test:btc',
    assetSymbol: 'BTC' as Currency,
    direction: 'out',
    amount: parseDecimal('1.0'),
    timestamp: new Date('2024-01-01T12:00:00Z'),
    isInternal: false,
    excluded: false,
    movementFingerprint: 'movement:test:tx:outflow:0',
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
  sourceMovementFingerprint?: string | undefined;
  sourceTransactionId: number;
  targetAmount: Decimal;
  targetMovementFingerprint?: string | undefined;
  targetTransactionId: number;
}): TransactionLink {
  const asset = params.assetSymbol.toLowerCase();
  return {
    id: params.id,
    sourceTransactionId: params.sourceTransactionId,
    targetTransactionId: params.targetTransactionId,
    assetSymbol: params.assetSymbol as Currency,
    sourceAssetId: `exchange:source:${asset}`,
    targetAssetId: `blockchain:target:${asset}`,
    sourceAmount: params.sourceAmount,
    targetAmount: params.targetAmount,
    sourceMovementFingerprint:
      params.sourceMovementFingerprint ?? `movement:exchange:source:${params.sourceTransactionId}:${asset}:outflow:0`,
    targetMovementFingerprint:
      params.targetMovementFingerprint ?? `movement:blockchain:target:${params.targetTransactionId}:${asset}:inflow:0`,
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

export function requirePresent<T>(value: T | null | undefined, message: string): T {
  if (value == undefined) {
    throw new Error(message);
  }

  return value;
}

/**
 * Creates a minimal Transaction for testing.
 * Only requires essential fields; the rest are set to sensible defaults.
 */
export function createTransaction(params: {
  accountId?: number;
  blockchain?: { is_confirmed: boolean; name: string; transaction_hash: string };
  datetime: string;
  from?: string;
  id: number;
  inflows?: { amount: string; assetId?: string | undefined; assetSymbol: string; netAmount?: string | undefined }[];
  outflows?: { amount: string; assetId?: string | undefined; assetSymbol: string; netAmount?: string | undefined }[];
  platformKind?: 'blockchain' | 'exchange';
  source: string;
  to?: string;
}): Transaction {
  const platformKind = params.platformKind ?? (params.blockchain ? 'blockchain' : 'exchange');
  const accountId = params.accountId ?? 1;
  const identityReference = `${params.source}-${params.id}`;
  const blockchain =
    platformKind === 'blockchain'
      ? (params.blockchain ?? {
          is_confirmed: true,
          name: params.source,
          transaction_hash: identityReference,
        })
      : undefined;
  const txFingerprint = seedTxFingerprint(params.source, platformKind, accountId, identityReference);

  return materializeTestTransaction({
    id: params.id,
    accountId,
    datetime: params.datetime,
    timestamp: new Date(params.datetime).getTime(),
    platformKey: params.source,
    platformKind,
    status: 'success',
    from: params.from,
    to: params.to,
    movements: {
      inflows:
        params.inflows?.map((movement) => ({
          assetId: movement.assetId ?? `test:${movement.assetSymbol.toLowerCase()}`,
          assetSymbol: movement.assetSymbol as Currency,
          grossAmount: parseDecimal(movement.amount),
          netAmount: movement.netAmount ? parseDecimal(movement.netAmount) : parseDecimal(movement.amount),
        })) ?? [],
      outflows:
        params.outflows?.map((movement) => ({
          assetId: movement.assetId ?? `test:${movement.assetSymbol.toLowerCase()}`,
          assetSymbol: movement.assetSymbol as Currency,
          grossAmount: parseDecimal(movement.amount),
          netAmount: movement.netAmount ? parseDecimal(movement.netAmount) : parseDecimal(movement.amount),
        })) ?? [],
    },
    fees: [],
    operation: {
      category: 'transfer',
      type: 'transfer',
    },
    blockchain,
    txFingerprint,
  });
}
