/* eslint-disable @typescript-eslint/no-unsafe-assignment -- acceptable for tests */
import {
  buildCostBasisScopeKey,
  persistCostBasisFailureSnapshot,
  runCanadaCostBasisCalculation,
  type ICostBasisContextReader,
  type ICostBasisFailureSnapshotStore,
} from '@exitbook/accounting/cost-basis';
import {
  PortfolioHandler,
  type ReadPortfolioAssetReviewSummaries,
  type ReadPortfolioDependencyWatermark,
} from '@exitbook/accounting/portfolio';
import type { Transaction } from '@exitbook/core';
import { err, ok, type Currency } from '@exitbook/foundation';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';
import { Decimal } from 'decimal.js';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { mockCostBasisWorkflowExecute } = vi.hoisted(() => ({
  mockCostBasisWorkflowExecute: vi.fn(),
}));

vi.mock('../../../../../../../packages/accounting/src/cost-basis/workflow/cost-basis-workflow.ts', () => ({
  CostBasisWorkflow: vi.fn().mockImplementation(function () {
    return {
      execute: mockCostBasisWorkflowExecute,
    };
  }),
}));

vi.mock('../../../../../../../packages/accounting/src/cost-basis/artifacts/failure-snapshot-service.ts', () => ({
  persistCostBasisFailureSnapshot: vi.fn(),
}));

vi.mock('../../../../../../../packages/accounting/src/price-enrichment/fx/usd-conversion-rate-provider.ts', () => ({
  UsdConversionRateProvider: vi.fn().mockImplementation(function () {
    return {
      getRateToUSD: vi.fn(),
      getRateFromUSD: vi.fn(),
    };
  }),
}));

vi.mock(
  '../../../../../../../packages/accounting/src/cost-basis/jurisdictions/canada/workflow/run-canada-cost-basis-calculation.ts',
  () => ({
    runCanadaCostBasisCalculation: vi.fn(),
  })
);

vi.mock('@exitbook/logger', () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function createTransaction(): Transaction {
  return {
    id: 1,
    accountId: 1,
    txFingerprint: 'ext-1',
    datetime: '2024-01-01T00:00:00.000Z',
    timestamp: new Date('2024-01-01T00:00:00.000Z').getTime(),
    source: 'kraken',
    platformKind: 'exchange-api',
    status: 'success',
    movements: {
      inflows: [
        {
          movementFingerprint: 'mv-ext-1-in-1',
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
  } as unknown as Transaction;
}

function createExcludedAssetTradeTransaction(): Transaction {
  return {
    id: 2,
    accountId: 1,
    txFingerprint: 'ext-2',
    datetime: '2024-01-02T00:00:00.000Z',
    timestamp: new Date('2024-01-02T00:00:00.000Z').getTime(),
    source: 'base',
    platformKind: 'blockchain',
    status: 'success',
    movements: {
      inflows: [
        {
          movementFingerprint: 'mv-ext-2-in-1',
          assetId: 'blockchain:base:0xspam',
          assetSymbol: 'SPAM',
          grossAmount: new Decimal('1000'),
          netAmount: new Decimal('1000'),
        },
      ],
      outflows: [
        {
          movementFingerprint: 'mv-ext-2-out-1',
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
  } as unknown as Transaction;
}

describe('PortfolioHandler', () => {
  let handler: PortfolioHandler;
  let mockPriceRuntime: IPriceProviderRuntime;
  let mockCostBasisStore: ICostBasisContextReader;
  let mockFailureSnapshotStore: ICostBasisFailureSnapshotStore;
  let mockReadAssetReviewSummaries: ReadPortfolioAssetReviewSummaries;
  let mockReadDependencyWatermark: ReadPortfolioDependencyWatermark;
  let loadCostBasisContext: Mock;
  let readAssetReviewSummaries: Mock;
  let readDependencyWatermark: Mock;
  const tx = createTransaction();

  beforeEach(() => {
    vi.clearAllMocks();

    loadCostBasisContext = vi.fn().mockResolvedValue(
      ok({
        confirmedLinks: [],
        transactions: [tx],
        accounts: [{ id: 1, platformKey: 'kraken', accountType: 'exchange-api' as const }],
      })
    );
    mockCostBasisStore = {
      loadCostBasisContext,
    } as unknown as ICostBasisContextReader;

    readAssetReviewSummaries = vi.fn().mockResolvedValue(ok(new Map()));
    readDependencyWatermark = vi.fn().mockResolvedValue(
      ok({
        links: { status: 'fresh', lastBuiltAt: new Date('2026-03-14T12:00:00.000Z') },
        assetReview: { status: 'fresh', lastBuiltAt: new Date('2026-03-14T12:00:01.000Z') },
        pricesLastMutatedAt: new Date('2026-03-14T12:00:02.000Z'),
        exclusionFingerprint: 'excluded-assets:none',
      })
    );
    mockReadAssetReviewSummaries = readAssetReviewSummaries;
    mockReadDependencyWatermark = readDependencyWatermark;
    mockFailureSnapshotStore = {
      replaceLatest: vi.fn().mockResolvedValue(ok(undefined)),
    };

    mockPriceRuntime = {
      fetchPrice: vi.fn().mockResolvedValue(
        ok({
          assetSymbol: 'BTC' as Currency,
          timestamp: new Date('2025-01-01T00:00:00.000Z'),
          currency: 'USD' as Currency,
          price: new Decimal('9000'),
          source: 'test',
          fetchedAt: new Date('2025-01-01T00:00:00.000Z'),
        })
      ),
      cleanup: vi.fn().mockResolvedValue(ok(undefined)),
      setManualFxRate: vi.fn().mockResolvedValue(ok(undefined)),
      setManualPrice: vi.fn().mockResolvedValue(ok(undefined)),
    };
    vi.mocked(persistCostBasisFailureSnapshot).mockResolvedValue(
      ok({
        scopeKey: buildCostBasisScopeKey(7, {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2025,
          currency: 'USD',
          startDate: new Date(0),
          endDate: new Date('2025-01-01T00:00:00.000Z'),
        }),
        snapshotId: 'failure-snapshot-1',
      })
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
          inputTransactionIds: [1],
          validatedTransferLinkIds: [],
          internalTransferCarryoverSourceTransactionIds: [],
          inputEvents: [
            {
              kind: 'acquisition',
              provenanceKind: 'movement',
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
        kind: 'standard-workflow',
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

    handler = new PortfolioHandler({
      costBasisStore: mockCostBasisStore,
      failureSnapshotStore: mockFailureSnapshotStore,
      priceRuntime: mockPriceRuntime,
      profileId: 7,
      readAssetReviewSummaries: mockReadAssetReviewSummaries,
      readDependencyWatermark: mockReadDependencyWatermark,
    });
  });

  it('routes CA portfolio calculations through the Canada path instead of the standard workflow', async () => {
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
        method: 'fifo',
        jurisdiction: 'US',
        currency: 'USD',
        taxYear: 2025,
        startDate: new Date(0),
        endDate: new Date('2025-01-01T00:00:00.000Z'),
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
    expect(loadCostBasisContext).not.toHaveBeenCalled();
    expect(runCanadaCostBasisCalculation).not.toHaveBeenCalled();
    expect(mockCostBasisWorkflowExecute).not.toHaveBeenCalled();
  });

  it('persists a failure snapshot when standard portfolio cost basis fails', async () => {
    mockCostBasisWorkflowExecute.mockResolvedValue(err(new Error('standard workflow failed')));

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
        scopeKey: buildCostBasisScopeKey(7, {
          method: 'average-cost',
          jurisdiction: 'CA',
          taxYear: 2025,
          currency: 'USD',
          startDate: new Date(0),
          endDate: new Date('2025-01-01T00:00:00.000Z'),
        }),
      })
    );
  });

  it('returns a combined error when portfolio failure snapshot persistence fails', async () => {
    mockCostBasisWorkflowExecute.mockResolvedValue(err(new Error('standard workflow failed')));
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
        'Portfolio cost basis failed: standard workflow failed. Additionally, failure snapshot persistence failed: failure snapshot write failed'
      );
    }
  });

  it('omits transactions touching excluded assets from portfolio balances, cost basis, and returned transactions', async () => {
    const excludedTradeTx = createExcludedAssetTradeTransaction();
    loadCostBasisContext.mockResolvedValue(
      ok({
        confirmedLinks: [],
        transactions: [tx, excludedTradeTx],
        accounts: [{ id: 1, platformKey: 'kraken', accountType: 'exchange-api' as const }],
      })
    );

    mockCostBasisWorkflowExecute.mockResolvedValue(
      ok({
        kind: 'standard-workflow',
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

    handler = new PortfolioHandler({
      accountingExclusionPolicy: { excludedAssetIds: new Set(['blockchain:base:0xspam']) },
      costBasisStore: mockCostBasisStore,
      failureSnapshotStore: mockFailureSnapshotStore,
      priceRuntime: mockPriceRuntime,
      profileId: 7,
      readAssetReviewSummaries: mockReadAssetReviewSummaries,
      readDependencyWatermark: mockReadDependencyWatermark,
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
