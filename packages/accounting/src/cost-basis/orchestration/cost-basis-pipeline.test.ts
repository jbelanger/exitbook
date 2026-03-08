import { ok } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { createMovement, createTransaction, createTransactionFromMovements } from '../../__tests__/test-utils.js';
import type { ICostBasisPersistence } from '../../ports/cost-basis-persistence.js';
import type { CostBasisConfig } from '../shared/cost-basis-config.js';

import { runCostBasisPipeline } from './cost-basis-pipeline.js';

const defaultConfig: CostBasisConfig = {
  method: 'fifo',
  jurisdiction: 'US',
  taxYear: 2025,
  currency: 'USD',
  startDate: new Date('2025-01-01T00:00:00.000Z'),
  endDate: new Date('2025-12-31T23:59:59.999Z'),
};

function stubStore(): ICostBasisPersistence {
  return {
    loadCostBasisContext: vi.fn(),
  };
}

describe('runCostBasisPipeline', () => {
  it('fails when any transaction is missing required prices', async () => {
    const store = stubStore();
    const priced = createTransaction(1, '2025-01-10T00:00:00.000Z', [
      { assetSymbol: 'BTC', amount: '1', price: '50000' },
    ]);
    const missing = createTransactionFromMovements(2, '2025-01-11T00:00:00.000Z', {
      inflows: [createMovement('ETH', '2')],
    });

    const result = await runCostBasisPipeline([priced, missing], defaultConfig, store, {
      missingPricePolicy: 'error',
    });

    expect(assertErr(result).message).toContain('1 transactions are missing required price data');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    expect(store.loadCostBasisContext).not.toHaveBeenCalled();
  });

  it('excludes transactions missing prices in soft mode and continues with the price-complete subset', async () => {
    const store = stubStore();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    vi.mocked(store.loadCostBasisContext).mockResolvedValue(ok({ transactions: [], confirmedLinks: [] }));

    const priced = createTransaction(1, '2025-01-10T00:00:00.000Z', [
      { assetSymbol: 'BTC', amount: '1', price: '50000' },
    ]);
    const missing = createTransactionFromMovements(2, '2025-01-11T00:00:00.000Z', {
      inflows: [createMovement('ETH', '2')],
    });

    const result = await runCostBasisPipeline([priced, missing], defaultConfig, store, {
      missingPricePolicy: 'exclude',
    });

    const resultValue = assertOk(result);
    expect(resultValue.missingPricesCount).toBe(1);
    expect(resultValue.priceCompleteTransactions.map((tx) => tx.id)).toEqual([1]);
    expect(resultValue.summary.calculation.transactionsProcessed).toBe(1);
    expect(resultValue.summary.lotsCreated).toBe(1);
    expect(resultValue.summary.disposalsProcessed).toBe(0);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    expect(store.loadCostBasisContext).toHaveBeenCalledOnce();
  });
});
