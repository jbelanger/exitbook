import type { Currency, UniversalTransactionData } from '@exitbook/core';
import { ok, parseDecimal } from '@exitbook/core';
import { describe, expect, it, vi } from 'vitest';

import type { ICostBasisPersistence } from '../../ports/cost-basis-persistence.js';
import { createCanadaFxProvider } from '../canada/__tests__/test-utils.js';

import { CostBasisWorkflow } from './cost-basis-workflow.js';

function createAcquisitionTransaction(params: {
  assetId: string;
  assetSymbol: Currency;
  id: number;
  quantity: string;
  timestamp: string;
  unitPriceCad: string;
}): UniversalTransactionData {
  return {
    id: params.id,
    accountId: 1,
    externalId: `tx-${params.id}`,
    datetime: params.timestamp,
    timestamp: Date.parse(params.timestamp),
    source: 'kraken',
    sourceType: 'exchange',
    status: 'success',
    movements: {
      inflows: [
        {
          assetId: params.assetId,
          assetSymbol: params.assetSymbol,
          grossAmount: parseDecimal(params.quantity),
          priceAtTxTime: {
            price: { amount: parseDecimal(params.unitPriceCad), currency: 'CAD' as Currency },
            source: 'exchange-execution',
            fetchedAt: new Date(params.timestamp),
            granularity: 'exact',
          },
        },
      ],
      outflows: [],
    },
    fees: [],
    operation: { category: 'trade', type: 'buy' },
  };
}

function createDispositionTransaction(params: {
  assetId: string;
  assetSymbol: Currency;
  id: number;
  quantity: string;
  timestamp: string;
  unitPriceCad: string;
}): UniversalTransactionData {
  return {
    id: params.id,
    accountId: 1,
    externalId: `tx-${params.id}`,
    datetime: params.timestamp,
    timestamp: Date.parse(params.timestamp),
    source: 'kraken',
    sourceType: 'exchange',
    status: 'success',
    movements: {
      inflows: [],
      outflows: [
        {
          assetId: params.assetId,
          assetSymbol: params.assetSymbol,
          grossAmount: parseDecimal(params.quantity),
          priceAtTxTime: {
            price: { amount: parseDecimal(params.unitPriceCad), currency: 'CAD' as Currency },
            source: 'exchange-execution',
            fetchedAt: new Date(params.timestamp),
            granularity: 'exact',
          },
        },
      ],
    },
    fees: [],
    operation: { category: 'trade', type: 'sell' },
  };
}

function createStore(): ICostBasisPersistence {
  return {
    loadCostBasisContext: vi.fn().mockResolvedValue(
      ok({
        transactions: [],
        confirmedLinks: [],
      })
    ),
  };
}

describe('CostBasisWorkflow', () => {
  it('routes Canada average-cost through the Canada workflow result boundary', async () => {
    const transactions = [
      createAcquisitionTransaction({
        id: 1,
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC' as Currency,
        timestamp: '2024-01-01T12:00:00Z',
        quantity: '1',
        unitPriceCad: '10000',
      }),
      createDispositionTransaction({
        id: 2,
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC' as Currency,
        timestamp: '2024-02-01T12:00:00Z',
        quantity: '1',
        unitPriceCad: '12000',
      }),
    ];

    const workflow = new CostBasisWorkflow(createStore(), createCanadaFxProvider({ fiatToUsd: { CAD: '0.75' } }));
    const result = await workflow.execute(
      {
        config: {
          method: 'average-cost',
          jurisdiction: 'CA',
          taxYear: 2024,
          currency: 'CAD',
          startDate: new Date('2024-01-01T00:00:00Z'),
          endDate: new Date('2024-12-31T23:59:59Z'),
        },
      },
      transactions
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.kind).toBe('canada-workflow');
    if (result.value.kind !== 'canada-workflow') {
      throw new Error('Expected Canada workflow result');
    }

    expect(result.value.taxReport.taxCurrency).toBe('CAD');
    expect(result.value.taxReport.dispositions).toHaveLength(1);
    expect(result.value.taxReport.summary.totalProceedsCad.toFixed()).toBe('12000');
    expect(result.value.taxReport.summary.totalCostBasisCad.toFixed()).toBe('10000');
    expect(result.value.taxReport.summary.totalGainLossCad.toFixed()).toBe('2000');
    expect(result.value.taxReport.summary.totalDeniedLossCad.toFixed()).toBe('0');
    expect(result.value.taxReport.summary.totalTaxableGainLossCad.toFixed()).toBe('1000');
    expect(result.value.displayReport).toBeUndefined();
  });

  it('builds a display report for non-CAD Canada output without entering the generic USD report path', async () => {
    const transactions = [
      createAcquisitionTransaction({
        id: 1,
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC' as Currency,
        timestamp: '2024-01-01T12:00:00Z',
        quantity: '1',
        unitPriceCad: '10000',
      }),
      createDispositionTransaction({
        id: 2,
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC' as Currency,
        timestamp: '2024-02-01T12:00:00Z',
        quantity: '1',
        unitPriceCad: '12000',
      }),
    ];

    const workflow = new CostBasisWorkflow(createStore(), createCanadaFxProvider({ fiatToUsd: { CAD: '0.75' } }));
    const result = await workflow.execute(
      {
        config: {
          method: 'average-cost',
          jurisdiction: 'CA',
          taxYear: 2024,
          currency: 'USD',
          startDate: new Date('2024-01-01T00:00:00Z'),
          endDate: new Date('2024-12-31T23:59:59Z'),
        },
      },
      transactions
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.kind).toBe('canada-workflow');
    if (result.value.kind !== 'canada-workflow') {
      throw new Error('Expected Canada workflow result');
    }

    expect(result.value.displayReport?.displayCurrency).toBe('USD');
    expect(result.value.displayReport?.summary.totalProceeds.toFixed()).toBe('9000');
    expect(result.value.displayReport?.summary.totalCostBasis.toFixed()).toBe('7500');
    expect(result.value.displayReport?.summary.totalGainLoss.toFixed()).toBe('1500');
    expect(result.value.displayReport?.summary.totalDeniedLoss.toFixed()).toBe('0');
    expect(result.value.displayReport?.summary.totalTaxableGainLoss.toFixed()).toBe('750');
  });

  it('uses post-period lookahead transactions for Canada superficial-loss evaluation without reporting them as in-period rows', async () => {
    const transactions = [
      createAcquisitionTransaction({
        id: 1,
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC' as Currency,
        timestamp: '2024-01-01T12:00:00Z',
        quantity: '1',
        unitPriceCad: '10000',
      }),
      createDispositionTransaction({
        id: 2,
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC' as Currency,
        timestamp: '2024-12-20T12:00:00Z',
        quantity: '1',
        unitPriceCad: '8000',
      }),
      createAcquisitionTransaction({
        id: 3,
        assetId: 'exchange:kraken:btc',
        assetSymbol: 'BTC' as Currency,
        timestamp: '2025-01-10T12:00:00Z',
        quantity: '1',
        unitPriceCad: '9000',
      }),
    ];

    const workflow = new CostBasisWorkflow(createStore(), createCanadaFxProvider({ fiatToUsd: { CAD: '0.75' } }));
    const result = await workflow.execute(
      {
        config: {
          method: 'average-cost',
          jurisdiction: 'CA',
          taxYear: 2024,
          currency: 'CAD',
          startDate: new Date('2024-01-01T00:00:00Z'),
          endDate: new Date('2024-12-31T23:59:59Z'),
        },
      },
      transactions
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.kind).toBe('canada-workflow');
    if (result.value.kind !== 'canada-workflow') {
      throw new Error('Expected Canada workflow result');
    }

    expect(result.value.taxReport.dispositions).toHaveLength(1);
    expect(result.value.taxReport.dispositions[0]?.disposedAt.toISOString()).toBe('2024-12-20T12:00:00.000Z');
    expect(result.value.taxReport.dispositions[0]?.gainLossCad.toFixed()).toBe('-2000');
    expect(result.value.taxReport.dispositions[0]?.deniedLossCad.toFixed()).toBe('2000');
    expect(result.value.taxReport.dispositions[0]?.taxableGainLossCad.toFixed()).toBe('0');
    expect(result.value.taxReport.summary.totalDeniedLossCad.toFixed()).toBe('2000');
    expect(
      result.value.taxReport.acquisitions.every(
        (acquisition) => acquisition.acquiredAt.getTime() <= new Date('2024-12-31T23:59:59Z').getTime()
      )
    ).toBe(true);
  });
});
