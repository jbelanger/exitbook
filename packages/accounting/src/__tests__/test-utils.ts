import type {
  AssetMovement,
  FeeMovement,
  OperationType,
  PriceAtTxTime,
  UniversalTransactionData,
} from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/core';

import type { AcquisitionLot, LotDisposal } from '../cost-basis/types.js';

/**
 * Creates a PriceAtTxTime object with common defaults
 */
export function createPriceAtTxTime(
  amount: string,
  currency = 'USD',
  options?: {
    fetchedAt?: Date;
    granularity?: 'exact' | 'minute' | 'hour' | 'day';
    source?: string;
  }
): PriceAtTxTime {
  return {
    price: {
      amount: parseDecimal(amount),
      currency: currency as Currency,
    },
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
 * Creates a UniversalTransactionData with common defaults.
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
): UniversalTransactionData {
  const fees: FeeMovement[] = options?.fees ?? [];

  return {
    id,
    accountId: 1,
    externalId: `ext-${id}`,
    datetime,
    timestamp: new Date(datetime).getTime(),
    source: options?.source ?? 'test',
    sourceType: options?.sourceType ?? 'exchange',
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
  };
}

/**
 * Creates a UniversalTransactionData from raw AssetMovement arrays.
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
): UniversalTransactionData {
  return {
    id,
    accountId: 1,
    externalId: `ext-${id}`,
    source: options?.source ?? 'test',
    sourceType: options?.sourceType ?? 'exchange',
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
  };
}

/**
 * Creates a UniversalTransactionData with fees
 */
export function createTransactionWithFee(
  id: number,
  datetime: string,
  inflows: { amount: string; assetSymbol: string; price: string }[],
  outflows: { amount: string; assetSymbol: string; price: string }[],
  platformFee?: { amount: string; assetSymbol: string; price: string }
): UniversalTransactionData {
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
  assetSymbol: string,
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
    totalCostBasis: costBasis.times(qty),
    gainLoss: proceeds.minus(costBasis).times(qty),
    holdingPeriodDays,
    disposalTransactionId: 1,
    createdAt: new Date('2023-01-01T00:00:00Z'),
  };
}
