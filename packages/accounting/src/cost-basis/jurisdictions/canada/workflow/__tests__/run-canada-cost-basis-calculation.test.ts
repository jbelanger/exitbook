import type { Currency, Transaction } from '@exitbook/core';
import { ok, parseDecimal } from '@exitbook/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildCanadaDisplayCostBasisReport,
  mockBuildCanadaTaxReport,
  mockRunCanadaAcbEngine,
  mockRunCanadaAcbWorkflow,
  mockRunCanadaSuperficialLossEngine,
} = vi.hoisted(() => ({
  mockBuildCanadaDisplayCostBasisReport: vi.fn(),
  mockBuildCanadaTaxReport: vi.fn(),
  mockRunCanadaAcbEngine: vi.fn(),
  mockRunCanadaAcbWorkflow: vi.fn(),
  mockRunCanadaSuperficialLossEngine: vi.fn(),
}));

vi.mock('../canada-acb-engine.js', () => ({
  runCanadaAcbEngine: mockRunCanadaAcbEngine,
}));

vi.mock('../canada-acb-workflow.js', () => ({
  runCanadaAcbWorkflow: mockRunCanadaAcbWorkflow,
}));

vi.mock('../canada-superficial-loss-engine.js', () => ({
  runCanadaSuperficialLossEngine: mockRunCanadaSuperficialLossEngine,
}));

vi.mock('../../tax/canada-tax-report-builder.js', () => ({
  buildCanadaDisplayCostBasisReport: mockBuildCanadaDisplayCostBasisReport,
  buildCanadaTaxReport: mockBuildCanadaTaxReport,
}));

import {
  createCanadaAcquisitionEvent,
  createCanadaFeeAdjustmentEvent,
  createCanadaFxProvider,
  createCanadaInputContext,
  materializeTestTransaction,
} from '../../__tests__/test-utils.js';
import { runCanadaCostBasisCalculation } from '../run-canada-cost-basis-calculation.js';

function createAcquisitionTransaction(params: {
  assetId: string;
  assetSymbol: Currency;
  id: number;
  quantity: string;
  timestamp: string;
  unitPriceCad: string;
}): Transaction {
  return materializeTestTransaction({
    id: params.id,
    accountId: 1,
    identityReference: `tx-${params.id}`,
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
            price: {
              amount: parseDecimal(params.unitPriceCad),
              currency: 'CAD' as Currency,
            },
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
  });
}

function createUnpricedAcquisitionTransaction(params: {
  assetId: string;
  assetSymbol: Currency;
  id: number;
  quantity: string;
  timestamp: string;
}): Transaction {
  return materializeTestTransaction({
    id: params.id,
    accountId: 1,
    identityReference: `tx-${params.id}`,
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
        },
      ],
      outflows: [],
    },
    fees: [],
    operation: { category: 'trade', type: 'buy' },
  });
}

function createBaseInput(endDate = '2025-01-10T23:59:59.999Z') {
  return {
    config: {
      method: 'average-cost' as const,
      jurisdiction: 'CA' as const,
      taxYear: 2025,
      currency: 'CAD' as const,
      startDate: new Date('2025-01-01T00:00:00.000Z'),
      endDate: new Date(endDate),
    },
  };
}

function createEngineResult() {
  return {
    eventPoolSnapshots: [],
    pools: [],
    dispositions: [],
    totalProceedsCad: parseDecimal('0'),
    totalCostBasisCad: parseDecimal('0'),
    totalGainLossCad: parseDecimal('0'),
  };
}

function configureCanadaRunnerMocks(inputContext = createCanadaInputContext({ inputEvents: [] })) {
  mockRunCanadaAcbWorkflow.mockResolvedValue(
    ok({
      inputContext,
      acbEngineResult: createEngineResult(),
    } as never)
  );
  mockRunCanadaSuperficialLossEngine.mockReturnValue(
    ok({
      adjustmentEvents: [],
      adjustments: [],
    } as never)
  );
  mockRunCanadaAcbEngine.mockReturnValue(ok(createEngineResult()));
  mockBuildCanadaTaxReport.mockReturnValue(
    ok({
      calculationId: 'calc-1',
      taxCurrency: 'CAD',
      acquisitions: [],
      dispositions: [],
      transfers: [],
      superficialLossAdjustments: [],
      displayContext: { transferMarketValueCadByTransferId: new Map() },
      summary: {
        totalProceedsCad: parseDecimal('0'),
        totalCostBasisCad: parseDecimal('0'),
        totalGainLossCad: parseDecimal('0'),
        totalTaxableGainLossCad: parseDecimal('0'),
        totalDeniedLossCad: parseDecimal('0'),
      },
    } as never)
  );
  mockBuildCanadaDisplayCostBasisReport.mockResolvedValue(
    ok({
      calculationId: 'calc-1',
      sourceTaxCurrency: 'CAD',
      displayCurrency: 'CAD',
      acquisitions: [],
      dispositions: [],
      transfers: [],
      summary: {
        totalProceeds: parseDecimal('0'),
        totalCostBasis: parseDecimal('0'),
        totalGainLoss: parseDecimal('0'),
        totalTaxableGainLoss: parseDecimal('0'),
        totalDeniedLoss: parseDecimal('0'),
      },
    } as never)
  );
}

describe('runCanadaCostBasisCalculation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed when missing-price policy is error', async () => {
    const pricedTransaction = createAcquisitionTransaction({
      id: 1,
      assetId: 'exchange:kraken:btc',
      assetSymbol: 'BTC' as Currency,
      quantity: '1',
      timestamp: '2025-01-01T12:00:00.000Z',
      unitPriceCad: '60000',
    });
    const unpricedTransaction = createUnpricedAcquisitionTransaction({
      id: 2,
      assetId: 'exchange:kraken:eth',
      assetSymbol: 'ETH' as Currency,
      quantity: '2',
      timestamp: '2025-01-02T12:00:00.000Z',
    });

    const result = await runCanadaCostBasisCalculation({
      input: createBaseInput(),
      transactions: [pricedTransaction, unpricedTransaction],
      confirmedLinks: [],
      fxRateProvider: createCanadaFxProvider(),
      missingPricePolicy: 'error',
      poolSnapshotStrategy: 'report-end',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('1 transactions are missing required price data');
    }
    expect(mockRunCanadaAcbWorkflow).not.toHaveBeenCalled();
  });

  it('excludes missing-price transactions and returns execution metadata when policy is exclude', async () => {
    const pricedTransaction = createAcquisitionTransaction({
      id: 1,
      assetId: 'exchange:kraken:btc',
      assetSymbol: 'BTC' as Currency,
      quantity: '1',
      timestamp: '2025-01-01T12:00:00.000Z',
      unitPriceCad: '60000',
    });
    const unpricedTransaction = createUnpricedAcquisitionTransaction({
      id: 2,
      assetId: 'exchange:kraken:eth',
      assetSymbol: 'ETH' as Currency,
      quantity: '2',
      timestamp: '2025-01-02T12:00:00.000Z',
    });

    configureCanadaRunnerMocks();

    const result = await runCanadaCostBasisCalculation({
      input: createBaseInput(),
      transactions: [pricedTransaction, unpricedTransaction],
      confirmedLinks: [],
      fxRateProvider: createCanadaFxProvider(),
      missingPricePolicy: 'exclude',
      poolSnapshotStrategy: 'report-end',
    });

    expect(result.isOk()).toBe(true);
    expect(mockRunCanadaAcbWorkflow).toHaveBeenCalledWith(
      [pricedTransaction],
      [],
      expect.anything(),
      expect.anything()
    );
    if (result.isOk()) {
      expect(result.value.executionMeta).toEqual({
        missingPricesCount: 1,
        retainedTransactionIds: [1],
      });
    }
  });

  it('filters the pool snapshot pass to report end when using report-end strategy', async () => {
    const inputContext = createCanadaInputContext({
      inputEvents: [
        createCanadaAcquisitionEvent({
          eventId: 'evt-before',
          transactionId: 1,
          timestamp: '2025-01-05T12:00:00.000Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC' as Currency,
          quantity: '1',
          unitValueCad: '60000',
        }),
        createCanadaAcquisitionEvent({
          eventId: 'evt-after',
          transactionId: 2,
          timestamp: '2025-01-20T12:00:00.000Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC' as Currency,
          quantity: '0.5',
          unitValueCad: '65000',
        }),
      ],
    });
    const adjustmentEvent = createCanadaFeeAdjustmentEvent({
      adjustmentType: 'add-to-pool-cost',
      assetId: 'exchange:kraken:btc',
      assetSymbol: 'BTC',
      eventId: 'evt-adjustment',
      feeAssetId: 'fiat:cad',
      feeAssetSymbol: 'CAD',
      feeQuantity: '10',
      timestamp: '2025-01-25T12:00:00.000Z',
      totalValueCad: '10',
      transactionId: 3,
    });
    const engineInputs: ReturnType<typeof createCanadaInputContext>[] = [];

    configureCanadaRunnerMocks(inputContext);
    mockRunCanadaSuperficialLossEngine.mockReturnValue(
      ok({
        adjustmentEvents: [adjustmentEvent],
        adjustments: [],
      } as never)
    );
    mockRunCanadaAcbEngine.mockImplementation((engineInput) => {
      engineInputs.push(engineInput as ReturnType<typeof createCanadaInputContext>);
      return ok(createEngineResult());
    });

    const result = await runCanadaCostBasisCalculation({
      input: createBaseInput(),
      transactions: [
        createAcquisitionTransaction({
          id: 1,
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC' as Currency,
          quantity: '1',
          timestamp: '2025-01-01T12:00:00.000Z',
          unitPriceCad: '60000',
        }),
      ],
      confirmedLinks: [],
      fxRateProvider: createCanadaFxProvider(),
      missingPricePolicy: 'error',
      poolSnapshotStrategy: 'report-end',
    });

    expect(result.isOk()).toBe(true);
    expect(engineInputs).toHaveLength(2);
    if (result.isOk()) {
      expect(result.value.inputContext?.inputEvents.map((event) => event.eventId)).toEqual([
        'evt-before',
        'evt-after',
        'evt-adjustment',
      ]);
    }
    expect(engineInputs[0]?.inputEvents.map((event) => event.eventId)).toEqual([
      'evt-before',
      'evt-after',
      'evt-adjustment',
    ]);
    expect(engineInputs[1]?.inputEvents.map((event) => event.eventId)).toEqual(['evt-before']);
  });

  it('keeps the full augmented input range when using full-input-range strategy', async () => {
    const inputContext = createCanadaInputContext({
      inputEvents: [
        createCanadaAcquisitionEvent({
          eventId: 'evt-before',
          transactionId: 1,
          timestamp: '2025-01-05T12:00:00.000Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC' as Currency,
          quantity: '1',
          unitValueCad: '60000',
        }),
        createCanadaAcquisitionEvent({
          eventId: 'evt-after',
          transactionId: 2,
          timestamp: '2025-01-20T12:00:00.000Z',
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC' as Currency,
          quantity: '0.5',
          unitValueCad: '65000',
        }),
      ],
    });
    const adjustmentEvent = createCanadaFeeAdjustmentEvent({
      adjustmentType: 'add-to-pool-cost',
      assetId: 'exchange:kraken:btc',
      assetSymbol: 'BTC',
      eventId: 'evt-adjustment',
      feeAssetId: 'fiat:cad',
      feeAssetSymbol: 'CAD',
      feeQuantity: '10',
      timestamp: '2025-01-25T12:00:00.000Z',
      totalValueCad: '10',
      transactionId: 3,
    });
    const engineInputs: ReturnType<typeof createCanadaInputContext>[] = [];

    configureCanadaRunnerMocks(inputContext);
    mockRunCanadaSuperficialLossEngine.mockReturnValue(
      ok({
        adjustmentEvents: [adjustmentEvent],
        adjustments: [],
      } as never)
    );
    mockRunCanadaAcbEngine.mockImplementation((engineInput) => {
      engineInputs.push(engineInput as ReturnType<typeof createCanadaInputContext>);
      return ok(createEngineResult());
    });

    const result = await runCanadaCostBasisCalculation({
      input: createBaseInput(),
      transactions: [
        createAcquisitionTransaction({
          id: 1,
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC' as Currency,
          quantity: '1',
          timestamp: '2025-01-01T12:00:00.000Z',
          unitPriceCad: '60000',
        }),
      ],
      confirmedLinks: [],
      fxRateProvider: createCanadaFxProvider(),
      missingPricePolicy: 'error',
      poolSnapshotStrategy: 'full-input-range',
    });

    expect(result.isOk()).toBe(true);
    expect(engineInputs).toHaveLength(2);
    if (result.isOk()) {
      expect(result.value.inputContext?.inputEvents.map((event) => event.eventId)).toEqual([
        'evt-before',
        'evt-after',
        'evt-adjustment',
      ]);
    }
    expect(engineInputs[1]?.inputEvents.map((event) => event.eventId)).toEqual([
      'evt-before',
      'evt-after',
      'evt-adjustment',
    ]);
  });
});
