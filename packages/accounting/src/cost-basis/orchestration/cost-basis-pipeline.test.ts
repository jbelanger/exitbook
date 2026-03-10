import type { AssetMovement, Currency, TransactionLink } from '@exitbook/core';
import { computeMovementFingerprint, computeTxFingerprint, ok, parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it, vi } from 'vitest';

import {
  createBlockchainTx,
  createExchangeTx,
  createFeeMovement,
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

function buildMovementFingerprint(params: {
  accountId: number;
  externalId: string;
  movementType: 'inflow' | 'outflow';
  position: number;
  source: string;
}): string {
  const txFingerprint = assertOk(
    computeTxFingerprint({
      source: params.source,
      accountId: params.accountId,
      externalId: params.externalId,
    })
  );

  return assertOk(
    computeMovementFingerprint({
      txFingerprint,
      movementType: params.movementType,
      position: params.position,
    })
  );
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
    expect(resultValue.rebuildTransactions.map((tx) => tx.id)).toEqual([1]);
    expect(resultValue.summary.calculation.transactionsProcessed).toBe(1);
    expect(resultValue.summary.lotsCreated).toBe(1);
    expect(resultValue.summary.disposalsProcessed).toBe(0);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    expect(store.loadCostBasisContext).toHaveBeenCalledOnce();
  });

  it('keeps same-hash internal dependency transactions when rebuilding the soft price-complete subset', async () => {
    const store = stubStore();
    const hash = '45ec1d9a069424a0c969507f82300f9ef4102ebb0f1921d89b2d50390862c131';

    const acquisition = createExchangeTx({
      id: 10,
      accountId: 50,
      datetime: '2025-01-01T00:00:00.000Z',
      externalId: 'acq-10',
      source: 'kraken',
      type: 'buy',
      inflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('0.05'),
          netAmount: parseDecimal('0.05'),
          priceAtTxTime: createPriceAtTxTime('63074.01'),
        },
      ],
    });

    const networkFee = {
      ...createFeeMovement('network', 'on-chain', 'BTC', '0.00003821', '63074.01'),
      assetId: 'blockchain:bitcoin:native',
    };

    const sender = createBlockchainTx({
      id: 11,
      accountId: 3,
      datetime: '2025-05-08T10:14:40.000Z',
      externalId: hash,
      txHash: hash,
      outflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('0.01037'),
          netAmount: parseDecimal('0.01033179'),
          priceAtTxTime: createPriceAtTxTime('63074.01'),
        },
      ],
      fees: [networkFee],
    });

    const internalReceiver = createBlockchainTx({
      id: 12,
      accountId: 10,
      datetime: '2025-05-08T10:14:40.000Z',
      externalId: hash,
      txHash: hash,
      inflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('0.01012179'),
          netAmount: parseDecimal('0.01012179'),
          priceAtTxTime: createPriceAtTxTime('63074.01'),
        },
      ],
    });

    const exchangeDeposit = createExchangeTx({
      id: 13,
      accountId: 90,
      datetime: '2025-05-08T10:16:45.000Z',
      externalId: hash,
      source: 'kucoin',
      type: 'deposit',
      inflows: [
        {
          assetId: 'exchange:kucoin:btc',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('0.00021'),
          netAmount: parseDecimal('0.00021'),
          priceAtTxTime: createPriceAtTxTime('63074.01'),
        },
      ],
    });

    const missingPriceTx = createTransactionFromMovements(99, '2025-05-09T00:00:00.000Z', {
      inflows: [createMovement('ETH', '2')],
    });

    const confirmedLink: TransactionLink = {
      id: 3340,
      sourceTransactionId: sender.id,
      targetTransactionId: exchangeDeposit.id,
      assetSymbol: 'BTC' as Currency,
      sourceAssetId: 'blockchain:bitcoin:native',
      targetAssetId: 'exchange:kucoin:btc',
      sourceAmount: parseDecimal('0.00021'),
      targetAmount: parseDecimal('0.00021'),
      sourceMovementFingerprint: buildMovementFingerprint({
        source: sender.source,
        accountId: sender.accountId,
        externalId: sender.externalId,
        movementType: 'outflow',
        position: 0,
      }),
      targetMovementFingerprint: buildMovementFingerprint({
        source: exchangeDeposit.source,
        accountId: exchangeDeposit.accountId,
        externalId: exchangeDeposit.externalId,
        movementType: 'inflow',
        position: 0,
      }),
      linkType: 'blockchain_to_exchange',
      confidenceScore: parseDecimal('1'),
      matchCriteria: {
        assetMatch: true,
        amountSimilarity: parseDecimal('1'),
        timingValid: true,
        timingHours: 0.034722222222222224,
        hashMatch: true,
      },
      status: 'confirmed',
      createdAt: new Date('2026-03-10T21:52:39.280Z'),
      updatedAt: new Date('2026-03-10T21:52:39.280Z'),
      reviewedAt: new Date('2026-03-10T21:52:39.280Z'),
      reviewedBy: 'auto',
      metadata: {
        variance: '0',
        variancePct: '0.00',
        impliedFee: '0',
      },
    };

    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for tests
    vi.mocked(store.loadCostBasisContext).mockResolvedValue(ok({ transactions: [], confirmedLinks: [confirmedLink] }));

    const result = await runCostBasisPipeline(
      [acquisition, sender, internalReceiver, exchangeDeposit, missingPriceTx],
      defaultConfig,
      store,
      {
        missingPricePolicy: 'exclude',
      }
    );

    const resultValue = assertOk(result);
    expect(resultValue.missingPricesCount).toBe(1);
    expect(resultValue.rebuildTransactions.map((tx) => tx.id)).toEqual([10, 11, 12, 13]);
    expect(resultValue.summary.lotTransfers).toHaveLength(1);
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
    expect(resultValue.rebuildTransactions.map((tx) => tx.id)).toEqual([1]);
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
