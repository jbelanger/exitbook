import type { AcquisitionLot } from '@exitbook/accounting';
import type { Currency, UniversalTransactionData } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  aggregatePositionsByAssetSymbol,
  buildPortfolioPositions,
  buildAssetIdsBySymbol,
  buildTransactionItems,
  computeNetFiatInUsd,
  computeTotalRealizedGainLossAllTime,
  filterTransactionsForAssets,
  computeUnrealizedPnL,
  computeWeightedAvgCost,
  filterTransactionsForAsset,
  sortPositions,
} from '../portfolio-utils.js';

function createLot(params: {
  assetId?: string | undefined;
  assetSymbol?: string | undefined;
  costBasisPerUnit: string;
  id: string;
  quantity: string;
  remainingQuantity: string;
}): AcquisitionLot {
  return {
    id: params.id,
    calculationId: '11111111-1111-4111-8111-111111111111',
    acquisitionTransactionId: 1,
    assetId: params.assetId ?? 'blockchain:ethereum:native',
    assetSymbol: (params.assetSymbol as Currency) ?? ('ETH' as Currency),
    quantity: new Decimal(params.quantity),
    costBasisPerUnit: new Decimal(params.costBasisPerUnit),
    totalCostBasis: new Decimal(params.costBasisPerUnit).times(params.quantity),
    acquisitionDate: new Date('2024-01-01T00:00:00.000Z'),
    method: 'fifo',
    remainingQuantity: new Decimal(params.remainingQuantity),
    status: 'open',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  };
}

function createTransaction(params: {
  accountId: number;
  datetime: string;
  fees?: { amount: string; assetId: string; assetSymbol: string; price?: string | undefined }[];
  from?: string | undefined;
  id: number;
  inflows?: { amount: string; assetId: string; assetSymbol: string; price?: string | undefined }[];
  operationCategory: 'trade' | 'transfer';
  operationType: 'buy' | 'transfer' | 'deposit' | 'withdrawal';
  outflows?: { amount: string; assetId: string; assetSymbol: string; price?: string | undefined }[];
  source: string;
  to?: string | undefined;
}): UniversalTransactionData {
  const toPrice = (price: string | undefined) => {
    if (price === undefined) return;
    return {
      price: {
        amount: new Decimal(price),
        currency: 'USD',
      },
      source: 'test',
      fetchedAt: new Date('2025-01-01T00:00:00.000Z'),
    };
  };

  return {
    id: params.id,
    accountId: params.accountId,
    externalId: `ext-${params.id}`,
    datetime: params.datetime,
    timestamp: new Date(params.datetime).getTime(),
    source: params.source,
    sourceType: 'exchange-api',
    status: 'success',
    from: params.from,
    to: params.to,
    movements: {
      inflows: (params.inflows ?? []).map((inflow) => ({
        assetId: inflow.assetId,
        assetSymbol: inflow.assetSymbol,
        grossAmount: new Decimal(inflow.amount),
        netAmount: new Decimal(inflow.amount),
        priceAtTxTime: toPrice(inflow.price),
      })),
      outflows: (params.outflows ?? []).map((outflow) => ({
        assetId: outflow.assetId,
        assetSymbol: outflow.assetSymbol,
        grossAmount: new Decimal(outflow.amount),
        netAmount: new Decimal(outflow.amount),
        priceAtTxTime: toPrice(outflow.price),
      })),
    },
    fees: (params.fees ?? []).map((fee) => ({
      assetId: fee.assetId,
      assetSymbol: fee.assetSymbol,
      amount: new Decimal(fee.amount),
      scope: 'platform',
      settlement: 'balance',
      priceAtTxTime: toPrice(fee.price),
    })),
    operation: {
      category: params.operationCategory,
      type: params.operationType,
    },
    notes: [],
  } as unknown as UniversalTransactionData;
}

describe('portfolio-utils', () => {
  it('computes weighted average cost and unrealized pnl from open lots', () => {
    const lots = [
      createLot({
        id: '11111111-1111-4111-8111-111111111112',
        costBasisPerUnit: '100',
        quantity: '2',
        remainingQuantity: '2',
      }),
      createLot({
        id: '11111111-1111-4111-8111-111111111113',
        costBasisPerUnit: '200',
        quantity: '1',
        remainingQuantity: '1',
      }),
    ];

    const weighted = computeWeightedAvgCost(lots);
    const pnl = computeUnrealizedPnL(lots, new Decimal('250'));

    expect(weighted.toFixed(2)).toBe('133.33');
    expect(pnl.toFixed(2)).toBe('350.00');
  });

  it('computes all-time realized totals from disposal map including fx conversion', () => {
    const total = computeTotalRealizedGainLossAllTime(
      new Map([
        ['asset:btc', new Decimal('125.50')],
        ['asset:eth', new Decimal('-25.25')],
      ]),
      new Decimal('1.25'),
      false
    );

    expect(total).toBe('125.31');
  });

  it('returns undefined realized total only when there is no portfolio context', () => {
    expect(computeTotalRealizedGainLossAllTime(new Map(), undefined, false)).toBeUndefined();
    expect(computeTotalRealizedGainLossAllTime(new Map(), undefined, true)).toBe('0.00');
  });

  it('sorts positions by priced > unpriced > negative tiers', () => {
    const sorted = sortPositions(
      [
        {
          assetId: 'negative',
          assetSymbol: 'NEG',
          quantity: '-1.00000000',
          isNegative: true,
          priceStatus: 'ok',
          currentValue: '100.00',
          openLots: [],
          accountBreakdown: [],
        },
        {
          assetId: 'unpriced',
          assetSymbol: 'UNP',
          quantity: '5.00000000',
          isNegative: false,
          priceStatus: 'unavailable',
          openLots: [],
          accountBreakdown: [],
        },
        {
          assetId: 'priced',
          assetSymbol: 'AAA',
          quantity: '1.00000000',
          isNegative: false,
          priceStatus: 'ok',
          currentValue: '120.00',
          openLots: [],
          accountBreakdown: [],
        },
      ],
      'value'
    );

    expect(sorted.map((item) => item.assetId)).toEqual(['priced', 'unpriced', 'negative']);
  });

  it('aggregates duplicate symbols across assetIds into one display position', () => {
    const aggregated = aggregatePositionsByAssetSymbol([
      {
        assetId: 'exchange:coinbase:lyx',
        assetSymbol: 'LYX',
        quantity: '0.00007253',
        isNegative: false,
        spotPricePerUnit: '0.33',
        currentValue: '0.00',
        allocationPct: '0.0',
        priceStatus: 'ok',
        totalCostBasis: '0.28',
        avgCostPerUnit: '3.74',
        unrealizedGainLoss: '-0.26',
        unrealizedPct: '-91.1',
        openLots: [],
        accountBreakdown: [
          { accountId: 1, sourceName: 'coinbase', accountType: 'exchange-api', quantity: '0.00007253' },
        ],
      },
      {
        assetId: 'blockchain:lukso:native',
        assetSymbol: 'LYX',
        quantity: '0.00001396',
        isNegative: false,
        spotPricePerUnit: '0.33',
        currentValue: '0.00',
        allocationPct: '0.0',
        priceStatus: 'ok',
        totalCostBasis: '0.00',
        avgCostPerUnit: '3.74',
        unrealizedGainLoss: '0.00',
        unrealizedPct: '0.0',
        openLots: [],
        accountBreakdown: [{ accountId: 2, sourceName: 'lukso', accountType: 'blockchain', quantity: '0.00001396' }],
      },
    ]);

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]?.assetSymbol).toBe('LYX');
    expect(aggregated[0]?.quantity).toBe('0.00008649');
    expect(aggregated[0]?.sourceAssetIds).toEqual(['exchange:coinbase:lyx', 'blockchain:lukso:native']);
    expect(aggregated[0]?.accountBreakdown).toHaveLength(2);
  });

  it('computes aggregated avg cost from cost-backed quantity, not net quantity', () => {
    const aggregated = aggregatePositionsByAssetSymbol([
      {
        assetId: 'asset:akt:cost',
        assetSymbol: 'AKT',
        quantity: '10.00000000',
        isNegative: false,
        spotPricePerUnit: '0.33',
        currentValue: '3.30',
        allocationPct: '100.0',
        priceStatus: 'ok',
        totalCostBasis: '20.00',
        avgCostPerUnit: '2.00',
        unrealizedGainLoss: '-16.70',
        unrealizedPct: '-83.5',
        realizedGainLossAllTime: '-100.00',
        openLots: [],
        accountBreakdown: [],
      },
      {
        assetId: 'asset:akt:offset',
        assetSymbol: 'AKT',
        quantity: '-9.99999000',
        isNegative: true,
        spotPricePerUnit: '0.33',
        currentValue: '-3.30',
        allocationPct: undefined,
        priceStatus: 'ok',
        priceError: undefined,
        totalCostBasis: undefined,
        avgCostPerUnit: undefined,
        unrealizedGainLoss: undefined,
        unrealizedPct: undefined,
        realizedGainLossAllTime: '0.00',
        openLots: [],
        accountBreakdown: [],
      },
    ]);

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]?.quantity).toBe('0.00001000');
    expect(aggregated[0]?.avgCostPerUnit).toBe('2.00');
  });

  it('preserves avg cost when a tiny-balance row carries large open-lot cost basis', () => {
    const aggregated = aggregatePositionsByAssetSymbol([
      {
        assetId: 'exchange:kraken:akt',
        assetSymbol: 'AKT',
        quantity: '0.00000711',
        isNegative: false,
        spotPricePerUnit: '0.33',
        currentValue: '0.00',
        allocationPct: '0.0',
        priceStatus: 'ok',
        totalCostBasis: '8.99',
        avgCostPerUnit: '2.75',
        unrealizedGainLoss: '-7.93',
        unrealizedPct: '-88.2',
        realizedGainLossAllTime: '-2137.07',
        openLots: [],
        accountBreakdown: [],
      },
      {
        assetId: 'blockchain:akash:native',
        assetSymbol: 'AKT',
        quantity: '0.00000000',
        isNegative: false,
        spotPricePerUnit: '0.33',
        currentValue: '0.00',
        allocationPct: undefined,
        priceStatus: 'ok',
        priceError: undefined,
        totalCostBasis: undefined,
        avgCostPerUnit: undefined,
        unrealizedGainLoss: undefined,
        unrealizedPct: undefined,
        realizedGainLossAllTime: '0.00',
        openLots: [],
        accountBreakdown: [],
      },
    ]);

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]?.quantity).toBe('0.00000711');
    expect(aggregated[0]?.avgCostPerUnit).toBe('2.75');
  });

  it('builds positions and emits warning for unpriced assets', () => {
    const built = buildPortfolioPositions(
      {
        'asset:btc': new Decimal('1.5'),
        'asset:obscure': new Decimal('2'),
      },
      {
        'asset:btc': 'BTC',
        'asset:obscure': 'OBSC',
      },
      new Map([
        ['asset:btc', { price: new Decimal('100') }],
        ['asset:obscure', { error: 'missing id' }],
      ]),
      new Map([
        [
          'asset:btc',
          [
            createLot({
              id: '11111111-1111-4111-8111-111111111114',
              assetId: 'asset:btc',
              assetSymbol: 'BTC',
              costBasisPerUnit: '80',
              quantity: '1.5',
              remainingQuantity: '1.5',
            }),
          ],
        ],
      ]),
      new Map([
        ['asset:btc', [{ accountId: 1, sourceName: 'kraken', accountType: 'exchange-api', quantity: '1.50000000' }]],
      ]),
      undefined,
      new Date('2026-01-01T00:00:00.000Z')
    );

    const btc = built.positions.find((position) => position.assetId === 'asset:btc');
    const obscure = built.positions.find((position) => position.assetId === 'asset:obscure');

    expect(btc?.currentValue).toBe('150.00');
    expect(btc?.allocationPct).toBe('100.0');
    expect(btc?.unrealizedGainLoss).toBe('30.00');
    expect(obscure?.priceStatus).toBe('unavailable');
    expect(built.warnings).toEqual(['1 asset could not be priced — values may be incomplete']);
  });

  it('filters asset transactions and builds history rows', () => {
    const tx1 = createTransaction({
      id: 1,
      accountId: 7,
      datetime: '2025-02-01T00:00:00.000Z',
      source: 'kraken',
      operationCategory: 'trade',
      operationType: 'buy',
      inflows: [{ assetId: 'asset:sol', assetSymbol: 'SOL', amount: '10', price: '100' }],
      outflows: [{ assetId: 'asset:usd', assetSymbol: 'USD', amount: '1000', price: '1' }],
      fees: [{ assetId: 'asset:usd', assetSymbol: 'USD', amount: '1', price: '1' }],
    });

    const tx2 = createTransaction({
      id: 2,
      accountId: 7,
      datetime: '2025-03-01T00:00:00.000Z',
      source: 'kraken',
      operationCategory: 'transfer',
      operationType: 'transfer',
      outflows: [{ assetId: 'asset:sol', assetSymbol: 'SOL', amount: '3' }],
      to: 'solana blockchain',
      from: 'kraken',
    });

    const filtered = filterTransactionsForAsset([tx1, tx2], 'asset:sol');
    const items = buildTransactionItems(filtered, 'asset:sol');

    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe(2);
    expect(items[0]?.transferDirection).toBe('to');
    expect(items[0]?.transferPeer).toBe('solana blockchain');
    expect(items[1]?.assetDirection).toBe('in');
    expect(items[1]?.fiatValue).toBe('1000.00');
  });

  it('filters and builds history rows across multiple underlying assetIds', () => {
    const tx1 = createTransaction({
      id: 10,
      accountId: 1,
      datetime: '2025-01-01T00:00:00.000Z',
      source: 'coinbase',
      operationCategory: 'trade',
      operationType: 'buy',
      inflows: [{ assetId: 'exchange:coinbase:fet', assetSymbol: 'FET', amount: '1', price: '2' }],
    });
    const tx2 = createTransaction({
      id: 11,
      accountId: 2,
      datetime: '2025-01-02T00:00:00.000Z',
      source: 'ethereum',
      operationCategory: 'trade',
      operationType: 'buy',
      inflows: [{ assetId: 'blockchain:ethereum:0x...', assetSymbol: 'FET', amount: '2', price: '2' }],
    });

    const filtered = filterTransactionsForAssets([tx1, tx2], ['exchange:coinbase:fet', 'blockchain:ethereum:0x...']);
    const items = buildTransactionItems(filtered, ['exchange:coinbase:fet', 'blockchain:ethereum:0x...']);

    expect(items).toHaveLength(2);
    expect(items[0]?.assetAmount).toBe('2.00000000');
    expect(items[1]?.assetAmount).toBe('1.00000000');
  });

  it('builds symbol-to-assetId map including historical ids', () => {
    const tx1 = createTransaction({
      id: 21,
      accountId: 1,
      datetime: '2025-01-01T00:00:00.000Z',
      source: 'kraken',
      operationCategory: 'trade',
      operationType: 'buy',
      inflows: [{ assetId: 'exchange:kraken:btc', assetSymbol: 'BTC', amount: '0.1' }],
    });
    const tx2 = createTransaction({
      id: 22,
      accountId: 2,
      datetime: '2025-01-02T00:00:00.000Z',
      source: 'kucoin',
      operationCategory: 'trade',
      operationType: 'buy',
      inflows: [{ assetId: 'exchange:kucoin:btc', assetSymbol: ' btc ', amount: '0.2' }],
      fees: [{ assetId: 'exchange:kucoin:btc', assetSymbol: 'BTC', amount: '0.001' }],
    });
    const tx3 = createTransaction({
      id: 23,
      accountId: 3,
      datetime: '2025-01-03T00:00:00.000Z',
      source: 'bitcoin',
      operationCategory: 'transfer',
      operationType: 'transfer',
      outflows: [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.05' }],
    });

    const map = buildAssetIdsBySymbol([tx1, tx2, tx3]);
    expect(map.get('BTC')).toEqual(['exchange:kraken:btc', 'exchange:kucoin:btc', 'blockchain:bitcoin:native']);
  });

  it('computes net fiat in from transfer transactions in USD', () => {
    const deposit = createTransaction({
      id: 30,
      accountId: 1,
      datetime: '2025-01-01T00:00:00.000Z',
      source: 'kraken',
      operationCategory: 'transfer',
      operationType: 'deposit',
      inflows: [{ assetId: 'exchange:kraken:usd', assetSymbol: 'USD', amount: '1000', price: '1' }],
    });
    const withdrawal = createTransaction({
      id: 31,
      accountId: 1,
      datetime: '2025-01-02T00:00:00.000Z',
      source: 'kraken',
      operationCategory: 'transfer',
      operationType: 'withdrawal',
      outflows: [{ assetId: 'exchange:kraken:usd', assetSymbol: 'USD', amount: '200', price: '1' }],
      fees: [{ assetId: 'exchange:kraken:usd', assetSymbol: 'USD', amount: '5', price: '1' }],
    });
    const trade = createTransaction({
      id: 32,
      accountId: 1,
      datetime: '2025-01-03T00:00:00.000Z',
      source: 'kraken',
      operationCategory: 'trade',
      operationType: 'buy',
      outflows: [{ assetId: 'fiat:usd', assetSymbol: 'USD', amount: '500', price: '1' }],
      inflows: [{ assetId: 'asset:btc', assetSymbol: 'BTC', amount: '0.01', price: '50000' }],
    });
    const cryptoTransfer = createTransaction({
      id: 33,
      accountId: 1,
      datetime: '2025-01-04T00:00:00.000Z',
      source: 'bitcoin',
      operationCategory: 'transfer',
      operationType: 'transfer',
      inflows: [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.005' }],
    });

    const result = computeNetFiatInUsd([deposit, withdrawal, trade, cryptoTransfer]);
    expect(result.netFiatInUsd.toFixed(2)).toBe('795.00');
    expect(result.skippedNonUsdMovementsWithoutPrice).toBe(0);
  });

  it('computes net fiat in from non-usd fiat when usd price metadata exists', () => {
    const cadDeposit = createTransaction({
      id: 41,
      accountId: 1,
      datetime: '2025-01-05T00:00:00.000Z',
      source: 'kraken',
      operationCategory: 'transfer',
      operationType: 'deposit',
      inflows: [{ assetId: 'exchange:kraken:cad', assetSymbol: 'CAD', amount: '100', price: '0.75' }],
    });

    const result = computeNetFiatInUsd([cadDeposit]);
    expect(result.netFiatInUsd.toFixed(2)).toBe('75.00');
    expect(result.skippedNonUsdMovementsWithoutPrice).toBe(0);
  });

  it('skips non-usd fiat flows without price metadata for net fiat in', () => {
    const eurDepositNoPrice = createTransaction({
      id: 40,
      accountId: 1,
      datetime: '2025-01-01T00:00:00.000Z',
      source: 'kraken',
      operationCategory: 'transfer',
      operationType: 'deposit',
      inflows: [{ assetId: 'fiat:eur', assetSymbol: 'EUR', amount: '1000' }],
    });

    const result = computeNetFiatInUsd([eurDepositNoPrice]);
    expect(result.netFiatInUsd.toFixed(2)).toBe('0.00');
    expect(result.skippedNonUsdMovementsWithoutPrice).toBe(1);
  });
});
