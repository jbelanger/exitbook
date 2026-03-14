/* eslint-disable @typescript-eslint/no-unsafe-assignment -- acceptable for tests */
import { persistCostBasisFailureSnapshot, runCanadaCostBasisCalculation } from '@exitbook/accounting';
import { err, ok, type Currency, type UniversalTransactionData } from '@exitbook/core';
import { buildCostBasisPorts, type DataContext } from '@exitbook/data';
import { calculateBalances } from '@exitbook/ingestion';
import type { PriceProviderManager } from '@exitbook/price-providers';
import { Decimal } from 'decimal.js';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
  ensureAssetReviewProjectionFresh,
  readAssetReviewProjectionSummaries,
} from '../../../shared/asset-review-projection-runtime.js';
import { PortfolioHandler } from '../portfolio-handler.ts';

const { mockCostBasisWorkflowExecute } = vi.hoisted(() => ({
  mockCostBasisWorkflowExecute: vi.fn(),
}));

vi.mock('@exitbook/accounting', async () => {
  const actual = await vi.importActual('@exitbook/accounting');
  return {
    ...actual,
    CostBasisWorkflow: vi.fn().mockImplementation(function () {
      return {
        execute: mockCostBasisWorkflowExecute,
      };
    }),
    persistCostBasisFailureSnapshot: vi.fn(),
    StandardFxRateProvider: vi.fn().mockImplementation(function () {
      return {
        getRateToUSD: vi.fn(),
        getRateFromUSD: vi.fn(),
      };
    }),
    runCanadaCostBasisCalculation: vi.fn(),
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

vi.mock('../../../shared/asset-review-projection-runtime.js', () => ({
  ensureAssetReviewProjectionFresh: vi.fn(),
  readAssetReviewProjectionSummaries: vi.fn(),
}));

vi.mock('../../../shared/cost-basis-dependency-watermark-runtime.js', () => ({
  readCostBasisDependencyWatermark: vi.fn().mockResolvedValue(
    ok({
      links: { status: 'fresh', lastBuiltAt: new Date('2026-03-14T12:00:00.000Z') },
      assetReview: { status: 'fresh', lastBuiltAt: new Date('2026-03-14T12:00:01.000Z') },
      pricesLastMutatedAt: new Date('2026-03-14T12:00:02.000Z'),
      exclusionFingerprint: 'excluded-assets:none',
    })
  ),
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

function createExcludedAssetTradeTransaction(): UniversalTransactionData {
  return {
    id: 2,
    accountId: 1,
    externalId: 'ext-2',
    datetime: '2024-01-02T00:00:00.000Z',
    timestamp: new Date('2024-01-02T00:00:00.000Z').getTime(),
    source: 'base',
    sourceType: 'blockchain',
    status: 'success',
    movements: {
      inflows: [
        {
          assetId: 'blockchain:base:0xspam',
          assetSymbol: 'SPAM',
          grossAmount: new Decimal('1000'),
          netAmount: new Decimal('1000'),
        },
      ],
      outflows: [
        {
          assetId: 'blockchain:base:usdt',
          assetSymbol: 'USDT',
          grossAmount: new Decimal('147.55110826'),
          netAmount: new Decimal('147.55110826'),
        },
      ],
    },
    fees: [],
    operation: {
      category: 'trade',
      type: 'swap',
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

    vi.mocked(ensureAssetReviewProjectionFresh).mockResolvedValue(ok(undefined));
    vi.mocked(readAssetReviewProjectionSummaries).mockResolvedValue(ok(new Map()));
    vi.mocked(persistCostBasisFailureSnapshot).mockResolvedValue(
      ok({ scopeKey: 'cost-basis:test', snapshotId: 'failure-snapshot-1' })
    );

    vi.mocked(runCanadaCostBasisCalculation).mockResolvedValue(
      ok({
        kind: 'canada-workflow',
        calculation: {
          id: 'calc-1',
          calculationDate: new Date('2025-01-01T00:00:00.000Z'),
          method: 'average-cost',
          jurisdiction: 'CA',
          taxYear: 2025,
          displayCurrency: 'USD' as Currency,
          taxCurrency: 'CAD',
          startDate: new Date('1970-01-01T00:00:00.000Z'),
          endDate: new Date('2025-01-01T00:00:00.000Z'),
          transactionsProcessed: 1,
          assetsProcessed: ['BTC'],
        },
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
        executionMeta: {
          missingPricesCount: 0,
          retainedTransactionIds: [tx.id],
        },
        taxReport: {
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
        },
        displayReport: {
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
        },
      } as never)
    );

    mockCostBasisWorkflowExecute.mockResolvedValue(
      ok({
        kind: 'generic-pipeline',
        summary: {
          lots: [],
          disposals: [],
        },
        lots: [],
        disposals: [],
        lotTransfers: [],
        executionMeta: {
          missingPricesCount: 0,
          retainedTransactionIds: [tx.id],
        },
      } as never)
    );

    vi.mocked(readAssetReviewProjectionSummaries).mockResolvedValue(ok(new Map()));

    handler = new PortfolioHandler(mockDb, mockPriceManager, '/tmp/test-data');
  });

  it('routes CA portfolio calculations through the Canada path instead of the generic pipeline', async () => {
    const result = await handler.execute({
      method: 'average-cost',
      jurisdiction: 'CA',
      displayCurrency: 'USD',
      asOf: new Date('2025-01-01T00:00:00.000Z'),
    });

    expect(result.isOk()).toBe(true);
    expect(runCanadaCostBasisCalculation).toHaveBeenCalled();
    expect(mockCostBasisWorkflowExecute).not.toHaveBeenCalled();
    if (result.isOk()) {
      expect(result.value.positions[0]?.sourceAssetIds).toEqual(['exchange:kraken:btc']);
      expect(result.value.displayCurrency).toBe('USD');
    }
  });

  it('routes non-CA portfolio calculations through CostBasisWorkflow with soft missing-price policy', async () => {
    const result = await handler.execute({
      method: 'fifo',
      jurisdiction: 'US',
      displayCurrency: 'USD',
      asOf: new Date('2025-01-01T00:00:00.000Z'),
    });

    expect(result.isOk()).toBe(true);
    expect(mockCostBasisWorkflowExecute).toHaveBeenCalledTimes(1);
    expect(mockCostBasisWorkflowExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          method: 'fifo',
          jurisdiction: 'US',
          currency: 'USD',
          taxYear: 2025,
        }),
      }),
      [tx],
      {
        accountingExclusionPolicy: { excludedAssetIds: new Set<string>() },
        assetReviewSummaries: new Map(),
        missingPricePolicy: 'exclude',
      }
    );
    expect(runCanadaCostBasisCalculation).not.toHaveBeenCalled();
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
    expect(runCanadaCostBasisCalculation).not.toHaveBeenCalled();
    expect(mockCostBasisWorkflowExecute).not.toHaveBeenCalled();
  });

  it('persists a failure snapshot when generic portfolio cost basis fails', async () => {
    mockCostBasisWorkflowExecute.mockResolvedValue(err(new Error('generic workflow failed')));

    const result = await handler.execute({
      method: 'fifo',
      jurisdiction: 'US',
      displayCurrency: 'USD',
      asOf: new Date('2025-01-01T00:00:00.000Z'),
    });

    expect(result.isErr()).toBe(true);
    expect(persistCostBasisFailureSnapshot).toHaveBeenCalledTimes(1);
  });

  it('persists a failure snapshot when Canada portfolio cost basis fails', async () => {
    vi.mocked(runCanadaCostBasisCalculation).mockResolvedValue(err(new Error('canada workflow failed')));

    const result = await handler.execute({
      method: 'average-cost',
      jurisdiction: 'CA',
      displayCurrency: 'USD',
      asOf: new Date('2025-01-01T00:00:00.000Z'),
    });

    expect(result.isErr()).toBe(true);
    expect(persistCostBasisFailureSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        consumer: 'portfolio',
        stage: 'portfolio.canada-cost-basis',
        error: expect.objectContaining({ message: 'canada workflow failed' }),
      })
    );
  });

  it('returns a combined error when portfolio failure snapshot persistence fails', async () => {
    mockCostBasisWorkflowExecute.mockResolvedValue(err(new Error('generic workflow failed')));
    vi.mocked(persistCostBasisFailureSnapshot).mockResolvedValue(err(new Error('failure snapshot write failed')));

    const result = await handler.execute({
      method: 'fifo',
      jurisdiction: 'US',
      displayCurrency: 'USD',
      asOf: new Date('2025-01-01T00:00:00.000Z'),
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe(
        'Portfolio cost basis failed: generic workflow failed. Additionally, failure snapshot persistence failed: failure snapshot write failed'
      );
    }
  });

  it('omits transactions touching excluded assets from portfolio balances, cost basis, and returned transactions', async () => {
    const excludedTradeTx = createExcludedAssetTradeTransaction();
    transactionRepo.findAll.mockResolvedValue(ok([tx, excludedTradeTx]));

    vi.mocked(calculateBalances).mockImplementation((transactions) => {
      expect(transactions).toEqual([tx]);
      return {
        balances: { 'exchange:kraken:btc': new Decimal('1') },
        assetMetadata: { 'exchange:kraken:btc': 'BTC' },
      };
    });

    mockCostBasisWorkflowExecute.mockResolvedValue(
      ok({
        kind: 'generic-pipeline',
        summary: {
          lots: [],
          disposals: [],
        },
        lots: [],
        disposals: [],
        lotTransfers: [],
        executionMeta: {
          missingPricesCount: 1,
          retainedTransactionIds: [tx.id],
        },
      } as never)
    );

    handler = new PortfolioHandler(mockDb, mockPriceManager, '/tmp/test-data', {
      excludedAssetIds: new Set(['blockchain:base:0xspam']),
    });

    const result = await handler.execute({
      method: 'fifo',
      jurisdiction: 'US',
      displayCurrency: 'USD',
      asOf: new Date('2025-01-01T00:00:00.000Z'),
    });

    expect(result.isOk()).toBe(true);
    expect(mockCostBasisWorkflowExecute).toHaveBeenCalledWith(
      expect.anything(),
      [tx],
      expect.objectContaining({
        accountingExclusionPolicy: {
          excludedAssetIds: new Set(['blockchain:base:0xspam']),
        },
      })
    );

    if (result.isOk()) {
      expect(result.value.transactions).toEqual([tx]);
      expect(result.value.warnings).toEqual([
        '1 transactions missing prices were excluded from cost basis — unrealized P&L may be incomplete',
      ]);
    }
  });
});
