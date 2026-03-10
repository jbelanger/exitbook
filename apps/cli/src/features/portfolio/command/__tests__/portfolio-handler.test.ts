import {
  buildCanadaDisplayCostBasisReport,
  buildCanadaTaxReport,
  getPriceCompleteCostBasisTransactions,
  runCanadaAcbEngine,
  runCanadaAcbWorkflow,
  runCanadaSuperficialLossEngine,
  runCostBasisPipeline,
} from '@exitbook/accounting';
import { ok, type Currency, type UniversalTransactionData } from '@exitbook/core';
import { buildCostBasisPorts, type DataContext } from '@exitbook/data';
import { calculateBalances } from '@exitbook/ingestion';
import type { PriceProviderManager } from '@exitbook/price-providers';
import { Decimal } from 'decimal.js';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { PortfolioHandler } from '../portfolio-handler.ts';

vi.mock('@exitbook/accounting', async () => {
  const actual = await vi.importActual('@exitbook/accounting');
  return {
    ...actual,
    StandardFxRateProvider: vi.fn().mockImplementation(function () {
      return {
        getRateToUSD: vi.fn(),
        getRateFromUSD: vi.fn(),
      };
    }),
    getPriceCompleteCostBasisTransactions: vi.fn(),
    runCostBasisPipeline: vi.fn(),
    runCanadaAcbWorkflow: vi.fn(),
    runCanadaSuperficialLossEngine: vi.fn(),
    runCanadaAcbEngine: vi.fn(),
    buildCanadaTaxReport: vi.fn(),
    buildCanadaDisplayCostBasisReport: vi.fn(),
  };
});

vi.mock('@exitbook/data', async () => {
  const actual = await vi.importActual('@exitbook/data');
  return {
    ...actual,
    buildCostBasisPorts: vi.fn(),
  };
});

vi.mock('@exitbook/ingestion', async () => {
  const actual = await vi.importActual('@exitbook/ingestion');
  return {
    ...actual,
    calculateBalances: vi.fn(),
  };
});

vi.mock('@exitbook/logger', () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function createTransaction(): UniversalTransactionData {
  return {
    id: 1,
    accountId: 1,
    externalId: 'ext-1',
    datetime: '2024-01-01T00:00:00.000Z',
    timestamp: new Date('2024-01-01T00:00:00.000Z').getTime(),
    source: 'kraken',
    sourceType: 'exchange-api',
    status: 'success',
    movements: {
      inflows: [
        {
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC',
          grossAmount: new Decimal('1'),
          netAmount: new Decimal('1'),
          priceAtTxTime: {
            price: { amount: new Decimal('60000'), currency: 'USD' as Currency },
            source: 'test',
            fetchedAt: new Date('2024-01-01T00:00:00.000Z'),
          },
        },
      ],
      outflows: [],
    },
    fees: [],
    operation: {
      category: 'trade',
      type: 'buy',
    },
    notes: [],
  } as unknown as UniversalTransactionData;
}

describe('PortfolioHandler', () => {
  let handler: PortfolioHandler;
  let mockDb: DataContext;
  let mockPriceManager: PriceProviderManager;
  let transactionRepo: { findAll: Mock };
  let accountRepo: { findAll: Mock };
  const tx = createTransaction();

  beforeEach(() => {
    vi.clearAllMocks();

    transactionRepo = { findAll: vi.fn().mockResolvedValue(ok([tx])) };
    accountRepo = {
      findAll: vi.fn().mockResolvedValue(ok([{ id: 1, sourceName: 'kraken', accountType: 'exchange-api' as const }])),
    };
    mockDb = {
      transactions: transactionRepo,
      accounts: accountRepo,
    } as unknown as DataContext;

    mockPriceManager = {
      fetchPrice: vi.fn().mockResolvedValue(
        ok({
          data: {
            price: new Decimal('9000'),
            source: 'test',
            fetchedAt: new Date('2025-01-01T00:00:00.000Z'),
          },
        })
      ),
    } as unknown as PriceProviderManager;

    vi.mocked(calculateBalances).mockReturnValue({
      balances: { 'exchange:kraken:btc': new Decimal('1') },
      assetMetadata: { 'exchange:kraken:btc': 'BTC' },
    });

    vi.mocked(buildCostBasisPorts).mockReturnValue({
      loadCostBasisContext: vi.fn().mockResolvedValue(ok({ confirmedLinks: [] })),
    } as never);

    vi.mocked(getPriceCompleteCostBasisTransactions).mockReturnValue(
      ok({ missingPricesCount: 0, priceCompleteTransactions: [tx] })
    );

    vi.mocked(runCanadaAcbWorkflow).mockResolvedValue(
      ok({
        inputContext: {
          taxCurrency: 'CAD',
          scopedTransactionIds: [1],
          validatedTransferLinkIds: [],
          feeOnlyInternalCarryoverSourceTransactionIds: [],
          inputEvents: [
            {
              kind: 'acquisition',
              provenanceKind: 'scoped-movement',
              eventId: 'evt-1',
              transactionId: 1,
              timestamp: new Date('2024-01-01T00:00:00.000Z'),
              assetId: 'exchange:kraken:btc',
              assetIdentityKey: 'btc',
              taxPropertyKey: 'ca:btc',
              assetSymbol: 'BTC' as Currency,
              quantity: new Decimal('1'),
              valuation: {
                taxCurrency: 'CAD',
                storagePriceAmount: new Decimal('60000'),
                storagePriceCurrency: 'USD' as Currency,
                quotedPriceAmount: new Decimal('60000'),
                quotedPriceCurrency: 'USD' as Currency,
                unitValueCad: new Decimal('60000'),
                totalValueCad: new Decimal('60000'),
                valuationSource: 'usd-to-cad-fx' as const,
                fxRateToCad: new Decimal('1'),
                fxSource: 'test',
                fxTimestamp: new Date('2024-01-01T00:00:00.000Z'),
              },
            },
          ],
        },
        acbEngineResult: {
          eventPoolSnapshots: [],
          pools: [],
          dispositions: [],
          totalProceedsCad: new Decimal('0'),
          totalCostBasisCad: new Decimal('0'),
          totalGainLossCad: new Decimal('0'),
        },
      })
    );

    vi.mocked(runCanadaSuperficialLossEngine).mockReturnValue(
      ok({
        adjustmentEvents: [],
        dispositionAdjustments: [],
        superficialLossAdjustments: [],
      } as never)
    );

    vi.mocked(runCanadaAcbEngine).mockReturnValue(
      ok({
        eventPoolSnapshots: [],
        pools: [],
        dispositions: [],
        totalProceedsCad: new Decimal('0'),
        totalCostBasisCad: new Decimal('0'),
        totalGainLossCad: new Decimal('0'),
      } as never)
    );

    vi.mocked(buildCanadaTaxReport).mockReturnValue(
      ok({
        calculationId: 'calc-1',
        taxCurrency: 'CAD',
        acquisitions: [
          {
            id: 'layer-1',
            acquisitionEventId: 'evt-1',
            transactionId: 1,
            taxPropertyKey: 'ca:btc',
            assetSymbol: 'BTC' as Currency,
            acquiredAt: new Date('2024-01-01T00:00:00.000Z'),
            quantityAcquired: new Decimal('1'),
            remainingQuantity: new Decimal('1'),
            totalCostCad: new Decimal('60000'),
            remainingAllocatedAcbCad: new Decimal('60000'),
            costBasisPerUnitCad: new Decimal('60000'),
          },
        ],
        dispositions: [],
        transfers: [],
        superficialLossAdjustments: [],
        displayContext: { transferMarketValueCadByTransferId: new Map() },
        summary: {
          totalProceedsCad: new Decimal('0'),
          totalCostBasisCad: new Decimal('0'),
          totalGainLossCad: new Decimal('0'),
          totalTaxableGainLossCad: new Decimal('0'),
          totalDeniedLossCad: new Decimal('0'),
        },
      } as never)
    );

    vi.mocked(buildCanadaDisplayCostBasisReport).mockResolvedValue(
      ok({
        calculationId: 'calc-1',
        sourceTaxCurrency: 'CAD',
        displayCurrency: 'USD' as Currency,
        acquisitions: [
          {
            id: 'layer-1',
            acquisitionEventId: 'evt-1',
            transactionId: 1,
            taxPropertyKey: 'ca:btc',
            assetSymbol: 'BTC' as Currency,
            acquiredAt: new Date('2024-01-01T00:00:00.000Z'),
            quantityAcquired: new Decimal('1'),
            remainingQuantity: new Decimal('1'),
            totalCostCad: new Decimal('60000'),
            remainingAllocatedAcbCad: new Decimal('60000'),
            costBasisPerUnitCad: new Decimal('60000'),
            displayCostBasisPerUnit: new Decimal('45000'),
            displayTotalCost: new Decimal('45000'),
            displayRemainingAllocatedCost: new Decimal('45000'),
            fxConversion: {
              sourceTaxCurrency: 'CAD',
              displayCurrency: 'USD' as Currency,
              fxRate: new Decimal('0.75'),
              fxSource: 'test',
              fxFetchedAt: new Date('2024-01-01T00:00:00.000Z'),
            },
          },
        ],
        dispositions: [],
        transfers: [],
        summary: {
          totalProceeds: new Decimal('0'),
          totalCostBasis: new Decimal('0'),
          totalGainLoss: new Decimal('0'),
          totalTaxableGainLoss: new Decimal('0'),
          totalDeniedLoss: new Decimal('0'),
        },
      } as never)
    );

    vi.mocked(runCostBasisPipeline).mockResolvedValue(
      ok({
        summary: {
          lots: [],
          disposals: [],
        },
        missingPricesCount: 0,
        priceCompleteTransactions: [tx],
      } as never)
    );

    handler = new PortfolioHandler(mockDb, mockPriceManager);
  });

  it('routes CA portfolio calculations through the Canada path instead of the generic pipeline', async () => {
    const result = await handler.execute({
      method: 'average-cost',
      jurisdiction: 'CA',
      displayCurrency: 'USD',
      asOf: new Date('2025-01-01T00:00:00.000Z'),
    });

    expect(result.isOk()).toBe(true);
    expect(runCanadaAcbWorkflow).toHaveBeenCalled();
    expect(runCostBasisPipeline).not.toHaveBeenCalled();
    if (result.isOk()) {
      expect(result.value.positions[0]?.sourceAssetIds).toEqual(['exchange:kraken:btc']);
      expect(result.value.displayCurrency).toBe('USD');
    }
  });

  it('rejects non-average-cost methods for CA before any data loading', async () => {
    const result = await handler.execute({
      method: 'fifo',
      jurisdiction: 'CA',
      displayCurrency: 'USD',
      asOf: new Date('2025-01-01T00:00:00.000Z'),
    });

    expect(result.isErr()).toBe(true);
    expect(transactionRepo.findAll).not.toHaveBeenCalled();
    expect(runCanadaAcbWorkflow).not.toHaveBeenCalled();
    expect(runCostBasisPipeline).not.toHaveBeenCalled();
  });
});
