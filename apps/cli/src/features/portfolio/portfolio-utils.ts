/**
 * Portfolio utility functions (pure).
 */

import type { AcquisitionLot } from '@exitbook/accounting';
import { Currency, type UniversalTransactionData } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import type { PriceProviderManager, PriceQuery } from '@exitbook/price-providers';
import { Decimal } from 'decimal.js';

import type {
  AccountBreakdownItem,
  OpenLotItem,
  PortfolioPositionItem,
  PortfolioTransactionItem,
  SortMode,
  SpotPriceResult,
} from './portfolio-types.js';

const logger = getLogger('portfolio-utils');
const USD_CURRENCY = Currency.create('USD');

interface AccountMetadata {
  accountType: AccountBreakdownItem['accountType'];
  sourceName: string;
}

// ─── Price Fetching ─────────────────────────────────────────────────────────

/**
 * Fetch spot prices for multiple assets using Promise.allSettled.
 * Returns a map of assetId -> SpotPriceResult (price or error).
 */
export async function fetchSpotPrices(
  assetSymbols: Map<string, Currency>, // assetId -> Currency object
  priceManager: PriceProviderManager,
  asOf: Date
): Promise<Map<string, SpotPriceResult>> {
  const results = new Map<string, SpotPriceResult>();

  // Build queries (always fetch in USD first)
  const usdCurrency = Currency.create('USD');
  const queries: { assetId: string; query: PriceQuery }[] = [];

  for (const [assetId, assetSymbol] of assetSymbols.entries()) {
    queries.push({
      assetId,
      query: {
        assetSymbol,
        timestamp: asOf,
        currency: usdCurrency,
      },
    });
  }

  // Fetch all prices with Promise.allSettled
  const settled = await Promise.allSettled(queries.map(({ query }) => priceManager.fetchPrice(query)));

  for (let i = 0; i < settled.length; i++) {
    const { assetId } = queries[i]!;
    const result = settled[i]!;

    if (result.status === 'fulfilled') {
      if (result.value.isOk()) {
        results.set(assetId, { price: result.value.value.data.price });
      } else {
        const error = result.value.error.message;
        logger.warn({ assetId, error }, 'Failed to fetch spot price');
        results.set(assetId, { error });
      }
      continue;
    }

    const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
    logger.warn({ assetId, error }, 'Price fetch promise rejected');
    results.set(assetId, { error });
  }

  return results;
}

// ─── Portfolio Building ─────────────────────────────────────────────────────

/**
 * Build portfolio positions from holdings, spot prices, and open lots.
 * Handles partial price failures, negative balances, and missing open lots.
 */
export function buildPortfolioPositions(
  holdings: Record<string, Decimal>, // assetId -> balance
  assetMetadata: Record<string, string>, // assetId -> assetSymbol
  spotPrices: Map<string, SpotPriceResult>,
  openLotsByAssetId: Map<string, AcquisitionLot[]>,
  accountBreakdown: Map<string, AccountBreakdownItem[]>,
  fxRate: Decimal | undefined, // USD -> display currency (undefined if USD)
  asOf: Date,
  realizedGainLossByAssetIdUsd?: Map<string, Decimal>
): { positions: PortfolioPositionItem[]; warnings: string[] } {
  const positions: PortfolioPositionItem[] = [];
  const warnings: string[] = [];

  let unpricedCount = 0;

  for (const [assetId, balance] of Object.entries(holdings)) {
    if (balance.isZero()) {
      continue;
    }

    const quantityString = balance.toFixed(8);
    if (new Decimal(quantityString).isZero()) {
      continue;
    }

    const assetSymbol = assetMetadata[assetId] ?? assetId;
    const isNegative = balance.isNegative();
    const priceResult = spotPrices.get(assetId);
    const openLots = openLotsByAssetId.get(assetId) ?? [];
    const accounts = accountBreakdown.get(assetId) ?? [];

    let priceStatus: 'ok' | 'unavailable' = 'unavailable';
    let spotPricePerUnit: string | undefined;
    let currentValue: string | undefined;
    let allocationPct: string | undefined;
    let priceError: string | undefined;
    let usdSpotPrice: Decimal | undefined;

    if (priceResult && 'price' in priceResult) {
      priceStatus = 'ok';
      usdSpotPrice = priceResult.price;
      const displaySpotPrice = fxRate ? usdSpotPrice.times(fxRate) : usdSpotPrice;
      spotPricePerUnit = displaySpotPrice.toFixed(2);
      currentValue = displaySpotPrice.times(balance.abs()).toFixed(2);
    } else {
      unpricedCount++;
      if (priceResult && 'error' in priceResult) {
        priceError = priceResult.error;
      }
    }

    let totalCostBasis: string | undefined;
    let avgCostPerUnit: string | undefined;
    let unrealizedGainLoss: string | undefined;
    let unrealizedPct: string | undefined;
    const openLotItems: OpenLotItem[] = [];

    if (openLots.length > 0 && usdSpotPrice) {
      const weightedCostUsd = computeWeightedAvgCost(openLots);
      const totalCostUsd = openLots.reduce(
        (sum, lot) => sum.plus(lot.costBasisPerUnit.times(lot.remainingQuantity)),
        new Decimal(0)
      );
      const unrealizedUsd = computeUnrealizedPnL(openLots, usdSpotPrice);

      const displayWeightedCost = fxRate ? weightedCostUsd.times(fxRate) : weightedCostUsd;
      const displayTotalCost = fxRate ? totalCostUsd.times(fxRate) : totalCostUsd;
      const displayUnrealized = fxRate ? unrealizedUsd.times(fxRate) : unrealizedUsd;

      avgCostPerUnit = displayWeightedCost.toFixed(2);
      totalCostBasis = displayTotalCost.toFixed(2);
      unrealizedGainLoss = displayUnrealized.toFixed(2);

      if (displayTotalCost.gt(0)) {
        unrealizedPct = displayUnrealized.div(displayTotalCost).times(100).toFixed(1);
      }

      for (const lot of openLots) {
        const holdingDays = Math.floor((asOf.getTime() - lot.acquisitionDate.getTime()) / (1000 * 60 * 60 * 24));
        const displayCostPerUnit = fxRate
          ? lot.costBasisPerUnit.times(fxRate).toFixed(2)
          : lot.costBasisPerUnit.toFixed(2);

        openLotItems.push({
          lotId: lot.id,
          quantity: lot.quantity.toFixed(8),
          remainingQuantity: lot.remainingQuantity.toFixed(8),
          costBasisPerUnit: displayCostPerUnit,
          acquisitionDate: lot.acquisitionDate.toISOString(),
          holdingDays,
        });
      }
    }

    const realizedUsd = realizedGainLossByAssetIdUsd?.get(assetId) ?? new Decimal(0);
    const realizedDisplay = fxRate ? realizedUsd.times(fxRate) : realizedUsd;
    const realizedGainLossAllTime = realizedDisplay.toFixed(2);

    positions.push({
      assetId,
      assetSymbol,
      quantity: quantityString,
      isNegative,
      spotPricePerUnit,
      currentValue,
      allocationPct,
      priceStatus,
      priceError,
      totalCostBasis,
      avgCostPerUnit,
      unrealizedGainLoss,
      unrealizedPct,
      realizedGainLossAllTime,
      openLots: openLotItems,
      accountBreakdown: accounts,
    });
  }

  // Allocation percentages for priced, non-negative assets only.
  const pricedPositions = positions.filter(
    (p): p is PortfolioPositionItem & { currentValue: string } =>
      p.priceStatus === 'ok' && !p.isNegative && p.currentValue !== undefined
  );
  const totalValue = pricedPositions.reduce((sum, p) => sum.plus(new Decimal(p.currentValue)), new Decimal(0));

  if (totalValue.gt(0)) {
    for (const position of pricedPositions) {
      position.allocationPct = new Decimal(position.currentValue).div(totalValue).times(100).toFixed(1);
    }
  }

  if (unpricedCount > 0) {
    warnings.push(
      `${unpricedCount} asset${unpricedCount > 1 ? 's' : ''} could not be priced — values may be incomplete`
    );
  }

  return { positions, warnings };
}

/**
 * Aggregate portfolio positions by asset symbol for display.
 *
 * We keep underlying assetIds in `sourceAssetIds` so drill-down/history can still
 * include movements from all merged assets.
 */
export function aggregatePositionsByAssetSymbol(positions: PortfolioPositionItem[]): PortfolioPositionItem[] {
  const groups = new Map<string, PortfolioPositionItem[]>();

  for (const position of positions) {
    const key = position.assetSymbol.trim().toUpperCase();
    const existing = groups.get(key);
    if (existing) {
      existing.push(position);
    } else {
      groups.set(key, [position]);
    }
  }

  const aggregated: PortfolioPositionItem[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      const single = group[0]!;
      aggregated.push({
        ...single,
        sourceAssetIds: [single.assetId],
      });
      continue;
    }

    const sourceAssetIds = Array.from(new Set(group.map((position) => position.assetId)));
    const assetSymbol = group[0]!.assetSymbol;

    const netQuantity = group.reduce((sum, position) => sum.plus(position.quantity), new Decimal(0));
    const netQuantityString = netQuantity.toFixed(8);
    const absoluteNetQuantity = netQuantity.abs();
    const isNegative = netQuantity.isNegative();

    const pricedRows = group.filter(
      (position): position is PortfolioPositionItem & { currentValue: string; spotPricePerUnit: string } =>
        position.priceStatus === 'ok' && position.currentValue !== undefined && position.spotPricePerUnit !== undefined
    );

    const pricedByQuantity = pricedRows.reduce((sum, position) => {
      const quantity = new Decimal(position.quantity).abs();
      return sum.plus(quantity);
    }, new Decimal(0));

    let priceStatus: 'ok' | 'unavailable' = 'unavailable';
    let spotPricePerUnit: string | undefined;
    let currentValue: string | undefined;
    let priceError: string | undefined;

    if (pricedRows.length > 0) {
      priceStatus = 'ok';

      const weightedSpot = pricedRows.reduce((sum, position) => {
        const qty = new Decimal(position.quantity).abs();
        const spot = new Decimal(position.spotPricePerUnit);
        return sum.plus(spot.times(qty));
      }, new Decimal(0));

      const spot = pricedByQuantity.gt(0)
        ? weightedSpot.div(pricedByQuantity)
        : new Decimal(pricedRows[0]!.spotPricePerUnit);
      spotPricePerUnit = spot.toFixed(2);
      currentValue = spot.times(absoluteNetQuantity).toFixed(2);
    } else {
      const uniqueErrors = Array.from(
        new Set(
          group
            .map((position) => position.priceError)
            .filter((error): error is string => error !== undefined && error.length > 0)
        )
      );
      if (uniqueErrors.length > 0) {
        priceError = uniqueErrors.join('; ');
      }
    }

    const rowsWithCost = group.filter(
      (
        position
      ): position is PortfolioPositionItem & {
        totalCostBasis: string;
        unrealizedGainLoss: string;
      } => position.totalCostBasis !== undefined && position.unrealizedGainLoss !== undefined
    );

    let totalCostBasis: string | undefined;
    let unrealizedGainLoss: string | undefined;
    let avgCostPerUnit: string | undefined;
    let unrealizedPct: string | undefined;

    if (rowsWithCost.length > 0) {
      const totalCost = rowsWithCost.reduce((sum, position) => sum.plus(position.totalCostBasis), new Decimal(0));
      const totalUnrealized = rowsWithCost.reduce(
        (sum, position) => sum.plus(position.unrealizedGainLoss),
        new Decimal(0)
      );
      const totalCostQuantityFromBalance = rowsWithCost.reduce(
        (sum, position) => sum.plus(new Decimal(position.quantity).abs()),
        new Decimal(0)
      );
      const totalCostQuantityFromCostBasis = rowsWithCost.reduce((sum, position) => {
        if (position.avgCostPerUnit === undefined) {
          return sum;
        }

        const rowAvgCost = new Decimal(position.avgCostPerUnit);
        if (rowAvgCost.lte(0)) {
          return sum;
        }

        return sum.plus(new Decimal(position.totalCostBasis).div(rowAvgCost));
      }, new Decimal(0));

      totalCostBasis = totalCost.toFixed(2);
      unrealizedGainLoss = totalUnrealized.toFixed(2);

      // Derive cost-backed quantity from each row's cost basis and avg cost when available.
      // This prevents inflated per-unit averages when net display quantity is near-zero.
      if (totalCostQuantityFromCostBasis.gt(0)) {
        avgCostPerUnit = totalCost.div(totalCostQuantityFromCostBasis).toFixed(2);
      } else if (totalCostQuantityFromBalance.gt(0)) {
        avgCostPerUnit = totalCost.div(totalCostQuantityFromBalance).toFixed(2);
      } else if (absoluteNetQuantity.gt(0)) {
        avgCostPerUnit = totalCost.div(absoluteNetQuantity).toFixed(2);
      }
      if (totalCost.gt(0)) {
        unrealizedPct = totalUnrealized.div(totalCost).times(100).toFixed(1);
      }
    }

    const totalRealized = group.reduce(
      (sum, position) => sum.plus(position.realizedGainLossAllTime ?? '0'),
      new Decimal(0)
    );
    const realizedGainLossAllTime = totalRealized.toFixed(2);

    const accountMap = new Map<string, AccountBreakdownItem>();
    for (const position of group) {
      for (const account of position.accountBreakdown) {
        const key = `${account.accountId}:${account.sourceName}:${account.accountType}`;
        const existing = accountMap.get(key);
        if (existing) {
          const mergedQty = new Decimal(existing.quantity).plus(account.quantity);
          existing.quantity = mergedQty.toFixed(8);
        } else {
          accountMap.set(key, { ...account });
        }
      }
    }

    const openLots = group.flatMap((position) => position.openLots);

    aggregated.push({
      assetId: sourceAssetIds[0]!,
      sourceAssetIds,
      assetSymbol,
      quantity: netQuantityString,
      isNegative,
      spotPricePerUnit,
      currentValue,
      allocationPct: undefined,
      priceStatus,
      priceError,
      totalCostBasis,
      avgCostPerUnit,
      unrealizedGainLoss,
      unrealizedPct,
      realizedGainLossAllTime,
      openLots,
      accountBreakdown: Array.from(accountMap.values()),
    });
  }

  applyAllocationPercentages(aggregated);
  return aggregated;
}

/**
 * Compute total realized gain/loss across all disposal activity.
 *
 * This includes assets that may no longer have an open position, so callers can
 * present a true all-time realized total.
 */
export function computeTotalRealizedGainLossAllTime(
  realizedGainLossByAssetIdUsd: Map<string, Decimal>,
  fxRate: Decimal | undefined,
  hasVisiblePositions: boolean
): string | undefined {
  if (!hasVisiblePositions && realizedGainLossByAssetIdUsd.size === 0) {
    return undefined;
  }

  const totalRealizedUsd = Array.from(realizedGainLossByAssetIdUsd.values()).reduce(
    (sum, realized) => sum.plus(realized),
    new Decimal(0)
  );
  const totalRealizedDisplay = fxRate ? totalRealizedUsd.times(fxRate) : totalRealizedUsd;
  return totalRealizedDisplay.toFixed(2);
}

/**
 * Compute unrealized P&L from open lots and current USD spot price.
 * Returns sum of (spotPrice - lot.costBasisPerUnit) * lot.remainingQuantity.
 */
export function computeUnrealizedPnL(openLots: AcquisitionLot[], spotPrice: Decimal): Decimal {
  return openLots.reduce((sum, lot) => {
    const pnlPerUnit = spotPrice.minus(lot.costBasisPerUnit);
    return sum.plus(pnlPerUnit.times(lot.remainingQuantity));
  }, new Decimal(0));
}

/**
 * Compute weighted average cost per unit from open lots.
 */
export function computeWeightedAvgCost(openLots: AcquisitionLot[]): Decimal {
  const totalQuantity = openLots.reduce((sum, lot) => sum.plus(lot.remainingQuantity), new Decimal(0));
  if (totalQuantity.isZero()) {
    return new Decimal(0);
  }

  const weightedSum = openLots.reduce(
    (sum, lot) => sum.plus(lot.costBasisPerUnit.times(lot.remainingQuantity)),
    new Decimal(0)
  );

  return weightedSum.div(totalQuantity);
}

// ─── Account Breakdown ──────────────────────────────────────────────────────

/**
 * Build per-account asset balances from transactions.
 * Groups transactions by accountId and calculates balances per account for each asset.
 */
export function buildAccountAssetBalances(
  transactions: UniversalTransactionData[],
  accountMetadataById: Map<number, AccountMetadata>
): Map<string, AccountBreakdownItem[]> {
  const accountTransactions = new Map<number, UniversalTransactionData[]>();

  for (const tx of transactions) {
    const existing = accountTransactions.get(tx.accountId);
    if (existing) {
      existing.push(tx);
    } else {
      accountTransactions.set(tx.accountId, [tx]);
    }
  }

  const accountBalances = new Map<number, Record<string, Decimal>>();
  for (const [accountId, txs] of accountTransactions.entries()) {
    const balances: Record<string, Decimal> = {};

    for (const tx of txs) {
      for (const inflow of tx.movements.inflows ?? []) {
        balances[inflow.assetId] = (balances[inflow.assetId] ?? new Decimal(0)).plus(inflow.grossAmount);
      }

      for (const outflow of tx.movements.outflows ?? []) {
        balances[outflow.assetId] = (balances[outflow.assetId] ?? new Decimal(0)).minus(outflow.grossAmount);
      }

      for (const fee of tx.fees ?? []) {
        if (fee.settlement === 'on-chain') {
          continue;
        }
        balances[fee.assetId] = (balances[fee.assetId] ?? new Decimal(0)).minus(fee.amount);
      }
    }

    accountBalances.set(accountId, balances);
  }

  const breakdown = new Map<string, AccountBreakdownItem[]>();

  for (const [accountId, balances] of accountBalances.entries()) {
    const fallbackTx = accountTransactions.get(accountId)?.[0];
    const metadata = accountMetadataById.get(accountId) ?? {
      sourceName: fallbackTx?.source ?? `account-${accountId}`,
      accountType: deriveAccountTypeFromSourceType(fallbackTx?.sourceType),
    };

    if (!accountMetadataById.has(accountId)) {
      logger.warn(
        { accountId, sourceName: metadata.sourceName },
        'Account metadata missing for account breakdown; using transaction fallback'
      );
    }

    for (const [assetId, balance] of Object.entries(balances)) {
      if (balance.isZero()) {
        continue;
      }

      const existing = breakdown.get(assetId);
      const item: AccountBreakdownItem = {
        accountId,
        sourceName: metadata.sourceName,
        accountType: metadata.accountType,
        quantity: balance.toFixed(8),
      };

      if (existing) {
        existing.push(item);
      } else {
        breakdown.set(assetId, [item]);
      }
    }
  }

  return breakdown;
}

function deriveAccountTypeFromSourceType(
  sourceType: UniversalTransactionData['sourceType'] | undefined
): AccountMetadata['accountType'] {
  if (sourceType === 'blockchain') {
    return 'blockchain';
  }
  return 'exchange-api';
}

// ─── Sorting ────────────────────────────────────────────────────────────────

/**
 * Sort positions by the specified mode with tier ordering.
 * Tier 1: Priced assets (sorted by mode)
 * Tier 2: Unpriced assets (sorted by quantity descending)
 * Tier 3: Negative balance assets (sorted by absolute quantity descending)
 */
export function sortPositions(positions: PortfolioPositionItem[], mode: SortMode): PortfolioPositionItem[] {
  const sorted = [...positions];

  sorted.sort((a, b) => {
    const aTier = getTier(a);
    const bTier = getTier(b);
    if (aTier !== bTier) {
      return aTier - bTier;
    }

    if (aTier === 1) {
      return comparePricedAssets(a, b, mode);
    }

    const aQty = new Decimal(a.quantity).abs();
    const bQty = new Decimal(b.quantity).abs();
    if (!aQty.eq(bQty)) {
      return bQty.cmp(aQty);
    }
    return a.assetSymbol.localeCompare(b.assetSymbol);
  });

  return sorted;
}

function getTier(position: PortfolioPositionItem): number {
  if (position.isNegative) return 3;
  if (position.priceStatus === 'unavailable') return 2;
  return 1;
}

function comparePricedAssets(a: PortfolioPositionItem, b: PortfolioPositionItem, mode: SortMode): number {
  switch (mode) {
    case 'value': {
      const aValue = decimalOrZero(a.currentValue);
      const bValue = decimalOrZero(b.currentValue);
      if (!aValue.eq(bValue)) {
        return bValue.cmp(aValue);
      }
      return a.assetSymbol.localeCompare(b.assetSymbol);
    }
    case 'gain': {
      return compareOptionalDecimal(a.unrealizedGainLoss, b.unrealizedGainLoss, 'desc', a.assetSymbol, b.assetSymbol);
    }
    case 'loss': {
      return compareOptionalDecimal(a.unrealizedGainLoss, b.unrealizedGainLoss, 'asc', a.assetSymbol, b.assetSymbol);
    }
    case 'allocation': {
      return compareOptionalDecimal(a.allocationPct, b.allocationPct, 'desc', a.assetSymbol, b.assetSymbol);
    }
  }
}

function compareOptionalDecimal(
  a: string | undefined,
  b: string | undefined,
  direction: 'asc' | 'desc',
  aSymbol: string,
  bSymbol: string
): number {
  const aMissing = a === undefined;
  const bMissing = b === undefined;

  if (aMissing && bMissing) {
    return aSymbol.localeCompare(bSymbol);
  }
  if (aMissing) {
    return 1;
  }
  if (bMissing) {
    return -1;
  }

  const aDecimal = new Decimal(a);
  const bDecimal = new Decimal(b);
  if (aDecimal.eq(bDecimal)) {
    return aSymbol.localeCompare(bSymbol);
  }

  return direction === 'desc' ? bDecimal.cmp(aDecimal) : aDecimal.cmp(bDecimal);
}

function decimalOrZero(value: string | undefined): Decimal {
  return value === undefined ? new Decimal(0) : new Decimal(value);
}

function applyAllocationPercentages(positions: PortfolioPositionItem[]): void {
  const pricedPositions = positions.filter(
    (p): p is PortfolioPositionItem & { currentValue: string } =>
      p.priceStatus === 'ok' && !p.isNegative && p.currentValue !== undefined
  );
  const totalValue = pricedPositions.reduce((sum, p) => sum.plus(new Decimal(p.currentValue)), new Decimal(0));

  if (totalValue.gt(0)) {
    for (const position of pricedPositions) {
      position.allocationPct = new Decimal(position.currentValue).div(totalValue).times(100).toFixed(1);
    }
  }
}

// ─── Transaction History ────────────────────────────────────────────────────

/**
 * Filter transactions to include only those where any of the specified assets appear.
 */
export function filterTransactionsForAssets(
  transactions: UniversalTransactionData[],
  assetIds: string[]
): UniversalTransactionData[] {
  const assetIdSet = new Set(assetIds);
  return transactions.filter((tx) => {
    const inInflows = (tx.movements.inflows ?? []).some((m) => assetIdSet.has(m.assetId));
    const inOutflows = (tx.movements.outflows ?? []).some((m) => assetIdSet.has(m.assetId));
    const inFees = (tx.fees ?? []).some((m) => assetIdSet.has(m.assetId));
    return inInflows || inOutflows || inFees;
  });
}

/**
 * Filter transactions to include only those where the specified asset appears.
 */
export function filterTransactionsForAsset(
  transactions: UniversalTransactionData[],
  assetId: string
): UniversalTransactionData[] {
  return filterTransactionsForAssets(transactions, [assetId]);
}

/**
 * Build a map of normalized asset symbol -> unique assetIds seen in transactions.
 *
 * Used by portfolio drill-down so aggregated symbol views can include historical
 * transactions from assetIds that may no longer have non-zero balances.
 */
export function buildAssetIdsBySymbol(transactions: UniversalTransactionData[]): Map<string, string[]> {
  const assetIdsBySymbol = new Map<string, Set<string>>();

  const addMovement = (assetId: string, assetSymbol: string): void => {
    const normalizedSymbol = assetSymbol.trim().toUpperCase();
    if (normalizedSymbol.length === 0) {
      return;
    }
    const existing = assetIdsBySymbol.get(normalizedSymbol);
    if (existing) {
      existing.add(assetId);
    } else {
      assetIdsBySymbol.set(normalizedSymbol, new Set([assetId]));
    }
  };

  for (const tx of transactions) {
    for (const inflow of tx.movements.inflows ?? []) {
      addMovement(inflow.assetId, inflow.assetSymbol);
    }
    for (const outflow of tx.movements.outflows ?? []) {
      addMovement(outflow.assetId, outflow.assetSymbol);
    }
    for (const fee of tx.fees ?? []) {
      addMovement(fee.assetId, fee.assetSymbol);
    }
  }

  return new Map(Array.from(assetIdsBySymbol.entries()).map(([symbol, assetIds]) => [symbol, Array.from(assetIds)]));
}

export interface NetFiatInComputation {
  netFiatInUsd: Decimal;
  skippedNonUsdMovementsWithoutPrice: number;
}

/**
 * Compute net external fiat funding in USD using transfer transactions only.
 *
 * Net fiat in = fiat inflows - fiat outflows - fiat fees.
 */
export function computeNetFiatInUsd(transactions: UniversalTransactionData[]): NetFiatInComputation {
  let netFiatInUsd = new Decimal(0);
  let skippedNonUsdMovementsWithoutPrice = 0;

  for (const tx of transactions) {
    if (tx.operation.category !== 'transfer') {
      continue;
    }

    for (const inflow of tx.movements.inflows ?? []) {
      if (!isFiatSymbol(inflow.assetSymbol)) {
        continue;
      }
      const usdAmount = toUsdAmount(inflow.assetSymbol, inflow.grossAmount, inflow.priceAtTxTime?.price.amount);
      if (usdAmount === undefined) {
        skippedNonUsdMovementsWithoutPrice++;
        continue;
      }
      netFiatInUsd = netFiatInUsd.plus(usdAmount);
    }

    for (const outflow of tx.movements.outflows ?? []) {
      if (!isFiatSymbol(outflow.assetSymbol)) {
        continue;
      }
      const usdAmount = toUsdAmount(outflow.assetSymbol, outflow.grossAmount, outflow.priceAtTxTime?.price.amount);
      if (usdAmount === undefined) {
        skippedNonUsdMovementsWithoutPrice++;
        continue;
      }
      netFiatInUsd = netFiatInUsd.minus(usdAmount);
    }

    for (const fee of tx.fees ?? []) {
      if (!isFiatSymbol(fee.assetSymbol)) {
        continue;
      }
      const usdAmount = toUsdAmount(fee.assetSymbol, fee.amount, fee.priceAtTxTime?.price.amount);
      if (usdAmount === undefined) {
        skippedNonUsdMovementsWithoutPrice++;
        continue;
      }
      netFiatInUsd = netFiatInUsd.minus(usdAmount);
    }
  }

  return { netFiatInUsd, skippedNonUsdMovementsWithoutPrice };
}

function toUsdAmount(assetSymbol: string, amount: Decimal, priceAmountUsd: Decimal | undefined): Decimal | undefined {
  if (priceAmountUsd !== undefined) {
    return amount.times(priceAmountUsd);
  }

  const currency = tryCreateCurrency(assetSymbol);
  if (currency && currency.equals(USD_CURRENCY)) {
    return amount;
  }

  return undefined;
}

function isFiatSymbol(assetSymbol: string): boolean {
  return tryCreateCurrency(assetSymbol)?.isFiat() ?? false;
}

function tryCreateCurrency(assetSymbol: string): Currency | undefined {
  try {
    return Currency.create(assetSymbol);
  } catch {
    return undefined;
  }
}

/**
 * Build transaction items for the Level 2 history view.
 * Extracts net movement of the specified asset from each transaction.
 */
export function buildTransactionItems(
  transactions: UniversalTransactionData[],
  assetIds: string | string[]
): PortfolioTransactionItem[] {
  const items: PortfolioTransactionItem[] = [];
  const assetIdSet = new Set(Array.isArray(assetIds) ? assetIds : [assetIds]);

  for (const tx of transactions) {
    let netAmount = new Decimal(0);

    for (const inflow of tx.movements.inflows ?? []) {
      if (assetIdSet.has(inflow.assetId)) {
        netAmount = netAmount.plus(inflow.grossAmount);
      }
    }

    for (const outflow of tx.movements.outflows ?? []) {
      if (assetIdSet.has(outflow.assetId)) {
        netAmount = netAmount.minus(outflow.grossAmount);
      }
    }

    for (const fee of tx.fees ?? []) {
      if (assetIdSet.has(fee.assetId)) {
        netAmount = netAmount.minus(fee.amount);
      }
    }

    const assetDirection: 'in' | 'out' = netAmount.gte(0) ? 'in' : 'out';
    const inflows = (tx.movements.inflows ?? []).map((inflow) => ({
      amount: inflow.grossAmount.toFixed(8),
      assetSymbol: inflow.assetSymbol,
    }));
    const outflows = (tx.movements.outflows ?? []).map((outflow) => ({
      amount: outflow.grossAmount.toFixed(8),
      assetSymbol: outflow.assetSymbol,
    }));
    const fees = (tx.fees ?? []).map((fee) => ({
      amount: fee.amount.toFixed(8),
      assetSymbol: fee.assetSymbol,
    }));

    const fiatValue = computeTransactionFiatValue(tx, assetIdSet, netAmount.abs());
    const { transferDirection, transferPeer } = extractTransferContext(tx, assetDirection);

    items.push({
      id: tx.id,
      datetime: tx.datetime,
      operationCategory: tx.operation.category,
      operationType: tx.operation.type,
      sourceName: tx.source,
      assetAmount: netAmount.abs().toFixed(8),
      assetDirection,
      ...(fiatValue !== undefined && { fiatValue }),
      ...(transferPeer !== undefined && { transferPeer }),
      ...(transferDirection !== undefined && { transferDirection }),
      inflows,
      outflows,
      fees,
    });
  }

  items.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());

  return items;
}

function computeTransactionFiatValue(
  tx: UniversalTransactionData,
  assetIdSet: Set<string>,
  absoluteNetAmount: Decimal
): string | undefined {
  if (absoluteNetAmount.isZero()) {
    return undefined;
  }

  let weightedPriceSum = new Decimal(0);
  let pricedQuantity = new Decimal(0);

  for (const inflow of tx.movements.inflows ?? []) {
    if (!assetIdSet.has(inflow.assetId) || inflow.priceAtTxTime === undefined) {
      continue;
    }
    weightedPriceSum = weightedPriceSum.plus(inflow.priceAtTxTime.price.amount.times(inflow.grossAmount.abs()));
    pricedQuantity = pricedQuantity.plus(inflow.grossAmount.abs());
  }

  for (const outflow of tx.movements.outflows ?? []) {
    if (!assetIdSet.has(outflow.assetId) || outflow.priceAtTxTime === undefined) {
      continue;
    }
    weightedPriceSum = weightedPriceSum.plus(outflow.priceAtTxTime.price.amount.times(outflow.grossAmount.abs()));
    pricedQuantity = pricedQuantity.plus(outflow.grossAmount.abs());
  }

  for (const fee of tx.fees ?? []) {
    if (!assetIdSet.has(fee.assetId) || fee.priceAtTxTime === undefined) {
      continue;
    }
    weightedPriceSum = weightedPriceSum.plus(fee.priceAtTxTime.price.amount.times(fee.amount.abs()));
    pricedQuantity = pricedQuantity.plus(fee.amount.abs());
  }

  if (pricedQuantity.isZero()) {
    return undefined;
  }

  const weightedUnitPrice = weightedPriceSum.div(pricedQuantity);
  return weightedUnitPrice.times(absoluteNetAmount).toFixed(2);
}

function extractTransferContext(
  tx: UniversalTransactionData,
  assetDirection: 'in' | 'out'
): { transferDirection?: 'to' | 'from' | undefined; transferPeer?: string | undefined } {
  if (tx.operation.category !== 'transfer') {
    return {};
  }

  if (assetDirection === 'out') {
    return {
      transferDirection: 'to',
      transferPeer: tx.to,
    };
  }

  return {
    transferDirection: 'from',
    transferPeer: tx.from,
  };
}
