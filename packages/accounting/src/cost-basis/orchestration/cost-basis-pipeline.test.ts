import type { AssetMovement, Currency } from '@exitbook/core';
import { ok, parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it, vi } from 'vitest';

import {
  createMovement,
  createPriceAtTxTime,
  createTransaction,
  createTransactionFromMovements,
} from '../../__tests__/test-utils.js';
import type { ICostBasisPersistence } from '../../ports/cost-basis-persistence.js';
import { createAccountingExclusionPolicy } from '../shared/accounting-exclusion-policy.js';
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

function createBlockchainTokenMovement(assetId: string, assetSymbol: string, amount: string): AssetMovement {
  return {
    assetId,
    assetSymbol: assetSymbol as Currency,
    grossAmount: parseDecimal(amount),
    priceAtTxTime: createPriceAtTxTime('1'),
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

  it('prunes excluded assets before price validation in mixed transactions', async () => {
    const store = stubStore();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    vi.mocked(store.loadCostBasisContext).mockResolvedValue(ok({ transactions: [], confirmedLinks: [] }));

    const mixed = createTransactionFromMovements(1, '2025-01-10T00:00:00.000Z', {
      inflows: [createMovement('ETH', '1', '3000'), createMovement('SCAM', '1000')],
    });

    const result = await runCostBasisPipeline([mixed], defaultConfig, store, {
      accountingExclusionPolicy: createAccountingExclusionPolicy(['test:scam']),
      missingPricePolicy: 'error',
    });

    const resultValue = assertOk(result);
    expect(resultValue.missingPricesCount).toBe(0);
    expect(resultValue.priceCompleteTransactions.map((tx) => tx.id)).toEqual([1]);
    expect(resultValue.summary.calculation.transactionsProcessed).toBe(1);
  });

  it('fails closed when same-chain blockchain tokens share a symbol across multiple asset IDs', async () => {
    const store = stubStore();
    const first = createTransactionFromMovements(
      1,
      '2025-01-10T00:00:00.000Z',
      {
        inflows: [createBlockchainTokenMovement('blockchain:arbitrum:0xaaa', 'USDC', '10')],
      },
      [],
      { source: 'arbitrum', sourceType: 'blockchain', category: 'transfer', type: 'deposit' }
    );
    const second = createTransactionFromMovements(
      2,
      '2025-01-11T00:00:00.000Z',
      {
        inflows: [createBlockchainTokenMovement('blockchain:arbitrum:0xbbb', 'USDC', '5')],
      },
      [],
      { source: 'arbitrum', sourceType: 'blockchain', category: 'transfer', type: 'deposit' }
    );

    const result = await runCostBasisPipeline([first, second], defaultConfig, store, {
      missingPricePolicy: 'error',
    });

    expect(assertErr(result).message).toContain('Ambiguous on-chain asset symbols require review');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    expect(store.loadCostBasisContext).not.toHaveBeenCalled();
  });
});
