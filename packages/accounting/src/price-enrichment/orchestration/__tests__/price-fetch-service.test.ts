/* eslint-disable @typescript-eslint/unbound-method -- acceptable for tests */
import type { Transaction, TransactionDraft } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { ok } from '@exitbook/foundation';
import type { InstrumentationCollector } from '@exitbook/observability';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';
import { Decimal } from 'decimal.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { materializeTestTransaction } from '../../../__tests__/test-utils.js';
import { createAccountingExclusionPolicy } from '../../../accounting-layer/accounting-exclusion-policy.js';
import type { IPricingPersistence } from '../../../ports/pricing-persistence.js';
import { PriceFetchService } from '../price-fetch-service.js';

let nextId = 1;

function makeTx(
  overrides: Omit<Partial<Transaction>, 'fees' | 'movements'> & {
    fees?: TransactionDraft['fees'];
    movements: TransactionDraft['movements'];
  }
): Transaction {
  const id = nextId++;
  return materializeTestTransaction({
    id,
    accountId: 1,
    identityReference: `tx-${id}`,
    datetime: '2024-01-01T10:00:00.000Z',
    timestamp: new Date('2024-01-01T10:00:00.000Z').getTime(),
    platformKey: 'kraken',
    platformKind: 'exchange',
    status: 'success',
    operation: { category: 'trade', type: 'buy' },
    fees: [],
    ...overrides,
  });
}

function createMockStore(transactions: Transaction[]): {
  getUpdatedTx: (id: number) => Transaction | undefined;
  store: IPricingPersistence;
} {
  const txMap = new Map(transactions.map((tx) => [tx.id, tx]));
  const store: IPricingPersistence = {
    loadPricingContext: vi.fn().mockResolvedValue(ok({ transactions: [...txMap.values()], confirmedLinks: [] })),
    loadTransactionsNeedingPrices: vi.fn().mockResolvedValue(ok([...txMap.values()])),
    saveTransactionPrices: vi.fn().mockImplementation((tx: Transaction) => {
      txMap.set(tx.id, tx);
      return ok(undefined);
    }),
  };

  return {
    store,
    getUpdatedTx: (id) => txMap.get(id),
  };
}

function createMockPriceRuntime(): IPriceProviderRuntime {
  return {
    cleanup: vi.fn().mockResolvedValue(ok(undefined)),
    fetchPrice: vi.fn().mockResolvedValue(
      ok({
        currency: 'USD' as Currency,
        fetchedAt: new Date('2024-01-01T10:00:00.000Z'),
        granularity: 'exact' as const,
        price: new Decimal('1'),
        source: 'mock-provider',
        assetSymbol: 'BTC' as Currency,
        timestamp: new Date('2024-01-01T10:00:00.000Z'),
      })
    ),
    setManualFxRate: vi.fn().mockResolvedValue(ok(undefined)),
    setManualPrice: vi.fn().mockResolvedValue(ok(undefined)),
  } as unknown as IPriceProviderRuntime;
}

function createInstrumentation(): InstrumentationCollector {
  return {
    getSummary: vi.fn().mockReturnValue(undefined),
  } as unknown as InstrumentationCollector;
}

describe('PriceFetchService', () => {
  beforeEach(() => {
    nextId = 1;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not fetch or persist prices for fully excluded assets', async () => {
    const tx = makeTx({
      movements: {
        inflows: [
          {
            assetId: 'blockchain:ethereum:0xscam',
            assetSymbol: 'SCAM' as Currency,
            grossAmount: new Decimal('1000'),
          },
        ],
        outflows: [],
      },
    });

    const { store } = createMockStore([tx]);
    const priceRuntime = createMockPriceRuntime();
    const service = new PriceFetchService(
      store,
      createInstrumentation(),
      undefined,
      createAccountingExclusionPolicy(['blockchain:ethereum:0xscam'])
    );

    const result = await service.fetchPrices({}, priceRuntime);

    expect(result.isOk()).toBe(true);
    expect(priceRuntime.fetchPrice).not.toHaveBeenCalled();
    expect(store.saveTransactionPrices).not.toHaveBeenCalled();

    if (result.isOk()) {
      expect(result.value.stats.skipped).toBe(1);
      expect(result.value.stats.movementsUpdated).toBe(0);
    }
  });

  it('only applies fetched prices to non-excluded assetIds when symbols collide', async () => {
    const includedAssetId = 'blockchain:ethereum:0xaaaa';
    const excludedAssetId = 'blockchain:ethereum:0xbbbb';
    const tx = makeTx({
      movements: {
        inflows: [
          {
            assetId: includedAssetId,
            assetSymbol: 'USDC' as Currency,
            grossAmount: new Decimal('10'),
          },
          {
            assetId: excludedAssetId,
            assetSymbol: 'USDC' as Currency,
            grossAmount: new Decimal('5'),
          },
        ],
        outflows: [],
      },
    });

    const { store, getUpdatedTx } = createMockStore([tx]);
    const priceRuntime = createMockPriceRuntime();
    const service = new PriceFetchService(
      store,
      createInstrumentation(),
      undefined,
      createAccountingExclusionPolicy([excludedAssetId])
    );

    const result = await service.fetchPrices({}, priceRuntime);

    expect(result.isOk()).toBe(true);
    expect(priceRuntime.fetchPrice).toHaveBeenCalledTimes(1);

    const updatedTx = getUpdatedTx(tx.id);
    const includedMovement = updatedTx?.movements.inflows?.find((movement) => movement.assetId === includedAssetId);
    const excludedMovement = updatedTx?.movements.inflows?.find((movement) => movement.assetId === excludedAssetId);

    expect(includedMovement?.priceAtTxTime?.source).toBe('mock-provider');
    expect(excludedMovement?.priceAtTxTime).toBeUndefined();

    if (result.isOk()) {
      expect(result.value.stats.movementsUpdated).toBe(1);
      expect(result.value.stats.skipped).toBe(0);
    }
  });
});
