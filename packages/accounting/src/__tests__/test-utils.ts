import { createHash } from 'node:crypto';

import type {
  AssetMovement,
  FeeMovement,
  OperationCategory,
  OperationType,
  PriceAtTxTime,
  Transaction,
} from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/core';

import type { AcquisitionLot, LotDisposal } from '../cost-basis/model/types.js';

function sha256Hex(material: string): string {
  return createHash('sha256').update(material).digest('hex');
}

export function seedTxFingerprint(
  source: string,
  sourceType: 'blockchain' | 'exchange',
  accountId: number,
  identityReference: string
): string {
  const accountFingerprint = sha256Hex(
    `${sourceType === 'blockchain' ? 'blockchain' : 'exchange-api'}|${source}|identifier-${accountId}`
  );

  const fingerprintMaterial =
    sourceType === 'blockchain'
      ? `${accountFingerprint}|blockchain|${source}|${identityReference.trim()}`
      : `${accountFingerprint}|exchange|${source}|${[identityReference.trim()].sort().join('|')}`;

  return sha256Hex(fingerprintMaterial);
}

type MaterializeTestTransactionInput = Omit<Transaction, 'txFingerprint'> & {
  fingerprintSeed?: string | undefined;
  txFingerprint?: string | undefined;
};

export function materializeTestTransaction(transaction: MaterializeTestTransactionInput): Transaction {
  const { fingerprintSeed, txFingerprint, ...transactionFields } = transaction;
  const providedFingerprintSeed = fingerprintSeed?.trim();
  const identityReference =
    providedFingerprintSeed || transactionFields.blockchain?.transaction_hash?.trim() || `tx-${transactionFields.id}`;
  const providedTxFingerprint = txFingerprint?.trim();
  const blockchain =
    transactionFields.sourceType === 'blockchain'
      ? (transactionFields.blockchain ?? {
          name: transactionFields.source,
          transaction_hash: identityReference,
          is_confirmed: true,
        })
      : transactionFields.blockchain;

  return {
    ...transactionFields,
    blockchain,
    txFingerprint:
      providedTxFingerprint ||
      seedTxFingerprint(
        transactionFields.source,
        transactionFields.sourceType,
        transactionFields.accountId,
        identityReference
      ),
  };
}

/** Shorthand movement description for buildTransaction. Omit `price` to create an unpriced movement. */
export interface TestMovementInput {
  assetSymbol: string;
  amount: string;
  assetId?: string | undefined;
  netAmount?: string | undefined;
  price?: string | undefined;
  priceCurrency?: string | undefined;
  priceSource?: string | undefined;
  granularity?: 'exact' | 'minute' | 'hour' | 'day' | undefined;
  quotedPrice?: { amount: string; currency: string } | undefined;
  fxRateToUSD?: string | undefined;
  fxSource?: string | undefined;
  fxTimestamp?: Date | undefined;
}

function buildTestMovement(m: TestMovementInput, datetime: string): AssetMovement {
  const movement: AssetMovement = {
    assetId: m.assetId ?? `test:${m.assetSymbol.toLowerCase()}`,
    assetSymbol: m.assetSymbol as Currency,
    grossAmount: parseDecimal(m.amount),
  };

  if (m.netAmount !== undefined) {
    movement.netAmount = parseDecimal(m.netAmount);
  }

  if (m.price !== undefined) {
    const priceAtTxTime: PriceAtTxTime = {
      price: { amount: parseDecimal(m.price), currency: (m.priceCurrency ?? 'USD') as Currency },
      source: m.priceSource ?? 'manual',
      fetchedAt: new Date(datetime),
      granularity: m.granularity ?? 'exact',
    };

    if (m.quotedPrice) {
      priceAtTxTime.quotedPrice = {
        amount: parseDecimal(m.quotedPrice.amount),
        currency: m.quotedPrice.currency as Currency,
      };
    }
    if (m.fxRateToUSD !== undefined) {
      priceAtTxTime.fxRateToUSD = parseDecimal(m.fxRateToUSD);
    }
    if (m.fxSource !== undefined) {
      priceAtTxTime.fxSource = m.fxSource;
    }
    if (m.fxTimestamp !== undefined) {
      priceAtTxTime.fxTimestamp = m.fxTimestamp;
    }

    movement.priceAtTxTime = priceAtTxTime;
  }

  return movement;
}

/**
 * Flexible transaction builder with concise movement shorthand.
 * Covers arbitrary sources, assetIds, price currencies, accountIds, and blockchain metadata.
 * Funnels through materializeTestTransaction for txFingerprint derivation.
 */
export function buildTransaction(params: {
  accountId?: number | undefined;
  blockchain?: Transaction['blockchain'] | undefined;
  category?: OperationCategory | undefined;
  datetime: string;
  fees?: FeeMovement[] | undefined;
  id: number;
  inflows?: TestMovementInput[] | undefined;
  outflows?: TestMovementInput[] | undefined;
  source?: string | undefined;
  sourceType?: 'exchange' | 'blockchain' | undefined;
  type?: OperationType | undefined;
}): Transaction {
  const source = params.source ?? 'test';
  const sourceType = params.sourceType ?? 'exchange';
  const fingerprintSeed = `tx-${params.id}`;

  const blockchain =
    params.blockchain !== undefined
      ? params.blockchain
      : sourceType === 'blockchain'
        ? { name: source, transaction_hash: fingerprintSeed, is_confirmed: true }
        : undefined;

  return materializeTestTransaction({
    id: params.id,
    accountId: params.accountId ?? 1,
    fingerprintSeed,
    datetime: params.datetime,
    timestamp: new Date(params.datetime).getTime(),
    source,
    sourceType,
    status: 'success',
    movements: {
      inflows: (params.inflows ?? []).map((m) => buildTestMovement(m, params.datetime)),
      outflows: (params.outflows ?? []).map((m) => buildTestMovement(m, params.datetime)),
    },
    fees: params.fees ?? [],
    operation: {
      category: params.category ?? 'trade',
      type: params.type ?? 'buy',
    },
    blockchain,
  });
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
  priceCurrency = 'USD',
  assetId?: string
): FeeMovement {
  return {
    assetId: assetId ?? `test:${assetSymbol.toLowerCase()}`,
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
    assetId?: string;
    currency?: string;
    priceAmount?: string;
    scope?: 'platform' | 'network';
    settlement?: 'balance' | 'on-chain';
  }
): FeeMovement {
  return {
    assetId: options?.assetId ?? `test:${assetSymbol.toLowerCase()}`,
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
  fees?: FeeMovement[] | undefined;
  id: number;
  inflows?: AssetMovement[] | undefined;
  outflows?: AssetMovement[] | undefined;
  txHash: string;
}): Transaction {
  return materializeTestTransaction({
    id: params.id,
    accountId: params.accountId,
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
  fingerprintSeed: string;
  id: number;
  inflows?: AssetMovement[] | undefined;
  source: string;
  type: 'buy' | 'deposit';
}): Transaction {
  return materializeTestTransaction({
    id: params.id,
    accountId: params.accountId,
    fingerprintSeed: params.fingerprintSeed,
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
  const fingerprintSeed = `ext-${id}`;
  const source = options?.source ?? 'test';
  const sourceType = options?.sourceType ?? 'exchange';
  const blockchain =
    sourceType === 'blockchain'
      ? {
          name: source,
          transaction_hash: fingerprintSeed,
          is_confirmed: true,
        }
      : undefined;
  return materializeTestTransaction({
    id,
    accountId,
    fingerprintSeed,
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
  const fingerprintSeed = `ext-${id}`;
  const source = options?.source ?? 'test';
  const sourceType = options?.sourceType ?? 'exchange';
  const blockchain =
    sourceType === 'blockchain'
      ? {
          name: source,
          transaction_hash: fingerprintSeed,
          is_confirmed: true,
        }
      : undefined;
  return materializeTestTransaction({
    id,
    accountId,
    fingerprintSeed,
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
