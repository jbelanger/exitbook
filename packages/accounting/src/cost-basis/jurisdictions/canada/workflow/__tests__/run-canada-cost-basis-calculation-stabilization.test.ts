 
import type { Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { ok, parseDecimal } from '@exitbook/foundation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildCanadaDisplayCostBasisReport,
  mockBuildCanadaTaxReport,
  mockGetCostBasisRebuildTransactions,
  mockRunCanadaAcbEngine,
  mockRunCanadaAcbWorkflow,
  mockRunCanadaSuperficialLossEngine,
  mockStabilizeExcludedRebuildTransactions,
} = vi.hoisted(() => ({
  mockBuildCanadaDisplayCostBasisReport: vi.fn(),
  mockBuildCanadaTaxReport: vi.fn(),
  mockGetCostBasisRebuildTransactions: vi.fn(),
  mockRunCanadaAcbEngine: vi.fn(),
  mockRunCanadaAcbWorkflow: vi.fn(),
  mockRunCanadaSuperficialLossEngine: vi.fn(),
  mockStabilizeExcludedRebuildTransactions: vi.fn(),
}));

vi.mock('../../../../workflow/price-completeness.js', () => ({
  getCostBasisRebuildTransactions: mockGetCostBasisRebuildTransactions,
  stabilizeExcludedRebuildTransactions: mockStabilizeExcludedRebuildTransactions,
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
  createCanadaInputContext,
  createCanadaPriceRuntime,
  materializeTestTransaction,
} from '../../__tests__/test-utils.js';
import { runCanadaCostBasisCalculation } from '../run-canada-cost-basis-calculation.js';

function createTransaction(id: number): Transaction {
  return materializeTestTransaction({
    id,
    accountId: 1,
    identityReference: `tx-${id}`,
    datetime: '2025-01-01T12:00:00.000Z',
    timestamp: Date.parse('2025-01-01T12:00:00.000Z'),
    platformKey: 'kraken',
    platformKind: 'exchange',
    status: 'success',
    movements: {
      inflows: [
        {
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('1'),
          priceAtTxTime: {
            price: {
              amount: parseDecimal('60000'),
              currency: 'CAD' as Currency,
            },
            source: 'exchange-execution',
            fetchedAt: new Date('2025-01-01T12:00:00.000Z'),
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

function createBaseInput() {
  return {
    method: 'average-cost' as const,
    jurisdiction: 'CA' as const,
    taxYear: 2025,
    currency: 'CAD' as const,
    startDate: new Date('2025-01-01T00:00:00.000Z'),
    endDate: new Date('2025-12-31T23:59:59.999Z'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockRunCanadaAcbWorkflow.mockResolvedValue(
    ok({
      inputContext: createCanadaInputContext({ inputEvents: [] }),
      acbEngineResult: {
        eventPoolSnapshots: [],
        pools: [],
        dispositions: [],
        totalProceedsCad: parseDecimal('0'),
        totalCostBasisCad: parseDecimal('0'),
        totalGainLossCad: parseDecimal('0'),
      },
    } as never)
  );
  mockRunCanadaSuperficialLossEngine.mockReturnValue(
    ok({
      adjustmentEvents: [],
      adjustments: [],
    } as never)
  );
  mockRunCanadaAcbEngine.mockReturnValue(
    ok({
      eventPoolSnapshots: [],
      pools: [],
      dispositions: [],
      totalProceedsCad: parseDecimal('0'),
      totalCostBasisCad: parseDecimal('0'),
      totalGainLossCad: parseDecimal('0'),
    })
  );
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
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runCanadaCostBasisCalculation stabilization seam', () => {
  it('uses the stabilized rebuild subset when missing-price policy is exclude', async () => {
    const retained = createTransaction(1);
    const unstableDependency = createTransaction(2);

    mockGetCostBasisRebuildTransactions.mockReturnValue(
      ok({
        missingPricesCount: 1,
        rebuildTransactions: [retained, unstableDependency],
      })
    );
    mockStabilizeExcludedRebuildTransactions.mockReturnValue(ok([retained]));

    const result = await runCanadaCostBasisCalculation({
      input: createBaseInput(),
      transactions: [retained, unstableDependency],
      confirmedLinks: [],
      priceRuntime: createCanadaPriceRuntime(),
      missingPricePolicy: 'exclude',
      poolSnapshotStrategy: 'report-end',
    });

    expect(result.isOk()).toBe(true);
    expect(mockStabilizeExcludedRebuildTransactions).toHaveBeenCalledWith(
      [retained, unstableDependency],
      'CAD',
      undefined
    );
    expect(mockRunCanadaAcbWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        transactions: [retained],
      })
    );
    if (result.isOk()) {
      expect(result.value.executionMeta).toEqual({
        missingPricesCount: 1,
        retainedTransactionIds: [1],
      });
    }
  });
});
