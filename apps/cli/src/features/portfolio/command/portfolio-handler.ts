/**
 * Portfolio Handler - Orchestrates portfolio calculation business logic.
 * Tier 2: Factory owns cleanup; command file never calls ctx.onCleanup().
 */
import {
  CostBasisWorkflow,
  type AccountingExclusionPolicy,
  type IHistoricalAssetPriceSource,
  persistCostBasisFailureSnapshot,
  runCanadaCostBasisCalculation,
  StandardFxRateProvider,
  type CostBasisDependencyWatermark,
  validateCostBasisInput,
  type ValidatedCostBasisConfig,
  type ICostBasisContextReader,
  type FiatCurrency as AccountingFiatCurrency,
} from '@exitbook/accounting';
import { parseCurrency, type AssetReviewSummary, type Currency, type Transaction } from '@exitbook/core';
import { err, ok, wrapError, type Result } from '@exitbook/core';
import { buildCostBasisFailureSnapshotStore, buildCostBasisPorts } from '@exitbook/data';
import { type DataContext } from '@exitbook/data';
import { calculateBalances } from '@exitbook/ingestion';
import type { AdapterRegistry } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';

import { loadAccountingExclusionPolicy } from '../../shared/accounting-exclusion-policy.js';
import { ensureAssetReviewProjectionFresh } from '../../shared/asset-review-projection-runtime.js';
import { readAssetReviewProjectionSummaries } from '../../shared/asset-review-projection-store.js';
import { openCliPriceProviderRuntime } from '../../shared/cli-price-provider-runtime.js';
import { adaptResultCleanup, type CommandContext } from '../../shared/command-runtime.js';
import { readCostBasisDependencyWatermark } from '../../shared/cost-basis-dependency-watermark-runtime.js';
import { ensureConsumerInputsReady } from '../../shared/projection-runtime.js';
import type { AccountBreakdownItem, PortfolioPositionItem, SpotPriceResult } from '../shared/portfolio-types.js';

import {
  aggregatePositionsByAssetSymbol,
  buildAccountAssetBalances,
  buildCanadaPortfolioPositions,
  buildClosedPositionsByAssetId,
  buildPortfolioPositions,
  convertSpotPricesToDisplayCurrency,
  computeNetFiatInUsd,
  computeTotalRealizedGainLossAllTime,
  fetchSpotPrices,
  sortPositions,
  type RealizedGainLossDisplayContext,
} from './portfolio-utils.js';

const logger = getLogger('PortfolioHandler');

type PortfolioDisplayCurrency = 'USD' | 'CAD' | 'EUR' | 'GBP';
type PortfolioJurisdiction = 'CA' | 'US';
type PortfolioMethod = 'fifo' | 'lifo' | 'average-cost';

/**
 * Portfolio handler parameters (no ctx/dataDir/isJsonMode leaks)
 */
interface PortfolioHandlerParams {
  method: string;
  jurisdiction: string;
  displayCurrency: string;
  asOf: Date;
}

/**
 * Result of portfolio calculation
 */
interface PortfolioResult {
  positions: PortfolioPositionItem[];
  closedPositions: PortfolioPositionItem[];
  transactions: Transaction[];
  totalValue?: string | undefined;
  totalCost?: string | undefined;
  totalUnrealizedGainLoss?: string | undefined;
  totalUnrealizedPct?: string | undefined;
  totalRealizedGainLossAllTime?: string | undefined;
  totalNetFiatIn?: string | undefined;
  warnings: string[];
  asOf: string;
  method: string;
  jurisdiction: string;
  displayCurrency: Currency;
  meta: {
    pricedAssets: number;
    timestamp: string;
    totalAssets: number;
    unpricedAssets: number;
  };
}

/**
 * Portfolio Handler - Encapsulates all portfolio calculation business logic.
 */
export class PortfolioHandler {
  fxRateProvider: StandardFxRateProvider;
  constructor(
    private readonly db: DataContext,
    private readonly historicalAssetPriceSource: IHistoricalAssetPriceSource,
    private readonly dataDir: string,
    private readonly accountingExclusionPolicy: AccountingExclusionPolicy = { excludedAssetIds: new Set<string>() }
  ) {
    this.fxRateProvider = new StandardFxRateProvider(this.historicalAssetPriceSource);
  }

  /**
   * Execute the portfolio calculation.
   */
  async execute(params: PortfolioHandlerParams): Promise<Result<PortfolioResult, Error>> {
    try {
      const validated = validatePortfolioParams(params);
      if (validated.isErr()) {
        return err(validated.error);
      }
      const { method, jurisdiction, displayCurrency, asOf } = validated.value;

      logger.debug(
        { method, jurisdiction, displayCurrency, asOf: asOf.toISOString() },
        'Starting portfolio calculation'
      );

      const txResult = await this.db.transactions.findAll();
      if (txResult.isErr()) {
        return err(txResult.error);
      }

      const allTransactions = txResult.value;
      const freshProjectionResult = await ensureAssetReviewProjectionFresh(this.db, this.dataDir);
      if (freshProjectionResult.isErr()) {
        return err(freshProjectionResult.error);
      }

      const assetReviewSummariesResult = await readAssetReviewProjectionSummaries(this.db);
      if (assetReviewSummariesResult.isErr()) {
        return err(assetReviewSummariesResult.error);
      }
      const assetReviewSummaries = assetReviewSummariesResult.value;

      if (allTransactions.length === 0) {
        return ok(emptyPortfolioResult(asOf, method, jurisdiction, displayCurrency));
      }

      const transactionsUpToAsOf = allTransactions.filter((tx) => new Date(tx.timestamp) <= asOf);
      if (transactionsUpToAsOf.length === 0) {
        return ok(emptyPortfolioResult(asOf, method, jurisdiction, displayCurrency));
      }

      const portfolioTransactions = filterTransactionsTouchingExcludedAssets(
        transactionsUpToAsOf,
        this.accountingExclusionPolicy
      );
      if (portfolioTransactions.length === 0) {
        return ok(emptyPortfolioResult(asOf, method, jurisdiction, displayCurrency));
      }

      const fiatFlowComputation = computeNetFiatInUsd(portfolioTransactions);
      const fiatFlowWarnings: string[] = [];
      if (fiatFlowComputation.skippedNonUsdMovementsWithoutPrice > 0) {
        fiatFlowWarnings.push(
          `${fiatFlowComputation.skippedNonUsdMovementsWithoutPrice} non-USD fiat movement(s) missing USD conversion were excluded from Net Fiat In`
        );
        logger.warn(
          { skippedCount: fiatFlowComputation.skippedNonUsdMovementsWithoutPrice },
          'Excluded non-USD fiat movements without USD conversion from Net Fiat In'
        );
      }

      const { balances, assetMetadata } = calculateBalances(portfolioTransactions);

      const holdings: Record<string, Decimal> = {};
      for (const [assetId, balance] of Object.entries(balances)) {
        if (!balance.isZero()) {
          holdings[assetId] = balance;
        }
      }

      const invalidSymbolPrices = new Map<string, SpotPriceResult>();
      const symbolsToPrice = new Map<string, Currency>();
      for (const assetId of Object.keys(holdings)) {
        const symbol = assetMetadata[assetId] ?? assetId;
        const currResult = parseCurrency(symbol);
        if (currResult.isOk()) {
          symbolsToPrice.set(assetId, currResult.value);
        } else {
          const message = currResult.error.message;
          logger.warn({ assetId, symbol, message }, 'Invalid asset symbol; skipping spot price fetch');
          invalidSymbolPrices.set(assetId, { error: message });
        }
      }

      const fetchedSpotPrices = await fetchSpotPrices(symbolsToPrice, this.historicalAssetPriceSource, asOf);
      const spotPrices = new Map<string, SpotPriceResult>([...invalidSymbolPrices, ...fetchedSpotPrices]);

      const warnings: string[] = [...fiatFlowWarnings];
      let fxRate: Decimal | undefined;
      let effectiveDisplayCurrency = displayCurrency;
      if (displayCurrency !== 'USD') {
        const fxResult = await this.historicalAssetPriceSource.fetchPrice({
          assetSymbol: displayCurrency,
          timestamp: asOf,
          currency: 'USD' as Currency,
        });

        if (fxResult.isErr()) {
          warnings.push(
            `FX rate for ${displayCurrency} unavailable at ${asOf.toISOString()} — showing USD values instead`
          );
          logger.warn({ displayCurrency, error: fxResult.error.message }, 'Failed to fetch FX rate, using USD');
          effectiveDisplayCurrency = 'USD' as Currency;
        } else {
          fxRate = new Decimal(1).div(fxResult.value.price);
          logger.debug({ displayCurrency, fxRate: fxRate.toFixed(6) }, 'FX rate fetched');
        }
      }
      const totalNetFiatIn = (
        fxRate ? fiatFlowComputation.netFiatInUsd.times(fxRate) : fiatFlowComputation.netFiatInUsd
      ).toFixed(2);
      const displaySpotPrices = convertSpotPricesToDisplayCurrency(
        spotPrices,
        effectiveDisplayCurrency === 'USD' ? undefined : fxRate
      );

      const startDate = new Date(0);
      const endDate = asOf;

      const costBasisParams: ValidatedCostBasisConfig = {
        method,
        jurisdiction,
        currency: effectiveDisplayCurrency as AccountingFiatCurrency,
        taxYear: asOf.getUTCFullYear(),
        startDate,
        endDate,
      };

      const costBasisValidation = validateCostBasisInput(costBasisParams);
      if (costBasisValidation.isErr()) {
        return err(costBasisValidation.error);
      }

      const dependencyWatermarkResult = await readCostBasisDependencyWatermark(
        this.db,
        this.dataDir,
        this.accountingExclusionPolicy
      );
      if (dependencyWatermarkResult.isErr()) {
        return err(dependencyWatermarkResult.error);
      }
      const failureSnapshotStore = buildCostBasisFailureSnapshotStore(this.db);

      const costBasisStore: ICostBasisContextReader = buildCostBasisPorts(this.db);
      const accountsResult = await this.db.accounts.findAll();
      if (accountsResult.isErr()) {
        return err(accountsResult.error);
      }
      const accountMetadataById = new Map(
        accountsResult.value.map((account) => [
          account.id,
          { sourceName: account.sourceName, accountType: account.accountType },
        ])
      );

      const accountBreakdown = buildAccountAssetBalances(portfolioTransactions, accountMetadataById);
      let positions: PortfolioPositionItem[];
      let closedPositions: PortfolioPositionItem[];
      let realizedGainLossByAssetId = new Map<string, Decimal>();
      let realizedGainLossDisplayContext: RealizedGainLossDisplayContext = {
        sourceCurrency: 'USD',
      };

      if (jurisdiction === 'CA') {
        const canadaPortfolioResult = await this.buildCanadaPortfolioCostBasis({
          accountBreakdown,
          assetReviewSummaries,
          asOf,
          assetMetadata,
          costBasisStore,
          costBasisParams,
          holdings,
          spotPrices: displaySpotPrices,
          transactionsUpToAsOf: portfolioTransactions,
        });
        if (canadaPortfolioResult.isErr()) {
          return this.persistCostBasisFailure(
            failureSnapshotStore,
            costBasisParams,
            dependencyWatermarkResult.value,
            canadaPortfolioResult.error,
            'portfolio.canada-cost-basis'
          );
        }

        warnings.push(...canadaPortfolioResult.value.warnings);
        positions = canadaPortfolioResult.value.positions;
        closedPositions = canadaPortfolioResult.value.closedPositions;
        realizedGainLossByAssetId = canadaPortfolioResult.value.realizedGainLossByPortfolioKey;
        realizedGainLossDisplayContext = { sourceCurrency: 'display' };
      } else {
        const workflow = new CostBasisWorkflow(costBasisStore, this.fxRateProvider);
        const workflowResult = await workflow.execute(costBasisParams, portfolioTransactions, {
          accountingExclusionPolicy: this.accountingExclusionPolicy,
          assetReviewSummaries,
          // Portfolio is a best-effort holdings view, not a tax filing surface.
          // Keeping the price-complete subset lets us still show open lots and
          // spot-valued positions, while warning that unrealized P&L is
          // incomplete until the excluded transactions are enriched with
          // prices.
          missingPricePolicy: 'exclude',
        });
        if (workflowResult.isErr()) {
          return this.persistCostBasisFailure(
            failureSnapshotStore,
            costBasisParams,
            dependencyWatermarkResult.value,
            workflowResult.error,
            'portfolio.standard-cost-basis'
          );
        }

        if (workflowResult.value.kind !== 'standard-workflow') {
          return err(
            new Error(
              `Expected standard-workflow result for non-CA portfolio flow, received ${workflowResult.value.kind}`
            )
          );
        }

        const { summary: costBasisSummary, executionMeta } = workflowResult.value;
        const missingPriceWarning = this.buildMissingPriceWarning(
          portfolioTransactions,
          executionMeta.retainedTransactionIds,
          executionMeta.missingPricesCount
        );
        if (missingPriceWarning) {
          warnings.push(missingPriceWarning);
        }

        const openLotsByAssetId = new Map<string, typeof costBasisSummary.lots>();
        for (const lot of costBasisSummary.lots) {
          if (lot.remainingQuantity.lte(0)) {
            continue;
          }
          const existing = openLotsByAssetId.get(lot.assetId);
          if (existing) {
            existing.push(lot);
          } else {
            openLotsByAssetId.set(lot.assetId, [lot]);
          }
        }

        realizedGainLossDisplayContext = {
          sourceCurrency: 'USD',
          ...(effectiveDisplayCurrency !== 'USD' && fxRate ? { usdToDisplayFxRate: fxRate } : {}),
        };
        const lotAssetByLotId = new Map<string, string>(costBasisSummary.lots.map((lot) => [lot.id, lot.assetId]));
        realizedGainLossByAssetId = new Map<string, Decimal>();
        for (const disposal of costBasisSummary.disposals) {
          const assetId = lotAssetByLotId.get(disposal.lotId);
          if (!assetId) {
            logger.warn({ disposalId: disposal.id, lotId: disposal.lotId }, 'Disposal references missing lot');
            continue;
          }
          const existing = realizedGainLossByAssetId.get(assetId) ?? new Decimal(0);
          realizedGainLossByAssetId.set(assetId, existing.plus(disposal.gainLoss));
        }

        const built = buildPortfolioPositions({
          holdings,
          assetMetadata,
          spotPrices,
          openLotsByAssetId,
          accountBreakdown,
          fxRate: effectiveDisplayCurrency === 'USD' ? undefined : fxRate,
          asOf,
          realizedGainLossByAssetId,
          realizedGainLossDisplayContext,
        });
        warnings.push(...built.warnings);

        const closedPositionsByAssetId = buildClosedPositionsByAssetId(
          Object.keys(holdings),
          assetMetadata,
          realizedGainLossByAssetId,
          realizedGainLossDisplayContext
        );
        const aggregatedPositions = aggregatePositionsByAssetSymbol([...built.positions, ...closedPositionsByAssetId]);
        positions = sortPositions(
          aggregatedPositions.filter((position) => !new Decimal(position.quantity).isZero()),
          'value'
        );
        closedPositions = sortPositions(
          aggregatedPositions
            .filter((position) => new Decimal(position.quantity).isZero())
            .map((position) => ({
              ...position,
              isClosedPosition: true,
            })),
          'value'
        );
      }

      const pricedPositions = positions.filter(
        (position): position is PortfolioPositionItem & { currentValue: string } =>
          position.priceStatus === 'ok' && !position.isNegative && position.currentValue !== undefined
      );
      const pricedPositionsWithCostBasis = pricedPositions.filter(
        (
          position
        ): position is PortfolioPositionItem & {
          currentValue: string;
          totalCostBasis: string;
          unrealizedGainLoss: string;
        } => position.totalCostBasis !== undefined && position.unrealizedGainLoss !== undefined
      );

      const totalValueDecimal = pricedPositions.reduce(
        (sum, position) => sum.plus(new Decimal(position.currentValue)),
        new Decimal(0)
      );
      const totalCostDecimal = pricedPositionsWithCostBasis.reduce(
        (sum, position) => sum.plus(new Decimal(position.totalCostBasis)),
        new Decimal(0)
      );
      const totalUnrealizedDecimal = pricedPositionsWithCostBasis.reduce(
        (sum, position) => sum.plus(new Decimal(position.unrealizedGainLoss)),
        new Decimal(0)
      );

      const totalValue = pricedPositions.length > 0 ? totalValueDecimal.toFixed(2) : undefined;
      const totalCost = pricedPositionsWithCostBasis.length > 0 ? totalCostDecimal.toFixed(2) : undefined;
      const totalUnrealizedGainLoss =
        pricedPositionsWithCostBasis.length > 0 ? totalUnrealizedDecimal.toFixed(2) : undefined;
      const totalUnrealizedPct = totalCostDecimal.gt(0)
        ? totalUnrealizedDecimal.div(totalCostDecimal).times(100).toFixed(1)
        : undefined;
      const totalRealizedGainLossAllTime = computeTotalRealizedGainLossAllTime(
        realizedGainLossByAssetId,
        realizedGainLossDisplayContext,
        positions.length > 0
      );

      const unpricedAssets = positions.filter((position) => position.priceStatus === 'unavailable').length;
      const pricedAssets = positions.length - unpricedAssets;

      logger.info(
        {
          totalAssets: positions.length,
          pricedAssets,
          unpricedAssets,
          totalValue: totalValue ?? 'unavailable',
        },
        'Portfolio calculation completed'
      );

      return ok({
        positions,
        closedPositions,
        transactions: portfolioTransactions,
        totalValue,
        totalCost,
        totalUnrealizedGainLoss,
        totalUnrealizedPct,
        totalRealizedGainLossAllTime,
        totalNetFiatIn,
        warnings,
        asOf: asOf.toISOString(),
        method,
        jurisdiction,
        displayCurrency: effectiveDisplayCurrency,
        meta: {
          totalAssets: positions.length,
          pricedAssets,
          unpricedAssets,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      return wrapError(error, 'Failed to build portfolio');
    }
  }

  private buildMissingPriceWarning(
    transactionsUpToAsOf: Transaction[],
    retainedTransactionIds: number[],
    missingPricesCount: number
  ): string | undefined {
    if (missingPricesCount === 0) {
      return undefined;
    }

    const retainedTransactionIdSet = new Set(retainedTransactionIds);
    const excludedForMissingPrices = transactionsUpToAsOf.filter((tx) => !retainedTransactionIdSet.has(tx.id));
    const excludedCount = excludedForMissingPrices.filter((tx) => isExcludedTransaction(tx)).length;

    logger.warn(
      {
        missingPricesCount,
        excludedCount,
        excludedTransactionIds: excludedForMissingPrices.slice(0, 10).map((tx) => tx.id),
      },
      'Excluding transactions with missing prices from portfolio cost basis calculation'
    );

    return excludedCount > 0
      ? `${missingPricesCount} transactions missing prices were excluded from cost basis (including ${excludedCount} explicitly excluded transactions) — unrealized P&L may be incomplete`
      : `${missingPricesCount} transactions missing prices were excluded from cost basis — unrealized P&L may be incomplete`;
  }

  private async buildCanadaPortfolioCostBasis(params: {
    accountBreakdown: Map<string, AccountBreakdownItem[]>;
    asOf: Date;
    assetMetadata: Record<string, string>;
    assetReviewSummaries: ReadonlyMap<string, AssetReviewSummary>;
    costBasisParams: ValidatedCostBasisConfig;
    costBasisStore: ICostBasisContextReader;
    holdings: Record<string, Decimal>;
    spotPrices: Map<string, SpotPriceResult>;
    transactionsUpToAsOf: Transaction[];
  }): Promise<
    Result<
      {
        closedPositions: PortfolioPositionItem[];
        positions: PortfolioPositionItem[];
        realizedGainLossByPortfolioKey: Map<string, Decimal>;
        warnings: string[];
      },
      Error
    >
  > {
    const contextResult = await params.costBasisStore.loadCostBasisContext();
    if (contextResult.isErr()) {
      return err(contextResult.error);
    }

    const canadaCostBasisResult = await runCanadaCostBasisCalculation({
      input: params.costBasisParams,
      transactions: params.transactionsUpToAsOf,
      confirmedLinks: contextResult.value.confirmedLinks,
      fxRateProvider: this.fxRateProvider,
      accountingExclusionPolicy: this.accountingExclusionPolicy,
      assetReviewSummaries: params.assetReviewSummaries,
      missingPricePolicy: 'exclude',
      poolSnapshotStrategy: 'full-input-range',
    });
    if (canadaCostBasisResult.isErr()) {
      return err(canadaCostBasisResult.error);
    }

    if (!canadaCostBasisResult.value.inputContext) {
      return err(new Error('Canada portfolio cost basis result is missing input context'));
    }

    const warnings: string[] = [];
    const missingPriceWarning = this.buildMissingPriceWarning(
      params.transactionsUpToAsOf,
      canadaCostBasisResult.value.executionMeta.retainedTransactionIds,
      canadaCostBasisResult.value.executionMeta.missingPricesCount
    );
    if (missingPriceWarning) {
      warnings.push(missingPriceWarning);
    }

    const built = buildCanadaPortfolioPositions({
      accountBreakdown: params.accountBreakdown,
      asOf: params.asOf,
      assetMetadata: params.assetMetadata,
      displayReport: canadaCostBasisResult.value.displayReport,
      holdings: params.holdings,
      inputContext: canadaCostBasisResult.value.inputContext,
      spotPricesByAssetId: params.spotPrices,
      taxReport: canadaCostBasisResult.value.taxReport,
    });
    warnings.push(...built.warnings);

    const aggregatedPositions = aggregatePositionsByAssetSymbol([...built.positions, ...built.closedPositions]);
    const positions = sortPositions(
      aggregatedPositions.filter((position) => !new Decimal(position.quantity).isZero()),
      'value'
    );
    const closedPositions = sortPositions(
      aggregatedPositions
        .filter((position) => new Decimal(position.quantity).isZero())
        .map((position) => ({
          ...position,
          isClosedPosition: true,
        })),
      'value'
    );

    logger.info(
      {
        assetsProcessed: canadaCostBasisResult.value.calculation.assetsProcessed.length,
        effectiveDisplayCurrency: params.costBasisParams.currency,
        positions: positions.length,
      },
      'Canada portfolio cost basis calculation completed'
    );

    return ok({
      positions,
      closedPositions,
      realizedGainLossByPortfolioKey: built.realizedGainLossByPortfolioKey,
      warnings,
    });
  }

  private async persistCostBasisFailure(
    failureSnapshotStore: ReturnType<typeof buildCostBasisFailureSnapshotStore>,
    input: ValidatedCostBasisConfig,
    dependencyWatermark: CostBasisDependencyWatermark,
    error: Error,
    stage: string
  ): Promise<Result<PortfolioResult, Error>> {
    const persistResult = await persistCostBasisFailureSnapshot(failureSnapshotStore, {
      consumer: 'portfolio',
      input,
      dependencyWatermark,
      error,
      stage,
    });
    if (persistResult.isErr()) {
      return err(
        new Error(
          `Portfolio cost basis failed: ${error.message}. Additionally, failure snapshot persistence failed: ${persistResult.error.message}`,
          { cause: error }
        )
      );
    }

    return err(error);
  }
}

/**
 * Create a PortfolioHandler with appropriate infrastructure.
 * Factory runs prereqs and registers ctx.onCleanup() -- command files NEVER do.
 */
export async function createPortfolioHandler(
  ctx: CommandContext,
  database: DataContext,
  options: { asOf: Date; isJsonMode: boolean; registry: AdapterRegistry }
): Promise<Result<PortfolioHandler, Error>> {
  const dataDir = ctx.dataDir;
  const accountingExclusionPolicyResult = await loadAccountingExclusionPolicy(dataDir);
  if (accountingExclusionPolicyResult.isErr()) {
    return err(accountingExclusionPolicyResult.error);
  }

  let prereqAbort: (() => void) | undefined;
  if (!options.isJsonMode) {
    ctx.onAbort(() => {
      prereqAbort?.();
    });
  }

  const readyResult = await ensureConsumerInputsReady(
    'portfolio',
    {
      db: database,
      registry: options.registry,
      dataDir,
      isJsonMode: options.isJsonMode,
      setAbort: (abort) => {
        prereqAbort = abort;
      },
    },
    { startDate: new Date(0), endDate: options.asOf },
    accountingExclusionPolicyResult.value
  );
  if (readyResult.isErr()) {
    return err(readyResult.error);
  }

  // Open shared price runtime for spot prices + FX
  const priceRuntimeResult = await openCliPriceProviderRuntime({ dataDir });
  if (priceRuntimeResult.isErr()) {
    return err(new Error(`Failed to create price provider runtime: ${priceRuntimeResult.error.message}`));
  }

  const priceRuntime = priceRuntimeResult.value;
  ctx.onCleanup(adaptResultCleanup(priceRuntime.cleanup));

  prereqAbort = undefined;
  return ok(
    new PortfolioHandler(
      database,
      priceRuntime.historicalAssetPriceSource,
      dataDir,
      accountingExclusionPolicyResult.value
    )
  );
}

function emptyPortfolioResult(
  asOf: Date,
  method: string,
  jurisdiction: string,
  displayCurrency: Currency
): PortfolioResult {
  return {
    positions: [],
    closedPositions: [],
    transactions: [],
    warnings: [],
    asOf: asOf.toISOString(),
    method,
    jurisdiction,
    displayCurrency,
    meta: {
      totalAssets: 0,
      pricedAssets: 0,
      unpricedAssets: 0,
      timestamp: new Date().toISOString(),
    },
  };
}

function validatePortfolioParams(params: PortfolioHandlerParams): Result<
  {
    asOf: Date;
    displayCurrency: Currency;
    jurisdiction: PortfolioJurisdiction;
    method: PortfolioMethod;
  },
  Error
> {
  if (Number.isNaN(params.asOf.getTime())) {
    return err(new Error('Invalid --as-of value. Must be a valid ISO 8601 datetime.'));
  }

  const supportedMethods: PortfolioMethod[] = ['fifo', 'lifo', 'average-cost'];
  if (!supportedMethods.includes(params.method as PortfolioMethod)) {
    return err(new Error(`Invalid method '${params.method}'. Must be one of: ${supportedMethods.join(', ')}`));
  }
  const method = params.method as PortfolioMethod;

  const supportedJurisdictions: PortfolioJurisdiction[] = ['CA', 'US'];
  if (!supportedJurisdictions.includes(params.jurisdiction as PortfolioJurisdiction)) {
    return err(
      new Error(`Invalid jurisdiction '${params.jurisdiction}'. Must be one of: ${supportedJurisdictions.join(', ')}`)
    );
  }
  const jurisdiction = params.jurisdiction as PortfolioJurisdiction;

  if (jurisdiction === 'CA' && method !== 'average-cost') {
    return err(
      new Error(`Canada (CA) portfolio cost basis currently supports only average-cost (ACB). Received '${method}'.`)
    );
  }

  if (method === 'average-cost' && jurisdiction !== 'CA') {
    return err(new Error('Average Cost (ACB) is only supported for Canada (CA).'));
  }

  const supportedDisplayCurrencies: PortfolioDisplayCurrency[] = ['USD', 'CAD', 'EUR', 'GBP'];
  if (!supportedDisplayCurrencies.includes(params.displayCurrency as PortfolioDisplayCurrency)) {
    return err(
      new Error(
        `Invalid display currency '${params.displayCurrency}'. Must be one of: ${supportedDisplayCurrencies.join(', ')}`
      )
    );
  }
  const displayCurrencyResult = parseCurrency(params.displayCurrency);
  if (displayCurrencyResult.isErr()) {
    return err(displayCurrencyResult.error);
  }
  const displayCurrency = displayCurrencyResult.value;

  return ok({
    method,
    jurisdiction,
    displayCurrency,
    asOf: params.asOf,
  });
}

function isExcludedTransaction(transaction: Transaction): boolean {
  return transaction.excludedFromAccounting === true;
}

function filterTransactionsTouchingExcludedAssets(
  transactions: Transaction[],
  accountingExclusionPolicy: AccountingExclusionPolicy
): Transaction[] {
  if (accountingExclusionPolicy.excludedAssetIds.size === 0) {
    return transactions;
  }

  const retainedTransactions: Transaction[] = [];
  const excludedTransactionIds: number[] = [];

  for (const transaction of transactions) {
    if (transactionTouchesExcludedAsset(transaction, accountingExclusionPolicy)) {
      excludedTransactionIds.push(transaction.id);
      continue;
    }

    retainedTransactions.push(transaction);
  }

  if (excludedTransactionIds.length > 0) {
    logger.info(
      {
        excludedTransactionCount: excludedTransactionIds.length,
        sampleExcludedTransactionIds: excludedTransactionIds.slice(0, 10),
      },
      'Omitting portfolio transactions that touch excluded assets'
    );
  }

  return retainedTransactions;
}

function transactionTouchesExcludedAsset(
  transaction: Transaction,
  accountingExclusionPolicy: AccountingExclusionPolicy
): boolean {
  for (const inflow of transaction.movements.inflows ?? []) {
    if (accountingExclusionPolicy.excludedAssetIds.has(inflow.assetId)) {
      return true;
    }
  }

  for (const outflow of transaction.movements.outflows ?? []) {
    if (accountingExclusionPolicy.excludedAssetIds.has(outflow.assetId)) {
      return true;
    }
  }

  for (const fee of transaction.fees ?? []) {
    if (accountingExclusionPolicy.excludedAssetIds.has(fee.assetId)) {
      return true;
    }
  }

  return false;
}
