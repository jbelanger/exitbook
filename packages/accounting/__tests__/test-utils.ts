import type { AssetMovement, FeeMovement, OperationType, PriceAtTxTime, UniversalTransaction } from '@exitbook/core';
import { Currency, parseDecimal } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { ok } from 'neverthrow';
import { vi } from 'vitest';

import type { AcquisitionLot } from '../src/domain/types.js';
import type { CostBasisRepository } from '../src/persistence/cost-basis-repository.js';
import type { LotTransferRepository } from '../src/persistence/lot-transfer-repository.js';

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
export function createMovement(asset: string, amount: string, priceAmount: string, currency = 'USD'): AssetMovement {
  return {
    asset,
    grossAmount: parseDecimal(amount),
    priceAtTxTime: createPriceAtTxTime(priceAmount, currency),
  };
}

/**
 * Creates a FeeMovement object with common defaults
 */
export function createFee(
  asset: string,
  amount: string,
  options?: {
    currency?: string;
    priceAmount?: string;
    scope?: 'platform' | 'network';
    settlement?: 'balance' | 'on-chain';
  }
): FeeMovement {
  return {
    asset,
    amount: parseDecimal(amount),
    scope: options?.scope ?? 'platform',
    settlement: options?.settlement ?? 'balance',
    priceAtTxTime: options?.priceAmount
      ? createPriceAtTxTime(options.priceAmount, options?.currency ?? 'USD')
      : undefined,
  };
}

/**
 * Creates a UniversalTransaction with common defaults
 */
export function createTransaction(
  id: number,
  datetime: string,
  inflows: { amount: string; asset: string; price: string }[],
  outflows: { amount: string; asset: string; price: string }[] = [],
  options?: {
    category?: 'trade' | 'transfer';
    fees?: FeeMovement[];
    source?: string;
    type?: OperationType;
  }
): UniversalTransaction {
  const fees: FeeMovement[] = options?.fees ?? [];

  return {
    id,
    externalId: `ext-${id}`,
    datetime,
    timestamp: new Date(datetime).getTime(),
    source: options?.source ?? 'test',
    status: 'success',
    movements: {
      inflows: inflows.map((i) => createMovement(i.asset, i.amount, i.price)),
      outflows: outflows.map((o) => createMovement(o.asset, o.amount, o.price)),
    },
    operation: {
      category: options?.category ?? 'trade',
      type: options?.type ?? (inflows.length > 0 ? 'buy' : 'sell'),
    },
    fees,
    metadata: {},
  };
}

/**
 * Creates a UniversalTransaction with fees
 */
export function createTransactionWithFee(
  id: number,
  datetime: string,
  inflows: { amount: string; asset: string; price: string }[],
  outflows: { amount: string; asset: string; price: string }[],
  platformFee?: { amount: string; asset: string; price: string }
): UniversalTransaction {
  const fees: FeeMovement[] = platformFee
    ? [
        createFee(platformFee.asset, platformFee.amount, {
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
  asset: string,
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
  const qty = new Decimal(quantity);
  const costBasis = new Decimal(costBasisPerUnit);
  const remaining = options?.remainingQuantity ? new Decimal(options.remainingQuantity) : qty;

  return {
    id,
    calculationId: options?.calculationId ?? 'calc1',
    acquisitionTransactionId: options?.acquisitionTransactionId ?? 1,
    asset,
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
 * Creates a mock CostBasisRepository with common defaults
 */
export function createMockCostBasisRepository(): CostBasisRepository {
  return {
    createCalculation: vi.fn().mockResolvedValue(ok('calc-id')),
    createLotsBulk: vi.fn().mockResolvedValue(ok(1)),
    createDisposalsBulk: vi.fn().mockResolvedValue(ok(1)),
    updateCalculation: vi.fn().mockResolvedValue(ok(true)),
  } as unknown as CostBasisRepository;
}

/**
 * Creates a mock LotTransferRepository with common defaults
 */
export function createMockLotTransferRepository(): LotTransferRepository {
  return {
    createBulk: vi.fn().mockResolvedValue(ok(0)),
  } as unknown as LotTransferRepository;
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
