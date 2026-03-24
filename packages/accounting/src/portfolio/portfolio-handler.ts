import type { AssetReviewSummary, Transaction, TransactionLink } from '@exitbook/core';
import { parseCurrency, type Currency } from '@exitbook/foundation';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';
import { Decimal } from 'decimal.js';

import { persistCostBasisFailureSnapshot } from '../cost-basis/artifacts/failure-snapshot-service.js';
import { runCanadaCostBasisCalculation } from '../cost-basis/jurisdictions/canada/workflow/run-canada-cost-basis-calculation.js';
import type { FiatCurrency as AccountingFiatCurrency } from '../cost-basis/model/cost-basis-config.js';
import type { AccountingExclusionPolicy } from '../cost-basis/standard/validation/accounting-exclusion-policy.js';
/**
 * Portfolio calculation workflow and result shaping.
 */
import {
  validateCostBasisInput,
  validateMethodJurisdictionCombination,
  type ValidatedCostBasisConfig,
} from '../cost-basis/workflow/cost-basis-input.js';
import { CostBasisWorkflow } from '../cost-basis/workflow/cost-basis-workflow.js';
import type {
  CostBasisDependencyWatermark,
  ICostBasisContextReader,
  ICostBasisFailureSnapshotStore,
  IPortfolioDependencyReader,
  IPortfolioHoldingsCalculator,
} from '../ports/index.js';
import { UsdConversionRateProvider } from '../price-enrichment/fx/usd-conversion-rate-provider.js';

import {
  aggregatePositionsByAssetSymbol,
  buildAccountAssetBalances,
  buildCanadaPortfolioPositions,
  buildClosedPositionsByAssetId,
  buildPortfolioPositions,
  computeNetFiatInUsd,
  computeTotalRealizedGainLossAllTime,
  sortPositions,
  type RealizedGainLossDisplayContext,
} from './portfolio-position-building.js';
import { convertSpotPricesToDisplayCurrency, fetchSpotPrices } from './portfolio-pricing.js';
import type { AccountBreakdownItem, PortfolioPositionItem, SpotPriceResult } from './portfolio-types.js';

const logger = getLogger('PortfolioHandler');

type PortfolioDisplayCurrency = 'USD' | 'CAD' | 'EUR' | 'GBP';
type PortfolioJurisdiction = 'CA' | 'US';
type PortfolioMethod = 'fifo' | 'lifo' | 'average-cost';

/**
 * Portfolio handler parameters (no ctx/dataDir/isJsonMode leaks)
 */
export interface PortfolioHandlerParams {
  method: string;
  jurisdiction: string;
  displayCurrency: string;
  asOf: Date;
}

/**
 * Result of portfolio calculation
 */
export interface PortfolioResult {
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

export interface PortfolioHandlerDeps {
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  costBasisStore: ICostBasisContextReader;
  dependencyReader: IPortfolioDependencyReader;
  failureSnapshotStore: ICostBasisFailureSnapshotStore;
  holdingsCalculator: IPortfolioHoldingsCalculator;
  priceRuntime: IPriceProviderRuntime;
}

interface PortfolioAccountMetadata {
  accountType: AccountBreakdownItem['accountType'];
  sourceName: string;
}

interface ValidatedPortfolioParams {
  asOf: Date;
  displayCurrency: Currency;
  jurisdiction: PortfolioJurisdiction;
  method: PortfolioMethod;
}

interface PortfolioExecutionInputs extends ValidatedPortfolioParams {
  accountMetadataById: Map<number, PortfolioAccountMetadata>;
  assetReviewSummaries: ReadonlyMap<string, AssetReviewSummary>;
  confirmedLinks: TransactionLink[];
  dependencyWatermark: CostBasisDependencyWatermark;
  portfolioTransactions: Transaction[];
}

interface PortfolioValuationContext {
  accountBreakdown: Map<string, AccountBreakdownItem[]>;
  assetMetadata: Record<string, string>;
  costBasisParams: ValidatedCostBasisConfig;
  effectiveDisplayCurrency: Currency;
  fxRate?: Decimal | undefined;
  holdings: Record<string, Decimal>;
  spotPrices: Map<string, SpotPriceResult>;
  totalNetFiatIn: string;
  warnings: string[];
}

interface PortfolioPositionsBuildResult {
  closedPositions: PortfolioPositionItem[];
  positions: PortfolioPositionItem[];
  realizedGainLossByAssetId: Map<string, Decimal>;
  realizedGainLossDisplayContext: RealizedGainLossDisplayContext;
  warnings: string[];
}

/**
 * Portfolio Handler - Encapsulates all portfolio calculation business logic.
 */
export class PortfolioHandler {
  private readonly usdConversionRateProvider: UsdConversionRateProvider;
  private readonly accountingExclusionPolicy: AccountingExclusionPolicy;

  constructor(private readonly deps: PortfolioHandlerDeps) {
    this.usdConversionRateProvider = new UsdConversionRateProvider(deps.priceRuntime);
    this.accountingExclusionPolicy = deps.accountingExclusionPolicy ?? { excludedAssetIds: new Set<string>() };
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
      const executionInputsResult = await this.loadPortfolioExecutionInputs(validated.value);
      if (executionInputsResult.isErr()) {
        return err(executionInputsResult.error);
      }
      const executionInputs = executionInputsResult.value;

      if (executionInputs === undefined) {
        return ok(
          emptyPortfolioResult(
            validated.value.asOf,
            validated.value.method,
            validated.value.jurisdiction,
            validated.value.displayCurrency
          )
        );
      }

      const valuationContextResult = await this.buildPortfolioValuationContext(executionInputs);
      if (valuationContextResult.isErr()) {
        return err(valuationContextResult.error);
      }

      const positionsResult = await this.buildPortfolioPositionsForJurisdiction(
        executionInputs,
        valuationContextResult.value
      );
      if (positionsResult.isErr()) {
        return err(positionsResult.error);
      }

      return ok(this.buildPortfolioResult(executionInputs, valuationContextResult.value, positionsResult.value));
    } catch (error) {
      return wrapError(error, 'Failed to build portfolio');
    }
  }

  private async loadPortfolioExecutionInputs(
    params: ValidatedPortfolioParams
  ): Promise<Result<PortfolioExecutionInputs | undefined, Error>> {
    logger.debug(
      {
        method: params.method,
        jurisdiction: params.jurisdiction,
        displayCurrency: params.displayCurrency,
        asOf: params.asOf.toISOString(),
      },
      'Starting portfolio calculation'
    );

    const contextResult = await this.deps.costBasisStore.loadCostBasisContext();
    if (contextResult.isErr()) {
      return err(contextResult.error);
    }

    const allTransactions = contextResult.value.transactions;
    if (allTransactions.length === 0) {
      return ok(undefined);
    }

    const transactionsUpToAsOf = allTransactions.filter((tx) => new Date(tx.timestamp) <= params.asOf);
    if (transactionsUpToAsOf.length === 0) {
      return ok(undefined);
    }

    const portfolioTransactions = filterTransactionsTouchingExcludedAssets(
      transactionsUpToAsOf,
      this.accountingExclusionPolicy
    );
    if (portfolioTransactions.length === 0) {
      return ok(undefined);
    }

    const assetReviewSummariesResult = await this.deps.dependencyReader.readAssetReviewSummaries();
    if (assetReviewSummariesResult.isErr()) {
      return err(assetReviewSummariesResult.error);
    }

    const dependencyWatermarkResult = await this.deps.dependencyReader.readDependencyWatermark();
    if (dependencyWatermarkResult.isErr()) {
      return err(dependencyWatermarkResult.error);
    }

    const accountMetadataById = new Map<number, PortfolioAccountMetadata>(
      contextResult.value.accounts.map((account) => [
        account.id,
        { sourceName: account.sourceName, accountType: account.accountType },
      ])
    );

    return ok({
      ...params,
      accountMetadataById,
      assetReviewSummaries: assetReviewSummariesResult.value,
      confirmedLinks: contextResult.value.confirmedLinks,
      dependencyWatermark: dependencyWatermarkResult.value,
      portfolioTransactions,
    });
  }

  private async buildPortfolioValuationContext(
    inputs: PortfolioExecutionInputs
  ): Promise<Result<PortfolioValuationContext, Error>> {
    const fiatFlowComputation = computeNetFiatInUsd(inputs.portfolioTransactions);
    const warnings: string[] = [];
    if (fiatFlowComputation.skippedNonUsdMovementsWithoutPrice > 0) {
      warnings.push(
        `${fiatFlowComputation.skippedNonUsdMovementsWithoutPrice} non-USD fiat movement(s) missing USD conversion were excluded from Net Fiat In`
      );
      logger.warn(
        { skippedCount: fiatFlowComputation.skippedNonUsdMovementsWithoutPrice },
        'Excluded non-USD fiat movements without USD conversion from Net Fiat In'
      );
    }

    const { balances, assetMetadata } = this.deps.holdingsCalculator.calculateHoldings(inputs.portfolioTransactions);
    const holdings: Record<string, Decimal> = {};
    for (const [assetId, balance] of Object.entries(balances)) {
      if (!balance.isZero()) {
        holdings[assetId] = balance;
      }
    }

    const spotPrices = await this.fetchPortfolioSpotPrices(holdings, assetMetadata, inputs.asOf);
    const displayCurrencyContext = await this.resolveDisplayCurrencyContext(inputs.displayCurrency, inputs.asOf);
    warnings.push(...displayCurrencyContext.warnings);

    const totalNetFiatIn = (
      displayCurrencyContext.fxRate
        ? fiatFlowComputation.netFiatInUsd.times(displayCurrencyContext.fxRate)
        : fiatFlowComputation.netFiatInUsd
    ).toFixed(2);

    const costBasisParams: ValidatedCostBasisConfig = {
      method: inputs.method,
      jurisdiction: inputs.jurisdiction,
      currency: displayCurrencyContext.effectiveDisplayCurrency as AccountingFiatCurrency,
      taxYear: inputs.asOf.getUTCFullYear(),
      startDate: new Date(0),
      endDate: inputs.asOf,
    };

    const costBasisValidation = validateCostBasisInput(costBasisParams);
    if (costBasisValidation.isErr()) {
      return err(costBasisValidation.error);
    }

    return ok({
      accountBreakdown: buildAccountAssetBalances(inputs.portfolioTransactions, inputs.accountMetadataById),
      assetMetadata,
      costBasisParams,
      effectiveDisplayCurrency: displayCurrencyContext.effectiveDisplayCurrency,
      fxRate: displayCurrencyContext.fxRate,
      holdings,
      spotPrices: convertSpotPricesToDisplayCurrency(
        spotPrices,
        displayCurrencyContext.effectiveDisplayCurrency === 'USD' ? undefined : displayCurrencyContext.fxRate
      ),
      totalNetFiatIn,
      warnings,
    });
  }

  private async fetchPortfolioSpotPrices(
    holdings: Record<string, Decimal>,
    assetMetadata: Record<string, string>,
    asOf: Date
  ): Promise<Map<string, SpotPriceResult>> {
    const invalidSymbolPrices = new Map<string, SpotPriceResult>();
    const symbolsToPrice = new Map<string, Currency>();

    for (const assetId of Object.keys(holdings)) {
      const symbol = assetMetadata[assetId] ?? assetId;
      const currResult = parseCurrency(symbol);
      if (currResult.isOk()) {
        symbolsToPrice.set(assetId, currResult.value);
        continue;
      }

      const message = currResult.error.message;
      logger.warn({ assetId, symbol, message }, 'Invalid asset symbol; skipping spot price fetch');
      invalidSymbolPrices.set(assetId, { error: message });
    }

    const fetchedSpotPrices = await fetchSpotPrices(symbolsToPrice, this.deps.priceRuntime, asOf);
    return new Map<string, SpotPriceResult>([...invalidSymbolPrices, ...fetchedSpotPrices]);
  }

  private async resolveDisplayCurrencyContext(
    displayCurrency: Currency,
    asOf: Date
  ): Promise<{ effectiveDisplayCurrency: Currency; fxRate?: Decimal | undefined; warnings: string[] }> {
    if (displayCurrency === 'USD') {
      return { effectiveDisplayCurrency: displayCurrency, warnings: [] };
    }

    const fxResult = await this.usdConversionRateProvider.getRateFromUSD(displayCurrency, asOf);
    if (fxResult.isErr()) {
      logger.warn({ displayCurrency, error: fxResult.error.message }, 'Failed to fetch FX rate, using USD');
      return {
        effectiveDisplayCurrency: 'USD' as Currency,
        warnings: [`FX rate for ${displayCurrency} unavailable at ${asOf.toISOString()} - showing USD values instead`],
      };
    }

    logger.debug({ displayCurrency, fxRate: fxResult.value.rate.toFixed(6) }, 'FX rate fetched');
    return {
      effectiveDisplayCurrency: displayCurrency,
      fxRate: fxResult.value.rate,
      warnings: [],
    };
  }

  private async buildPortfolioPositionsForJurisdiction(
    inputs: PortfolioExecutionInputs,
    valuationContext: PortfolioValuationContext
  ): Promise<Result<PortfolioPositionsBuildResult, Error>> {
    if (inputs.jurisdiction === 'CA') {
      const canadaPortfolioResult = await this.buildCanadaPortfolioCostBasis({
        accountBreakdown: valuationContext.accountBreakdown,
        assetReviewSummaries: inputs.assetReviewSummaries,
        asOf: inputs.asOf,
        assetMetadata: valuationContext.assetMetadata,
        confirmedLinks: inputs.confirmedLinks,
        costBasisParams: valuationContext.costBasisParams,
        holdings: valuationContext.holdings,
        spotPrices: valuationContext.spotPrices,
        transactionsUpToAsOf: inputs.portfolioTransactions,
      });
      if (canadaPortfolioResult.isErr()) {
        const persistedResult = await this.persistCostBasisFailure(
          this.deps.failureSnapshotStore,
          valuationContext.costBasisParams,
          inputs.dependencyWatermark,
          canadaPortfolioResult.error,
          'portfolio.canada-cost-basis'
        );
        if (persistedResult.isErr()) {
          return err(persistedResult.error);
        }
        return err(canadaPortfolioResult.error);
      }

      return ok({
        closedPositions: canadaPortfolioResult.value.closedPositions,
        positions: canadaPortfolioResult.value.positions,
        realizedGainLossByAssetId: canadaPortfolioResult.value.realizedGainLossByPortfolioKey,
        realizedGainLossDisplayContext: { sourceCurrency: 'display' },
        warnings: canadaPortfolioResult.value.warnings,
      });
    }

    return this.buildStandardPortfolioCostBasis(inputs, valuationContext);
  }

  private async buildStandardPortfolioCostBasis(
    inputs: PortfolioExecutionInputs,
    valuationContext: PortfolioValuationContext
  ): Promise<Result<PortfolioPositionsBuildResult, Error>> {
    const workflow = new CostBasisWorkflow(this.deps.costBasisStore, this.deps.priceRuntime);
    const workflowResult = await workflow.execute(valuationContext.costBasisParams, inputs.portfolioTransactions, {
      accountingExclusionPolicy: this.accountingExclusionPolicy,
      assetReviewSummaries: inputs.assetReviewSummaries,
      // Portfolio is a best-effort holdings view, not a tax filing surface.
      // Keeping the price-complete subset lets us still show open lots and
      // spot-valued positions, while warning that unrealized P&L is
      // incomplete until the excluded transactions are enriched with
      // prices.
      missingPricePolicy: 'exclude',
    });
    if (workflowResult.isErr()) {
      const persistedResult = await this.persistCostBasisFailure(
        this.deps.failureSnapshotStore,
        valuationContext.costBasisParams,
        inputs.dependencyWatermark,
        workflowResult.error,
        'portfolio.standard-cost-basis'
      );
      if (persistedResult.isErr()) {
        return err(persistedResult.error);
      }
      return err(workflowResult.error);
    }

    if (workflowResult.value.kind !== 'standard-workflow') {
      return err(
        new Error(`Expected standard-workflow result for non-CA portfolio flow, received ${workflowResult.value.kind}`)
      );
    }

    const warnings: string[] = [];
    const { summary: costBasisSummary, executionMeta } = workflowResult.value;
    const missingPriceWarning = this.buildMissingPriceWarning(
      inputs.portfolioTransactions,
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

    const realizedGainLossDisplayContext: RealizedGainLossDisplayContext = {
      sourceCurrency: 'USD',
      ...(valuationContext.effectiveDisplayCurrency !== 'USD' && valuationContext.fxRate
        ? { usdToDisplayFxRate: valuationContext.fxRate }
        : {}),
    };
    const lotAssetByLotId = new Map<string, string>(costBasisSummary.lots.map((lot) => [lot.id, lot.assetId]));
    const realizedGainLossByAssetId = new Map<string, Decimal>();
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
      holdings: valuationContext.holdings,
      assetMetadata: valuationContext.assetMetadata,
      spotPrices: valuationContext.spotPrices,
      openLotsByAssetId,
      accountBreakdown: valuationContext.accountBreakdown,
      fxRate: valuationContext.effectiveDisplayCurrency === 'USD' ? undefined : valuationContext.fxRate,
      asOf: inputs.asOf,
      realizedGainLossByAssetId,
      realizedGainLossDisplayContext,
    });
    warnings.push(...built.warnings);

    const closedPositionsByAssetId = buildClosedPositionsByAssetId(
      Object.keys(valuationContext.holdings),
      valuationContext.assetMetadata,
      realizedGainLossByAssetId,
      realizedGainLossDisplayContext
    );
    const aggregatedPositions = aggregatePositionsByAssetSymbol([...built.positions, ...closedPositionsByAssetId]);

    return ok({
      positions: sortPositions(
        aggregatedPositions.filter((position) => !new Decimal(position.quantity).isZero()),
        'value'
      ),
      closedPositions: sortPositions(
        aggregatedPositions
          .filter((position) => new Decimal(position.quantity).isZero())
          .map((position) => ({
            ...position,
            isClosedPosition: true,
          })),
        'value'
      ),
      realizedGainLossByAssetId,
      realizedGainLossDisplayContext,
      warnings,
    });
  }

  private buildPortfolioResult(
    inputs: PortfolioExecutionInputs,
    valuationContext: PortfolioValuationContext,
    positionsResult: PortfolioPositionsBuildResult
  ): PortfolioResult {
    const pricedPositions = positionsResult.positions.filter(
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
      positionsResult.realizedGainLossByAssetId,
      positionsResult.realizedGainLossDisplayContext,
      positionsResult.positions.length > 0
    );

    const unpricedAssets = positionsResult.positions.filter(
      (position) => position.priceStatus === 'unavailable'
    ).length;
    const pricedAssets = positionsResult.positions.length - unpricedAssets;

    logger.info(
      {
        totalAssets: positionsResult.positions.length,
        pricedAssets,
        unpricedAssets,
        totalValue: totalValue ?? 'unavailable',
      },
      'Portfolio calculation completed'
    );

    return {
      positions: positionsResult.positions,
      closedPositions: positionsResult.closedPositions,
      transactions: inputs.portfolioTransactions,
      totalValue,
      totalCost,
      totalUnrealizedGainLoss,
      totalUnrealizedPct,
      totalRealizedGainLossAllTime,
      totalNetFiatIn: valuationContext.totalNetFiatIn,
      warnings: [...valuationContext.warnings, ...positionsResult.warnings],
      asOf: inputs.asOf.toISOString(),
      method: inputs.method,
      jurisdiction: inputs.jurisdiction,
      displayCurrency: valuationContext.effectiveDisplayCurrency,
      meta: {
        totalAssets: positionsResult.positions.length,
        pricedAssets,
        unpricedAssets,
        timestamp: new Date().toISOString(),
      },
    };
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
    confirmedLinks: TransactionLink[];
    costBasisParams: ValidatedCostBasisConfig;
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
    const canadaCostBasisResult = await runCanadaCostBasisCalculation({
      input: params.costBasisParams,
      transactions: params.transactionsUpToAsOf,
      confirmedLinks: params.confirmedLinks,
      priceRuntime: this.deps.priceRuntime,
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
    failureSnapshotStore: ICostBasisFailureSnapshotStore,
    input: ValidatedCostBasisConfig,
    dependencyWatermark: CostBasisDependencyWatermark,
    error: Error,
    stage: string
  ): Promise<Result<never, Error>> {
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

  const methodJurisdictionResult = validateMethodJurisdictionCombination(
    method as ValidatedCostBasisConfig['method'],
    jurisdiction as ValidatedCostBasisConfig['jurisdiction']
  );
  if (methodJurisdictionResult.isErr()) {
    return err(methodJurisdictionResult.error);
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
