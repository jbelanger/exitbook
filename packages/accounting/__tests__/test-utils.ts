import type {
  AssetMovement,
  FeeMovement,
  OperationType,
  PriceAtTxTime,
  UniversalTransactionData,
} from '@exitbook/core';
import { Currency, parseDecimal } from '@exitbook/core';

import type { AcquisitionLot } from '../src/domain/types.js';

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
      currency: Currency.create(currency),
    },
    source: options?.source ?? 'manual',
    fetchedAt: options?.fetchedAt ?? new Date('2024-01-01'),
    granularity: options?.granularity ?? 'exact',
  };
}

/**
 * Creates an AssetMovement object with price
 */
export function createMovement(
  assetSymbol: string,
  amount: string,
  priceAmount: string,
  currency = 'USD'
): AssetMovement {
  return {
    assetId: `test:${assetSymbol.toLowerCase()}`,
    assetSymbol,
    grossAmount: parseDecimal(amount),
    priceAtTxTime: createPriceAtTxTime(priceAmount, currency),
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
    assetSymbol: assetSymbol,
    amount: parseDecimal(amount),
    scope: options?.scope ?? 'platform',
    settlement: options?.settlement ?? 'balance',
    priceAtTxTime: options?.priceAmount
      ? createPriceAtTxTime(options.priceAmount, options?.currency ?? 'USD')
      : undefined,
  };
}

/**
 * Creates a UniversalTransactionData with common defaults
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
    sourceType: 'blockchain' as const,
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
    assetSymbol: assetSymbol,
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
 * Assertion helper to unwrap Result and assert it's ok
 */
export function assertOk<T, E>(result: { error: E; isOk(): boolean; value: T }): T {
  if (!result.isOk()) {
    throw new Error(`Expected Result to be Ok, but got Error: ${String(result.error)}`);
  }
  return result.value;
}

/**
 * Assertion helper to unwrap Result and assert it's error
 */
export function assertErr<T, E>(result: { error: E; isErr(): boolean; value: T }): E {
  if (!result.isErr()) {
    throw new Error(`Expected Result to be Err, but got Ok: ${String(result.value)}`);
  }
  return result.error;
}
