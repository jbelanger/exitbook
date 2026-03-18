import { createHash } from 'node:crypto';

import type { AssetMovement, FeeMovement, OperationType, PriceAtTxTime, Transaction } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/core';

import type { AcquisitionLot, LotDisposal } from '../cost-basis/model/types.js';

function sha256Hex(material: string): string {
  return createHash('sha256').update(material).digest('hex');
}

export function seedTxFingerprint(params: {
  accountId: number;
  blockchainTransactionHash?: string | undefined;
  componentEventIds?: string[] | undefined;
  externalId: string;
  source: string;
  sourceType: 'blockchain' | 'exchange';
}): string {
  const accountFingerprint = sha256Hex(
    `${params.sourceType === 'blockchain' ? 'blockchain' : 'exchange-api'}|${params.source}|identifier-${params.accountId}`
  );

  const fingerprintMaterial =
    params.sourceType === 'blockchain'
      ? `${accountFingerprint}|blockchain|${params.source}|${(params.blockchainTransactionHash ?? params.externalId).trim()}`
      : `${accountFingerprint}|exchange|${params.source}|${(params.componentEventIds ?? [params.externalId])
          .map((eventId) => eventId.trim())
          .sort()
          .join('|')}`;

  return sha256Hex(fingerprintMaterial);
}

export function materializeTestTransaction(
  transaction: Omit<Transaction, 'txFingerprint'> & { txFingerprint?: string | undefined }
): Transaction {
  const externalId = transaction.externalId.trim() || `tx-${transaction.id}`;
  const blockchain =
    transaction.sourceType === 'blockchain'
      ? (transaction.blockchain ?? {
          name: transaction.source,
          transaction_hash: externalId,
          is_confirmed: true,
        })
      : transaction.blockchain;

  return {
    ...transaction,
    externalId,
    blockchain,
    txFingerprint:
      transaction.txFingerprint?.trim() ||
      seedTxFingerprint({
        accountId: transaction.accountId,
        blockchainTransactionHash: blockchain?.transaction_hash,
        externalId,
        source: transaction.source,
        sourceType: transaction.sourceType,
      }),
  };
}

/**
 * Creates a PriceAtTxTime object with common defaults
 */
export function createPriceAtTxTime(
  amount: string,
  currency = 'USD',
  options?: {
    fetchedAt?: Date;
    granularity?: 'exact' | 'minute' | 'hour' | 'day';
    quotedAmount?: string;
    quotedCurrency?: string;
    source?: string;
  }
): PriceAtTxTime {
  return {
    price: {
      amount: parseDecimal(amount),
      currency: currency as Currency,
    },
    quotedPrice:
      options?.quotedAmount && options?.quotedCurrency
        ? {
            amount: parseDecimal(options.quotedAmount),
            currency: options.quotedCurrency as Currency,
          }
        : undefined,
    source: options?.source ?? 'manual',
    fetchedAt: options?.fetchedAt ?? new Date('2024-01-01'),
    granularity: options?.granularity ?? 'exact',
  };
}

/**
 * Creates an AssetMovement object. If priceAmount is omitted, no priceAtTxTime is set.
 */
export function createMovement(
  assetSymbol: string,
  amount: string,
  priceAmount?: string,
  currency = 'USD'
): AssetMovement {
  return {
    assetId: `test:${assetSymbol.toLowerCase()}`,
    assetSymbol: assetSymbol as Currency,
    grossAmount: parseDecimal(amount),
    ...(priceAmount !== undefined ? { priceAtTxTime: createPriceAtTxTime(priceAmount, currency) } : {}),
  };
}

/**
 * Creates a FeeMovement with explicit scope and settlement positional args.
 * Use this when you need to specify scope/settlement directly.
 * For simple platform fees, use createFee() instead.
 */
export function createFeeMovement(
  scope: 'network' | 'platform' | 'spread' | 'tax' | 'other',
  settlement: 'on-chain' | 'balance' | 'external',
  assetSymbol: string,
  amount: string,
  priceAmount?: string,
  priceCurrency = 'USD'
): FeeMovement {
  return {
    assetId: `test:${assetSymbol.toLowerCase()}`,
    assetSymbol: assetSymbol as Currency,
    scope,
    settlement,
    amount: parseDecimal(amount),
    priceAtTxTime: priceAmount !== undefined ? createPriceAtTxTime(priceAmount, priceCurrency) : undefined,
  };
}

/**
 * Creates a FeeMovement object with common defaults
 */
export function createFee(
  assetSymbol: string,
  amount: string,
  options?: {
    currency?: string;
    priceAmount?: string;
    scope?: 'platform' | 'network';
    settlement?: 'balance' | 'on-chain';
  }
): FeeMovement {
  return {
    assetId: `test:${assetSymbol.toLowerCase()}`,
    assetSymbol: assetSymbol as Currency,
    amount: parseDecimal(amount),
    scope: options?.scope ?? 'platform',
    settlement: options?.settlement ?? 'balance',
    priceAtTxTime: options?.priceAmount
      ? createPriceAtTxTime(options.priceAmount, options?.currency ?? 'USD')
      : undefined,
  };
}

/**
 * Creates a blockchain Transaction with a tx hash.
 */
export function createBlockchainTx(params: {
  accountId: number;
  datetime: string;
  externalId: string;
  fees?: FeeMovement[] | undefined;
  id: number;
  inflows?: AssetMovement[] | undefined;
  outflows?: AssetMovement[] | undefined;
  txHash: string;
}): Transaction {
  return materializeTestTransaction({
    id: params.id,
    accountId: params.accountId,
    externalId: params.externalId,
    datetime: params.datetime,
    timestamp: new Date(params.datetime).getTime(),
    source: 'bitcoin',
    sourceType: 'blockchain',
    status: 'success',
    movements: {
      inflows: params.inflows ?? [],
      outflows: params.outflows ?? [],
    },
    fees: params.fees ?? [],
    operation: {
      category: 'transfer',
      type: 'transfer',
    },
    blockchain: {
      name: 'bitcoin',
      transaction_hash: params.txHash,
      is_confirmed: true,
    },
  });
}

/**
 * Creates an exchange Transaction.
 */
export function createExchangeTx(params: {
  accountId: number;
  datetime: string;
  externalId: string;
  id: number;
  inflows?: AssetMovement[] | undefined;
  source: string;
  type: 'buy' | 'deposit';
}): Transaction {
  return materializeTestTransaction({
    id: params.id,
    accountId: params.accountId,
    externalId: params.externalId,
    datetime: params.datetime,
    timestamp: new Date(params.datetime).getTime(),
    source: params.source,
    sourceType: 'exchange',
    status: 'success',
    movements: {
      inflows: params.inflows ?? [],
      outflows: [],
    },
    fees: [],
    operation: {
      category: 'transfer',
      type: params.type,
    },
  });
}

/**
 * Creates a Transaction with common defaults.
 * Inflows and outflows are specified as convenience objects with price.
 */
export function createTransaction(
  id: number,
  datetime: string,
  inflows: { amount: string; assetSymbol: string; price: string }[],
  outflows: { amount: string; assetSymbol: string; price: string }[] = [],
  options?: {
    category?: 'trade' | 'transfer';
    fees?: FeeMovement[];
    source?: string;
    sourceType?: 'exchange' | 'blockchain';
    type?: OperationType;
  }
): Transaction {
  const fees: FeeMovement[] = options?.fees ?? [];
  const accountId = 1;
  const externalId = `ext-${id}`;
  const source = options?.source ?? 'test';
  const sourceType = options?.sourceType ?? 'exchange';
  const blockchain =
    sourceType === 'blockchain'
      ? {
          name: source,
          transaction_hash: externalId,
          is_confirmed: true,
        }
      : undefined;
  return materializeTestTransaction({
    id,
    accountId,
    externalId,
    datetime,
    timestamp: new Date(datetime).getTime(),
    source,
    sourceType,
    status: 'success',
    movements: {
      inflows: inflows.map((i) => createMovement(i.assetSymbol, i.amount, i.price)),
      outflows: outflows.map((o) => createMovement(o.assetSymbol, o.amount, o.price)),
    },
    operation: {
      category: options?.category ?? 'trade',
      type: options?.type ?? (inflows.length > 0 ? 'buy' : 'sell'),
    },
    fees,
    blockchain,
  });
}

/**
 * Creates a Transaction from raw AssetMovement arrays.
 * Use when you need to pass movements with specific priceAtTxTime already set.
 */
export function createTransactionFromMovements(
  id: number,
  datetime: string,
  movements: { inflows?: AssetMovement[]; outflows?: AssetMovement[] } = {},
  fees: FeeMovement[] = [],
  options?: {
    category?: 'trade' | 'transfer';
    source?: string;
    sourceType?: 'exchange' | 'blockchain';
    type?: OperationType;
  }
): Transaction {
  const accountId = 1;
  const externalId = `ext-${id}`;
  const source = options?.source ?? 'test';
  const sourceType = options?.sourceType ?? 'exchange';
  const blockchain =
    sourceType === 'blockchain'
      ? {
          name: source,
          transaction_hash: externalId,
          is_confirmed: true,
        }
      : undefined;
  return materializeTestTransaction({
    id,
    accountId,
    externalId,
    source,
    sourceType,
    datetime,
    timestamp: new Date(datetime).getTime(),
    status: 'success',
    movements: {
      inflows: movements.inflows ?? [],
      outflows: movements.outflows ?? [],
    },
    fees,
    operation: {
      category: options?.category ?? 'trade',
      type: options?.type ?? 'buy',
    },
    blockchain,
  });
}

/**
 * Creates a Transaction with fees
 */
export function createTransactionWithFee(
  id: number,
  datetime: string,
  inflows: { amount: string; assetSymbol: string; price: string }[],
  outflows: { amount: string; assetSymbol: string; price: string }[],
  platformFee?: { amount: string; assetSymbol: string; price: string }
): Transaction {
  const fees: FeeMovement[] = platformFee
    ? [
        createFee(platformFee.assetSymbol, platformFee.amount, {
          priceAmount: platformFee.price,
        }),
      ]
    : [];

  return createTransaction(id, datetime, inflows, outflows, { fees });
}

/**
 * Creates an AcquisitionLot with common defaults
 */
export function createLot(
  id: string,
  assetSymbol: string,
  quantity: string,
  costBasisPerUnit: string,
  acquisitionDate: Date,
  options?: {
    acquisitionTransactionId?: number;
    calculationId?: string;
    method?: 'fifo' | 'lifo' | 'average-cost';
    remainingQuantity?: string;
    status?: 'open' | 'partially_disposed' | 'fully_disposed';
  }
): AcquisitionLot {
  const qty = parseDecimal(quantity);
  const costBasis = parseDecimal(costBasisPerUnit);
  const remaining = options?.remainingQuantity ? parseDecimal(options.remainingQuantity) : qty;

  return {
    id,
    calculationId: options?.calculationId ?? 'calc1',
    acquisitionTransactionId: options?.acquisitionTransactionId ?? 1,
    assetId: `test:${assetSymbol.toLowerCase()}`,
    assetSymbol: assetSymbol as Currency,
    quantity: qty,
    costBasisPerUnit: costBasis,
    totalCostBasis: qty.mul(costBasis),
    acquisitionDate,
    method: options?.method ?? 'fifo',
    remainingQuantity: remaining,
    status: options?.status ?? 'open',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Creates a LotDisposal with common defaults.
 * gainLoss is computed as (proceedsPerUnit - costBasisPerUnit) * quantityDisposed.
 */
export function createDisposal(
  id: string,
  lotId: string,
  _assetSymbol: string,
  disposalDate: Date,
  quantityDisposed: string,
  proceedsPerUnit: string,
  costBasisPerUnit: string,
  holdingPeriodDays: number
): LotDisposal {
  const qty = parseDecimal(quantityDisposed);
  const proceeds = parseDecimal(proceedsPerUnit);
  const costBasis = parseDecimal(costBasisPerUnit);
  return {
    id,
    lotId,
    disposalDate,
    quantityDisposed: qty,
    proceedsPerUnit: proceeds,
    costBasisPerUnit: costBasis,
    totalProceeds: proceeds.times(qty),
    grossProceeds: proceeds.times(qty),
    sellingExpenses: parseDecimal('0'),
    netProceeds: proceeds.times(qty),
    totalCostBasis: costBasis.times(qty),
    gainLoss: proceeds.minus(costBasis).times(qty),
    holdingPeriodDays,
    disposalTransactionId: 1,
    createdAt: new Date('2023-01-01T00:00:00Z'),
  };
}
