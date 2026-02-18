/**
 * Portfolio Handler - Orchestrates portfolio calculation business logic.
 * Reusable by both CLI command and other contexts.
 */

import path from 'node:path';

import {
  CostBasisCalculator,
  type FiatCurrency as AccountingFiatCurrency,
  type TransactionLinkRepository,
} from '@exitbook/accounting';
import { Currency, type UniversalTransactionData } from '@exitbook/core';
import type { AccountQueries, TransactionQueries } from '@exitbook/data';
import { calculateBalances } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { createPriceProviderManager } from '@exitbook/price-providers';
import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import { ensureLinks, ensurePrices } from '../cost-basis/cost-basis-prereqs.js';
import type { CostBasisHandlerParams } from '../cost-basis/cost-basis-utils.js';
import {
  getJurisdictionRules,
  validateCostBasisParams,
  validateTransactionPrices,
} from '../cost-basis/cost-basis-utils.js';
import type { CommandContext } from '../shared/command-runtime.js';

import type { PortfolioPositionItem, SpotPriceResult } from './portfolio-types.js';
import {
  aggregatePositionsByAssetSymbol,
  buildAccountAssetBalances,
  buildPortfolioPositions,
  computeNetFiatInUsd,
  computeTotalRealizedGainLossAllTime,
  fetchSpotPrices,
  sortPositions,
} from './portfolio-utils.js';

const logger = getLogger('PortfolioHandler');

type PortfolioDisplayCurrency = 'USD' | 'CAD' | 'EUR' | 'GBP';
type PortfolioJurisdiction = 'CA' | 'US';
type PortfolioMethod = 'fifo' | 'lifo' | 'average-cost';

/**
 * Portfolio handler parameters
 */
export interface PortfolioHandlerParams {
  method: string;
  jurisdiction: string;
  displayCurrency: string;
  asOf: Date;
  dataDir: string;
  ctx: CommandContext;
  isJsonMode: boolean;
}

/**
 * Result of portfolio calculation
 */
export interface PortfolioResult {
  positions: PortfolioPositionItem[];
  closedPositions: PortfolioPositionItem[];
  transactions: UniversalTransactionData[];
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
  displayCurrency: string;
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
  constructor(
    private accountRepository: AccountQueries,
    private transactionRepository: TransactionQueries,
    private transactionLinkRepository: TransactionLinkRepository
  ) {}

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

      const startDate = new Date(0);
      const endDate = asOf;

      const linksResult = await ensureLinks(
        this.transactionRepository,
        this.transactionLinkRepository,
        params.dataDir,
        params.ctx,
        params.isJsonMode
      );
      if (linksResult.isErr()) {
        return err(linksResult.error);
      }

      const pricesResult = await ensurePrices(
        this.transactionRepository,
        this.transactionLinkRepository,
        startDate,
        endDate,
        'USD',
        params.ctx,
        params.isJsonMode
      );
      if (pricesResult.isErr()) {
        return err(pricesResult.error);
      }

      const txResult = await this.transactionRepository.getTransactions();
      if (txResult.isErr()) {
        return err(txResult.error);
      }

      const allTransactions = txResult.value;
      if (allTransactions.length === 0) {
        return ok({
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
        });
      }

      const transactionsUpToAsOf = allTransactions.filter((tx) => new Date(tx.timestamp) <= asOf);
      if (transactionsUpToAsOf.length === 0) {
        return ok({
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
        });
      }

      const fiatFlowComputation = computeNetFiatInUsd(transactionsUpToAsOf);
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

      const { balances, assetMetadata } = calculateBalances(transactionsUpToAsOf);

      const holdings: Record<string, Decimal> = {};
      for (const [assetId, balance] of Object.entries(balances)) {
        if (!balance.isZero()) {
          holdings[assetId] = balance;
        }
      }

      const priceManagerResult = await createPriceProviderManager({
        providers: {
          databasePath: path.join(params.dataDir, 'prices.db'),
        },
      });
      if (priceManagerResult.isErr()) {
        return err(new Error(`Failed to create price provider manager: ${priceManagerResult.error.message}`));
      }

      const priceManager = priceManagerResult.value;
      params.ctx.onCleanup(async () => priceManager.destroy());

      const invalidSymbolPrices = new Map<string, SpotPriceResult>();
      const symbolsToPrice = new Map<string, Currency>();
      for (const assetId of Object.keys(holdings)) {
        const symbol = assetMetadata[assetId] ?? assetId;
        try {
          symbolsToPrice.set(assetId, Currency.create(symbol));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn({ assetId, symbol, message }, 'Invalid asset symbol; skipping spot price fetch');
          invalidSymbolPrices.set(assetId, { error: message });
        }
      }

      const fetchedSpotPrices = await fetchSpotPrices(symbolsToPrice, priceManager, asOf);
      const spotPrices = new Map<string, SpotPriceResult>([...invalidSymbolPrices, ...fetchedSpotPrices]);

      const warnings: string[] = [...fiatFlowWarnings];
      let fxRate: Decimal | undefined;
      if (displayCurrency !== 'USD') {
        const fxResult = await priceManager.fetchPrice({
          assetSymbol: Currency.create(displayCurrency),
          timestamp: asOf,
          currency: Currency.create('USD'),
        });

        if (fxResult.isErr()) {
          warnings.push(
            `FX rate for ${displayCurrency} unavailable at ${asOf.toISOString()} — showing USD values instead`
          );
          logger.warn({ displayCurrency, error: fxResult.error.message }, 'Failed to fetch FX rate, using USD');
        } else {
          fxRate = new Decimal(1).div(fxResult.value.data.price);
          logger.debug({ displayCurrency, fxRate: fxRate.toFixed(6) }, 'FX rate fetched');
        }
      }
      const totalNetFiatIn = (
        fxRate ? fiatFlowComputation.netFiatInUsd.times(fxRate) : fiatFlowComputation.netFiatInUsd
      ).toFixed(2);

      const costBasisParams: CostBasisHandlerParams = {
        config: {
          method,
          jurisdiction,
          currency: 'USD' as AccountingFiatCurrency,
          taxYear: asOf.getUTCFullYear(),
          startDate,
          endDate,
        },
      };

      const costBasisValidation = validateCostBasisParams(costBasisParams);
      if (costBasisValidation.isErr()) {
        return err(costBasisValidation.error);
      }

      const priceValidationResult = validateTransactionPrices(transactionsUpToAsOf, 'USD');
      if (priceValidationResult.isErr()) {
        return err(priceValidationResult.error);
      }
      const { validTransactions, missingPricesCount } = priceValidationResult.value;

      if (missingPricesCount > 0) {
        const validTransactionIds = new Set(validTransactions.map((tx) => tx.id));
        const excludedForMissingPrices = transactionsUpToAsOf.filter((tx) => !validTransactionIds.has(tx.id));
        const spamOrExcludedCount = excludedForMissingPrices.filter((tx) => isSpamOrExcludedTransaction(tx)).length;

        const warning =
          spamOrExcludedCount > 0
            ? `${missingPricesCount} transactions missing prices were excluded from cost basis (including ${spamOrExcludedCount} spam/excluded transactions) — unrealized P&L may be incomplete`
            : `${missingPricesCount} transactions missing prices were excluded from cost basis — unrealized P&L may be incomplete`;

        warnings.push(warning);

        logger.warn(
          {
            missingPricesCount,
            spamOrExcludedCount,
            excludedTransactionIds: excludedForMissingPrices.slice(0, 10).map((tx) => tx.id),
          },
          'Excluding transactions with missing prices from portfolio cost basis calculation'
        );
      }

      const calculator = new CostBasisCalculator(this.transactionRepository, this.transactionLinkRepository);
      const rules = getJurisdictionRules(costBasisParams.config.jurisdiction);
      const calcResult = await calculator.calculate(validTransactions, costBasisParams.config, rules);
      if (calcResult.isErr()) {
        return err(calcResult.error);
      }

      const openLotsByAssetId = new Map<string, typeof calcResult.value.lots>();
      for (const lot of calcResult.value.lots) {
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

      const lotAssetByLotId = new Map<string, string>(calcResult.value.lots.map((lot) => [lot.id, lot.assetId]));
      const realizedGainLossByAssetIdUsd = new Map<string, Decimal>();
      for (const disposal of calcResult.value.disposals) {
        const assetId = lotAssetByLotId.get(disposal.lotId);
        if (!assetId) {
          logger.warn({ disposalId: disposal.id, lotId: disposal.lotId }, 'Disposal references missing lot');
          continue;
        }
        const existing = realizedGainLossByAssetIdUsd.get(assetId) ?? new Decimal(0);
        realizedGainLossByAssetIdUsd.set(assetId, existing.plus(disposal.gainLoss));
      }

      const accountsResult = await this.accountRepository.findAll();
      if (accountsResult.isErr()) {
        return err(accountsResult.error);
      }
      const accountMetadataById = new Map(
        accountsResult.value.map((account) => [
          account.id,
          { sourceName: account.sourceName, accountType: account.accountType },
        ])
      );

      const accountBreakdown = buildAccountAssetBalances(transactionsUpToAsOf, accountMetadataById);
      const built = buildPortfolioPositions(
        holdings,
        assetMetadata,
        spotPrices,
        openLotsByAssetId,
        accountBreakdown,
        fxRate,
        asOf,
        realizedGainLossByAssetIdUsd
      );
      warnings.push(...built.warnings);

      const closedPositionsByAssetId = buildClosedPositionsByAssetId(
        Object.keys(holdings),
        assetMetadata,
        realizedGainLossByAssetIdUsd,
        fxRate
      );
      const aggregatedPositions = aggregatePositionsByAssetSymbol([...built.positions, ...closedPositionsByAssetId]);
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
        realizedGainLossByAssetIdUsd,
        fxRate,
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
        transactions: transactionsUpToAsOf,
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
        displayCurrency,
        meta: {
          totalAssets: positions.length,
          pricedAssets,
          unpricedAssets,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function buildClosedPositionsByAssetId(
  holdingAssetIds: string[],
  assetMetadata: Record<string, string>,
  realizedGainLossByAssetIdUsd: Map<string, Decimal>,
  fxRate: Decimal | undefined
): PortfolioPositionItem[] {
  const holdingAssetSet = new Set(holdingAssetIds);
  const closedPositions: PortfolioPositionItem[] = [];

  for (const [assetId, realizedUsd] of realizedGainLossByAssetIdUsd.entries()) {
    if (holdingAssetSet.has(assetId)) {
      continue;
    }

    const realizedDisplay = fxRate ? realizedUsd.times(fxRate) : realizedUsd;
    closedPositions.push({
      assetId,
      sourceAssetIds: [assetId],
      assetSymbol: assetMetadata[assetId] ?? assetId,
      quantity: '0.00000000',
      isNegative: false,
      isClosedPosition: true,
      priceStatus: 'unavailable',
      realizedGainLossAllTime: realizedDisplay.toFixed(2),
      openLots: [],
      accountBreakdown: [],
    });
  }

  return closedPositions;
}

function validatePortfolioParams(params: PortfolioHandlerParams): Result<
  {
    asOf: Date;
    displayCurrency: PortfolioDisplayCurrency;
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
  const displayCurrency = params.displayCurrency as PortfolioDisplayCurrency;

  return ok({
    method,
    jurisdiction,
    displayCurrency,
    asOf: params.asOf,
  });
}

function isSpamOrExcludedTransaction(transaction: UniversalTransactionData): boolean {
  if (transaction.excludedFromAccounting === true || transaction.isSpam === true) {
    return true;
  }

  return transaction.notes?.some((note) => note.type === 'SCAM_TOKEN') ?? false;
}
