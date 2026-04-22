/**
 * Portfolio position-building and aggregation helpers.
 */

import type { Transaction } from '@exitbook/core';
import { isFiat, parseCurrency, type Currency } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import {
  deriveOperationLabel,
  groupTransactionAnnotationsByTransactionId,
  hasTransactionTransferIntent,
  type TransactionAnnotation,
} from '@exitbook/transaction-interpretation';
import { Decimal } from 'decimal.js';

import type {
  AccountingModelBuildResult,
  AccountingTransactionView,
} from '../accounting-model/accounting-model-types.js';
import type {
  CanadaDisplayCostBasisReport,
  CanadaTaxInputContext,
  CanadaTaxReport,
} from '../cost-basis/jurisdictions/canada/tax/canada-tax-types.js';
import type { AcquisitionLot } from '../cost-basis/model/types.js';

import type {
  AccountBreakdownItem,
  OpenLotItem,
  PortfolioPositionItem,
  SortMode,
  SpotPriceResult,
} from './portfolio-types.js';

const logger = getLogger('portfolio-position-building');
const USD_CURRENCY = 'USD' as Currency;
interface AccountMetadata {
  accountType: AccountBreakdownItem['accountType'];
  platformKey: string;
}

function applyAccountingTransactionBalanceImpact(
  transactionView: AccountingTransactionView,
  applyDelta: (assetId: string, assetSymbol: string, quantityDelta: Decimal) => void
): void {
  for (const inflow of transactionView.inflows) {
    applyDelta(inflow.assetId, inflow.assetSymbol, inflow.grossQuantity);
  }

  for (const outflow of transactionView.outflows) {
    applyDelta(outflow.assetId, outflow.assetSymbol, outflow.grossQuantity.negated());
  }

  for (const fee of transactionView.fees) {
    if (fee.feeSettlement === 'on-chain') {
      continue;
    }

    applyDelta(fee.assetId, fee.assetSymbol, fee.quantity.negated());
  }
}

export function buildPortfolioHoldings(accountingModel: AccountingModelBuildResult): {
  assetMetadata: Record<string, string>;
  balances: Record<string, Decimal>;
} {
  const balances: Record<string, Decimal> = {};
  const assetMetadata: Record<string, string> = {};

  for (const transactionView of accountingModel.accountingTransactionViews) {
    applyAccountingTransactionBalanceImpact(transactionView, (assetId, assetSymbol, quantityDelta) => {
      assetMetadata[assetId] = assetSymbol;
      balances[assetId] = (balances[assetId] ?? new Decimal(0)).plus(quantityDelta);
    });
  }

  return { balances, assetMetadata };
}

interface PositionPricingDetails {
  currentValue?: string | undefined;
  isUnpriced: boolean;
  priceError?: string | undefined;
  priceStatus: 'ok' | 'unavailable';
  spotPricePerUnit?: string | undefined;
  usdSpotPrice?: Decimal | undefined;
}

interface PositionCostBasisDetails {
  avgCostPerUnit?: string | undefined;
  openLots: OpenLotItem[];
  totalCostBasis?: string | undefined;
  unrealizedGainLoss?: string | undefined;
  unrealizedPct?: string | undefined;
}

function toDisplayedHoldingQuantity(balance: Decimal): string | undefined {
  const quantityString = balance.toFixed(8);
  return new Decimal(quantityString).isZero() ? undefined : quantityString;
}

function buildPositionPricingDetails(
  balance: Decimal,
  fxRate: Decimal | undefined,
  priceResult: SpotPriceResult | undefined
): PositionPricingDetails {
  if (!priceResult || !('price' in priceResult)) {
    return {
      isUnpriced: true,
      priceError: priceResult && 'error' in priceResult ? priceResult.error : undefined,
      priceStatus: 'unavailable',
    };
  }

  const usdSpotPrice = priceResult.price;
  const displaySpotPrice = fxRate ? usdSpotPrice.times(fxRate) : usdSpotPrice;

  return {
    currentValue: displaySpotPrice.times(balance.abs()).toFixed(2),
    isUnpriced: false,
    priceStatus: 'ok',
    spotPricePerUnit: displaySpotPrice.toFixed(2),
    usdSpotPrice,
  };
}

function buildPositionCostBasisDetails(params: {
  asOf: Date;
  fxRate: Decimal | undefined;
  openLots: AcquisitionLot[];
  usdSpotPrice: Decimal | undefined;
}): PositionCostBasisDetails {
  const { asOf, fxRate, openLots, usdSpotPrice } = params;
  if (openLots.length === 0 || usdSpotPrice === undefined) {
    return { openLots: [] };
  }

  const weightedCostUsd = computeWeightedAvgCost(openLots);
  const totalCostUsd = openLots.reduce(
    (sum, lot) => sum.plus(lot.costBasisPerUnit.times(lot.remainingQuantity)),
    new Decimal(0)
  );
  const unrealizedUsd = computeUnrealizedPnL(openLots, usdSpotPrice);

  const displayWeightedCost = fxRate ? weightedCostUsd.times(fxRate) : weightedCostUsd;
  const displayTotalCost = fxRate ? totalCostUsd.times(fxRate) : totalCostUsd;
  const displayUnrealized = fxRate ? unrealizedUsd.times(fxRate) : unrealizedUsd;

  return {
    avgCostPerUnit: displayWeightedCost.toFixed(2),
    totalCostBasis: displayTotalCost.toFixed(2),
    unrealizedGainLoss: displayUnrealized.toFixed(2),
    ...(displayTotalCost.gt(0) ? { unrealizedPct: displayUnrealized.div(displayTotalCost).times(100).toFixed(1) } : {}),
    openLots: openLots.map((lot) => {
      const holdingDays = Math.floor((asOf.getTime() - lot.acquisitionDate.getTime()) / (1000 * 60 * 60 * 24));
      const costBasisPerUnit = fxRate ? lot.costBasisPerUnit.times(fxRate).toFixed(2) : lot.costBasisPerUnit.toFixed(2);

      return {
        lotId: lot.id,
        quantity: lot.quantity.toFixed(8),
        remainingQuantity: lot.remainingQuantity.toFixed(8),
        costBasisPerUnit,
        acquisitionDate: lot.acquisitionDate.toISOString(),
        holdingDays,
      };
    }),
  };
}

function buildPortfolioPosition(params: {
  accountBreakdown: Map<string, AccountBreakdownItem[]>;
  asOf: Date;
  assetId: string;
  assetMetadata: Record<string, string>;
  balance: Decimal;
  fxRate: Decimal | undefined;
  openLotsByAssetId: Map<string, AcquisitionLot[]>;
  realizedGainLossByAssetId?: Map<string, Decimal> | undefined;
  realizedGainLossDisplayContext: RealizedGainLossDisplayContext;
  spotPrices: Map<string, SpotPriceResult>;
}): { isUnpriced: boolean; position: PortfolioPositionItem } | undefined {
  const quantity = toDisplayedHoldingQuantity(params.balance);
  if (params.balance.isZero() || quantity === undefined) {
    return undefined;
  }

  const priceDetails = buildPositionPricingDetails(
    params.balance,
    params.fxRate,
    params.spotPrices.get(params.assetId)
  );
  const costBasisDetails = buildPositionCostBasisDetails({
    asOf: params.asOf,
    fxRate: params.fxRate,
    openLots: params.openLotsByAssetId.get(params.assetId) ?? [],
    usdSpotPrice: priceDetails.usdSpotPrice,
  });

  const realizedAmount = params.realizedGainLossByAssetId?.get(params.assetId) ?? new Decimal(0);
  const realizedDisplay = convertRealizedGainLossToDisplay(realizedAmount, params.realizedGainLossDisplayContext);

  return {
    isUnpriced: priceDetails.isUnpriced,
    position: {
      accountBreakdown: params.accountBreakdown.get(params.assetId) ?? [],
      assetId: params.assetId,
      assetSymbol: params.assetMetadata[params.assetId] ?? params.assetId,
      quantity,
      isNegative: params.balance.isNegative(),
      allocationPct: undefined,
      priceStatus: priceDetails.priceStatus,
      ...(priceDetails.spotPricePerUnit ? { spotPricePerUnit: priceDetails.spotPricePerUnit } : {}),
      ...(priceDetails.currentValue ? { currentValue: priceDetails.currentValue } : {}),
      ...(priceDetails.priceError ? { priceError: priceDetails.priceError } : {}),
      ...(costBasisDetails.totalCostBasis ? { totalCostBasis: costBasisDetails.totalCostBasis } : {}),
      ...(costBasisDetails.avgCostPerUnit ? { avgCostPerUnit: costBasisDetails.avgCostPerUnit } : {}),
      ...(costBasisDetails.unrealizedGainLoss ? { unrealizedGainLoss: costBasisDetails.unrealizedGainLoss } : {}),
      ...(costBasisDetails.unrealizedPct ? { unrealizedPct: costBasisDetails.unrealizedPct } : {}),
      realizedGainLossAllTime: realizedDisplay.toFixed(2),
      openLots: costBasisDetails.openLots,
    },
  };
}

/**
 * Build portfolio positions from holdings, spot prices, and open lots.
 * Handles partial price failures, negative balances, and missing open lots.
 */
export function buildPortfolioPositions(params: {
  accountBreakdown: Map<string, AccountBreakdownItem[]>;
  asOf: Date;
  assetMetadata: Record<string, string>; // assetId -> assetSymbol
  fxRate: Decimal | undefined; // USD -> display currency (undefined if USD)
  holdings: Record<string, Decimal>; // assetId -> balance
  openLotsByAssetId: Map<string, AcquisitionLot[]>;
  realizedGainLossByAssetId?: Map<string, Decimal>;
  realizedGainLossDisplayContext?: RealizedGainLossDisplayContext;
  spotPrices: Map<string, SpotPriceResult>;
}): { positions: PortfolioPositionItem[]; warnings: string[] } {
  const {
    accountBreakdown,
    asOf,
    assetMetadata,
    fxRate,
    holdings,
    openLotsByAssetId,
    realizedGainLossByAssetId,
    spotPrices,
  } = params;
  const realizedGainLossDisplayContext: RealizedGainLossDisplayContext = params.realizedGainLossDisplayContext ?? {
    sourceCurrency: 'USD',
    ...(fxRate ? { usdToDisplayFxRate: fxRate } : {}),
  };
  const positions: PortfolioPositionItem[] = [];
  const warnings: string[] = [];
  let unpricedCount = 0;

  for (const [assetId, balance] of Object.entries(holdings)) {
    const builtPosition = buildPortfolioPosition({
      accountBreakdown,
      asOf,
      assetId,
      assetMetadata,
      balance,
      fxRate,
      openLotsByAssetId,
      realizedGainLossByAssetId,
      realizedGainLossDisplayContext,
      spotPrices,
    });
    if (!builtPosition) {
      continue;
    }

    if (builtPosition.isUnpriced) {
      unpricedCount++;
    }

    positions.push(builtPosition.position);
  }

  applyAllocationPercentages(positions);

  if (unpricedCount > 0) {
    warnings.push(
      `${unpricedCount} asset${unpricedCount > 1 ? 's' : ''} could not be priced — values may be incomplete`
    );
  }

  return { positions, warnings };
}

interface CanadaPortfolioAssetGroup {
  assetLabel: string;
  assetSymbol: string;
  portfolioKey: string;
  sourceAssetIds: string[];
}

interface CanadaPortfolioPositionsResult {
  closedPositions: PortfolioPositionItem[];
  positions: PortfolioPositionItem[];
  realizedGainLossByPortfolioKey: Map<string, Decimal>;
  warnings: string[];
}

export type RealizedGainLossDisplayContext =
  | {
      sourceCurrency: 'display';
    }
  | {
      sourceCurrency: 'USD';
      usdToDisplayFxRate?: Decimal | undefined;
    };

function convertRealizedGainLossToDisplay(
  realizedAmount: Decimal,
  displayContext: RealizedGainLossDisplayContext
): Decimal {
  if (displayContext.sourceCurrency === 'display') {
    return realizedAmount;
  }

  return displayContext.usdToDisplayFxRate ? realizedAmount.times(displayContext.usdToDisplayFxRate) : realizedAmount;
}

function getPositionSourceAssetIds(position: PortfolioPositionItem): string[] {
  return position.sourceAssetIds ?? [position.assetId];
}

function mergeAccountBreakdownItems(items: AccountBreakdownItem[]): AccountBreakdownItem[] {
  const merged = new Map<string, AccountBreakdownItem>();

  for (const item of items) {
    const key = `${item.accountId}:${item.platformKey}:${item.accountType}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantity = new Decimal(existing.quantity).plus(item.quantity).toFixed(8);
    } else {
      merged.set(key, { ...item });
    }
  }

  return Array.from(merged.values());
}

function buildCanadaPortfolioAssetGroups(inputContext: CanadaTaxInputContext): Map<string, CanadaPortfolioAssetGroup> {
  const groupsByTaxPropertyKey = new Map<
    string,
    { assetSymbol: string; portfolioKey: string; sourceAssetIds: Set<string> }
  >();

  for (const event of inputContext.inputEvents) {
    const existing = groupsByTaxPropertyKey.get(event.taxPropertyKey);
    if (existing) {
      existing.sourceAssetIds.add(event.assetId);
      continue;
    }

    groupsByTaxPropertyKey.set(event.taxPropertyKey, {
      portfolioKey: `canada-pool:${event.taxPropertyKey}`,
      assetSymbol: event.assetSymbol,
      sourceAssetIds: new Set([event.assetId]),
    });
  }

  const taxPropertyCountBySymbol = new Map<string, number>();
  for (const group of groupsByTaxPropertyKey.values()) {
    taxPropertyCountBySymbol.set(group.assetSymbol, (taxPropertyCountBySymbol.get(group.assetSymbol) ?? 0) + 1);
  }

  return new Map(
    [...groupsByTaxPropertyKey.entries()].map(([taxPropertyKey, group]) => [
      taxPropertyKey,
      {
        portfolioKey: group.portfolioKey,
        assetSymbol: group.assetSymbol,
        assetLabel:
          (taxPropertyCountBySymbol.get(group.assetSymbol) ?? 0) > 1
            ? `${group.assetSymbol} (${taxPropertyKey})`
            : group.assetSymbol,
        sourceAssetIds: Array.from(group.sourceAssetIds),
      },
    ])
  );
}

function pickPooledSpotPrice(
  sourceAssetIds: string[],
  spotPricesByAssetId: Map<string, SpotPriceResult>
): SpotPriceResult | undefined {
  for (const assetId of sourceAssetIds) {
    const price = spotPricesByAssetId.get(assetId);
    if (price && 'price' in price) {
      return price;
    }
  }

  for (const assetId of sourceAssetIds) {
    const price = spotPricesByAssetId.get(assetId);
    if (price) {
      return price;
    }
  }

  return undefined;
}

function createCanadaPortfolioLot(params: {
  acquisitionDate: Date;
  assetId: string;
  assetSymbol: Currency;
  costBasisPerUnit: Decimal;
  id: string;
  quantity: Decimal;
  remainingQuantity: Decimal;
  totalCostBasis: Decimal;
  transactionId: number;
}): AcquisitionLot {
  return {
    id: params.id,
    calculationId: 'ca-portfolio',
    acquisitionTransactionId: params.transactionId,
    assetId: params.assetId,
    assetSymbol: params.assetSymbol,
    quantity: params.quantity,
    costBasisPerUnit: params.costBasisPerUnit,
    totalCostBasis: params.totalCostBasis,
    acquisitionDate: params.acquisitionDate,
    method: 'average-cost',
    remainingQuantity: params.remainingQuantity,
    status: 'open',
    createdAt: params.acquisitionDate,
    updatedAt: params.acquisitionDate,
  };
}

function attachSourceAssetIds(
  positions: PortfolioPositionItem[],
  groupsByPortfolioKey: Map<string, CanadaPortfolioAssetGroup>
): PortfolioPositionItem[] {
  return positions.map((position) => {
    const group = groupsByPortfolioKey.get(position.assetId);
    if (!group) {
      return position;
    }

    return {
      ...position,
      sourceAssetIds: group.sourceAssetIds,
    };
  });
}

interface CanadaGroupedPortfolioInputs {
  assetLabelsByPortfolioKey: Record<string, string>;
  groupsByPortfolioKey: Map<string, CanadaPortfolioAssetGroup>;
  holdingsByPortfolioKey: Record<string, Decimal>;
  matchedAssetIds: Set<string>;
  pooledAccountBreakdown: Map<string, AccountBreakdownItem[]>;
  pooledSpotPrices: Map<string, SpotPriceResult>;
}

interface UnmatchedPortfolioInputs {
  accountBreakdown: Map<string, AccountBreakdownItem[]>;
  assetMetadata: Record<string, string>;
  holdings: Record<string, Decimal>;
  spotPrices: Map<string, SpotPriceResult>;
}

function buildCanadaGroupedPortfolioInputs(params: {
  accountBreakdown: Map<string, AccountBreakdownItem[]>;
  assetGroups: Map<string, CanadaPortfolioAssetGroup>;
  holdings: Record<string, Decimal>;
  spotPricesByAssetId: Map<string, SpotPriceResult>;
}): CanadaGroupedPortfolioInputs {
  const groupsByPortfolioKey = new Map(
    [...params.assetGroups.values()].map((group) => [group.portfolioKey, group] as const)
  );
  const holdingsByPortfolioKey: Record<string, Decimal> = {};
  const assetLabelsByPortfolioKey: Record<string, string> = {};
  const pooledSpotPrices = new Map<string, SpotPriceResult>();
  const pooledAccountBreakdown = new Map<string, AccountBreakdownItem[]>();
  const matchedAssetIds = new Set<string>();

  for (const group of params.assetGroups.values()) {
    let quantityHeld = new Decimal(0);
    const breakdownItems: AccountBreakdownItem[] = [];

    for (const assetId of group.sourceAssetIds) {
      const balance = params.holdings[assetId];
      if (balance) {
        quantityHeld = quantityHeld.plus(balance);
      }

      const accountItems = params.accountBreakdown.get(assetId);
      if (accountItems) {
        breakdownItems.push(...accountItems);
      }

      matchedAssetIds.add(assetId);
    }

    if (!quantityHeld.isZero()) {
      holdingsByPortfolioKey[group.portfolioKey] = quantityHeld;
    }

    assetLabelsByPortfolioKey[group.portfolioKey] = group.assetLabel;

    const pooledSpotPrice = pickPooledSpotPrice(group.sourceAssetIds, params.spotPricesByAssetId);
    if (pooledSpotPrice) {
      pooledSpotPrices.set(group.portfolioKey, pooledSpotPrice);
    }

    const mergedBreakdown = mergeAccountBreakdownItems(breakdownItems);
    if (mergedBreakdown.length > 0) {
      pooledAccountBreakdown.set(group.portfolioKey, mergedBreakdown);
    }
  }

  return {
    assetLabelsByPortfolioKey,
    groupsByPortfolioKey,
    holdingsByPortfolioKey,
    matchedAssetIds,
    pooledAccountBreakdown,
    pooledSpotPrices,
  };
}

function buildCanadaOpenLotsByPortfolioKey(params: {
  assetGroups: Map<string, CanadaPortfolioAssetGroup>;
  displayReport?: CanadaDisplayCostBasisReport | undefined;
  taxReport: CanadaTaxReport;
}): Map<string, AcquisitionLot[]> {
  const displayAcquisitionsById = new Map(
    params.displayReport?.acquisitions.map((acquisition) => [acquisition.id, acquisition]) ?? []
  );
  const openLotsByPortfolioKey = new Map<string, AcquisitionLot[]>();

  for (const acquisition of params.taxReport.acquisitions) {
    if (acquisition.remainingQuantity.lte(0)) {
      continue;
    }

    const group = params.assetGroups.get(acquisition.taxPropertyKey);
    if (!group) {
      continue;
    }

    const displayAcquisition = displayAcquisitionsById.get(acquisition.id);
    const lot = createCanadaPortfolioLot({
      id: acquisition.id,
      assetId: group.portfolioKey,
      assetSymbol: acquisition.assetSymbol,
      quantity: acquisition.quantityAcquired,
      remainingQuantity: acquisition.remainingQuantity,
      transactionId: acquisition.transactionId,
      acquisitionDate: acquisition.acquiredAt,
      costBasisPerUnit: displayAcquisition?.displayCostBasisPerUnit ?? acquisition.costBasisPerUnitCad,
      totalCostBasis: displayAcquisition?.displayTotalCost ?? acquisition.totalCostCad,
    });

    const existing = openLotsByPortfolioKey.get(group.portfolioKey);
    if (existing) {
      existing.push(lot);
    } else {
      openLotsByPortfolioKey.set(group.portfolioKey, [lot]);
    }
  }

  return openLotsByPortfolioKey;
}

function buildCanadaRealizedGainLossByPortfolioKey(params: {
  assetGroups: Map<string, CanadaPortfolioAssetGroup>;
  displayReport?: CanadaDisplayCostBasisReport | undefined;
  taxReport: CanadaTaxReport;
}): Map<string, Decimal> {
  const displayDispositionsById = new Map(
    params.displayReport?.dispositions.map((disposition) => [disposition.id, disposition]) ?? []
  );
  const realizedGainLossByPortfolioKey = new Map<string, Decimal>();

  for (const disposition of params.taxReport.dispositions) {
    const group = params.assetGroups.get(disposition.taxPropertyKey);
    if (!group) {
      continue;
    }

    const realizedGainLoss = displayDispositionsById.get(disposition.id)?.displayGainLoss ?? disposition.gainLossCad;
    const existing = realizedGainLossByPortfolioKey.get(group.portfolioKey) ?? new Decimal(0);
    realizedGainLossByPortfolioKey.set(group.portfolioKey, existing.plus(realizedGainLoss));
  }

  return realizedGainLossByPortfolioKey;
}

function buildUnmatchedPortfolioInputs(params: {
  accountBreakdown: Map<string, AccountBreakdownItem[]>;
  assetMetadata: Record<string, string>;
  holdings: Record<string, Decimal>;
  matchedAssetIds: Set<string>;
  spotPricesByAssetId: Map<string, SpotPriceResult>;
}): UnmatchedPortfolioInputs {
  const unmatchedHoldings: Record<string, Decimal> = {};
  const unmatchedAssetMetadata: Record<string, string> = {};
  const unmatchedSpotPrices = new Map<string, SpotPriceResult>();
  const unmatchedAccountBreakdown = new Map<string, AccountBreakdownItem[]>();

  for (const [assetId, quantity] of Object.entries(params.holdings)) {
    if (params.matchedAssetIds.has(assetId)) {
      continue;
    }

    unmatchedHoldings[assetId] = quantity;
    unmatchedAssetMetadata[assetId] = params.assetMetadata[assetId] ?? assetId;

    const spotPrice = params.spotPricesByAssetId.get(assetId);
    if (spotPrice) {
      unmatchedSpotPrices.set(assetId, spotPrice);
    }

    const accountItems = params.accountBreakdown.get(assetId);
    if (accountItems) {
      unmatchedAccountBreakdown.set(assetId, accountItems);
    }
  }

  return {
    accountBreakdown: unmatchedAccountBreakdown,
    assetMetadata: unmatchedAssetMetadata,
    holdings: unmatchedHoldings,
    spotPrices: unmatchedSpotPrices,
  };
}

export function buildCanadaPortfolioPositions(params: {
  accountBreakdown: Map<string, AccountBreakdownItem[]>;
  asOf: Date;
  assetMetadata: Record<string, string>;
  displayReport?: CanadaDisplayCostBasisReport | undefined;
  holdings: Record<string, Decimal>;
  inputContext: CanadaTaxInputContext;
  spotPricesByAssetId: Map<string, SpotPriceResult>;
  taxReport: CanadaTaxReport;
}): CanadaPortfolioPositionsResult {
  const assetGroups = buildCanadaPortfolioAssetGroups(params.inputContext);
  const groupedInputs = buildCanadaGroupedPortfolioInputs({
    accountBreakdown: params.accountBreakdown,
    assetGroups,
    holdings: params.holdings,
    spotPricesByAssetId: params.spotPricesByAssetId,
  });
  const openLotsByPortfolioKey = buildCanadaOpenLotsByPortfolioKey({
    assetGroups,
    displayReport: params.displayReport,
    taxReport: params.taxReport,
  });
  const realizedGainLossByPortfolioKey = buildCanadaRealizedGainLossByPortfolioKey({
    assetGroups,
    displayReport: params.displayReport,
    taxReport: params.taxReport,
  });

  const builtCanada = buildPortfolioPositions({
    holdings: groupedInputs.holdingsByPortfolioKey,
    assetMetadata: groupedInputs.assetLabelsByPortfolioKey,
    spotPrices: groupedInputs.pooledSpotPrices,
    openLotsByAssetId: openLotsByPortfolioKey,
    accountBreakdown: groupedInputs.pooledAccountBreakdown,
    fxRate: undefined,
    asOf: params.asOf,
    realizedGainLossByAssetId: realizedGainLossByPortfolioKey,
    realizedGainLossDisplayContext: { sourceCurrency: 'display' },
  });

  const unmatchedInputs = buildUnmatchedPortfolioInputs({
    accountBreakdown: params.accountBreakdown,
    assetMetadata: params.assetMetadata,
    holdings: params.holdings,
    matchedAssetIds: groupedInputs.matchedAssetIds,
    spotPricesByAssetId: params.spotPricesByAssetId,
  });
  const builtUnmatched = buildPortfolioPositions({
    holdings: unmatchedInputs.holdings,
    assetMetadata: unmatchedInputs.assetMetadata,
    spotPrices: unmatchedInputs.spotPrices,
    openLotsByAssetId: new Map(),
    accountBreakdown: unmatchedInputs.accountBreakdown,
    fxRate: undefined,
    asOf: params.asOf,
  });

  const positions = attachSourceAssetIds(builtCanada.positions, groupedInputs.groupsByPortfolioKey).concat(
    builtUnmatched.positions
  );
  const closedPositions = attachSourceAssetIds(
    buildClosedPositionsByAssetId(
      Object.keys(groupedInputs.holdingsByPortfolioKey),
      groupedInputs.assetLabelsByPortfolioKey,
      realizedGainLossByPortfolioKey,
      { sourceCurrency: 'display' }
    ),
    groupedInputs.groupsByPortfolioKey
  );

  return {
    positions,
    closedPositions,
    realizedGainLossByPortfolioKey,
    warnings: [...builtCanada.warnings, ...builtUnmatched.warnings],
  };
}

function groupPositionsByAssetSymbol(positions: PortfolioPositionItem[]): Map<string, PortfolioPositionItem[]> {
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

  return groups;
}

function buildAggregatedPriceDetails(
  group: PortfolioPositionItem[],
  absoluteNetQuantity: Decimal
): Pick<PortfolioPositionItem, 'currentValue' | 'priceError' | 'priceStatus' | 'spotPricePerUnit'> {
  const pricedRows = group.filter(
    (position): position is PortfolioPositionItem & { currentValue: string; spotPricePerUnit: string } =>
      position.priceStatus === 'ok' && position.currentValue !== undefined && position.spotPricePerUnit !== undefined
  );

  if (pricedRows.length === 0) {
    const uniqueErrors = Array.from(
      new Set(
        group
          .map((position) => position.priceError)
          .filter((error): error is string => error !== undefined && error.length > 0)
      )
    );

    return {
      priceStatus: 'unavailable',
      ...(uniqueErrors.length > 0 ? { priceError: uniqueErrors.join('; ') } : {}),
    };
  }

  const pricedByQuantity = pricedRows.reduce((sum, position) => {
    const quantity = new Decimal(position.quantity).abs();
    return sum.plus(quantity);
  }, new Decimal(0));
  const weightedSpot = pricedRows.reduce((sum, position) => {
    const quantity = new Decimal(position.quantity).abs();
    const spot = new Decimal(position.spotPricePerUnit);
    return sum.plus(spot.times(quantity));
  }, new Decimal(0));
  const spot = pricedByQuantity.gt(0)
    ? weightedSpot.div(pricedByQuantity)
    : new Decimal(pricedRows[0]!.spotPricePerUnit);

  return {
    currentValue: spot.times(absoluteNetQuantity).toFixed(2),
    priceStatus: 'ok',
    spotPricePerUnit: spot.toFixed(2),
  };
}

function buildAggregatedCostBasisDetails(
  group: PortfolioPositionItem[],
  absoluteNetQuantity: Decimal
): Pick<PortfolioPositionItem, 'avgCostPerUnit' | 'totalCostBasis' | 'unrealizedGainLoss' | 'unrealizedPct'> {
  const rowsWithCost = group.filter(
    (
      position
    ): position is PortfolioPositionItem & {
      totalCostBasis: string;
      unrealizedGainLoss: string;
    } => position.totalCostBasis !== undefined && position.unrealizedGainLoss !== undefined
  );

  if (rowsWithCost.length === 0) {
    return {};
  }

  const totalCost = rowsWithCost.reduce((sum, position) => sum.plus(position.totalCostBasis), new Decimal(0));
  const totalUnrealized = rowsWithCost.reduce((sum, position) => sum.plus(position.unrealizedGainLoss), new Decimal(0));
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

  let avgCostPerUnit: string | undefined;
  if (totalCostQuantityFromCostBasis.gt(0)) {
    avgCostPerUnit = totalCost.div(totalCostQuantityFromCostBasis).toFixed(2);
  } else if (totalCostQuantityFromBalance.gt(0)) {
    avgCostPerUnit = totalCost.div(totalCostQuantityFromBalance).toFixed(2);
  } else if (absoluteNetQuantity.gt(0)) {
    avgCostPerUnit = totalCost.div(absoluteNetQuantity).toFixed(2);
  }

  return {
    totalCostBasis: totalCost.toFixed(2),
    unrealizedGainLoss: totalUnrealized.toFixed(2),
    ...(avgCostPerUnit ? { avgCostPerUnit } : {}),
    ...(totalCost.gt(0) ? { unrealizedPct: totalUnrealized.div(totalCost).times(100).toFixed(1) } : {}),
  };
}

function buildAggregatedAccountBreakdown(group: PortfolioPositionItem[]): AccountBreakdownItem[] {
  const accountMap = new Map<string, AccountBreakdownItem>();

  for (const position of group) {
    for (const account of position.accountBreakdown) {
      const key = `${account.accountId}:${account.platformKey}:${account.accountType}`;
      const existing = accountMap.get(key);
      if (existing) {
        const mergedQuantity = new Decimal(existing.quantity).plus(account.quantity);
        existing.quantity = mergedQuantity.toFixed(8);
      } else {
        accountMap.set(key, { ...account });
      }
    }
  }

  return Array.from(accountMap.values());
}

function aggregatePositionGroup(group: PortfolioPositionItem[]): PortfolioPositionItem {
  if (group.length === 1) {
    const single = group[0]!;
    return {
      ...single,
      sourceAssetIds: getPositionSourceAssetIds(single),
    };
  }

  const sourceAssetIds = Array.from(new Set(group.flatMap((position) => getPositionSourceAssetIds(position))));
  const assetSymbol = group[0]!.assetSymbol;
  const netQuantity = group.reduce((sum, position) => sum.plus(position.quantity), new Decimal(0));
  const absoluteNetQuantity = netQuantity.abs();

  return {
    assetId: sourceAssetIds[0]!,
    sourceAssetIds,
    assetSymbol,
    quantity: netQuantity.toFixed(8),
    isNegative: netQuantity.isNegative(),
    allocationPct: undefined,
    ...buildAggregatedPriceDetails(group, absoluteNetQuantity),
    ...buildAggregatedCostBasisDetails(group, absoluteNetQuantity),
    realizedGainLossAllTime: group
      .reduce((sum, position) => sum.plus(position.realizedGainLossAllTime ?? '0'), new Decimal(0))
      .toFixed(2),
    openLots: group.flatMap((position) => position.openLots),
    accountBreakdown: buildAggregatedAccountBreakdown(group),
  };
}

/**
 * Aggregate portfolio positions by asset symbol for display.
 *
 * We keep underlying assetIds in `sourceAssetIds` so drill-down/history can still
 * include movements from all merged assets.
 */
export function aggregatePositionsByAssetSymbol(positions: PortfolioPositionItem[]): PortfolioPositionItem[] {
  const aggregated: PortfolioPositionItem[] = [];
  for (const group of groupPositionsByAssetSymbol(positions).values()) {
    aggregated.push(aggregatePositionGroup(group));
  }

  applyAllocationPercentages(aggregated);
  return aggregated;
}

export function buildClosedPositionsByAssetId(
  holdingAssetIds: string[],
  assetMetadata: Record<string, string>,
  realizedGainLossByAssetId: Map<string, Decimal>,
  realizedGainLossDisplayContext: RealizedGainLossDisplayContext
): PortfolioPositionItem[] {
  const holdingAssetSet = new Set(holdingAssetIds);
  const closedPositions: PortfolioPositionItem[] = [];

  for (const [assetId, realizedAmount] of realizedGainLossByAssetId.entries()) {
    if (holdingAssetSet.has(assetId)) {
      continue;
    }

    const realizedDisplay = convertRealizedGainLossToDisplay(realizedAmount, realizedGainLossDisplayContext);
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

/**
 * Compute total realized gain/loss across all disposal activity.
 *
 * This includes assets that may no longer have an open position, so callers can
 * present a true all-time realized total.
 */
export function computeTotalRealizedGainLossAllTime(
  realizedGainLossByAssetId: Map<string, Decimal>,
  realizedGainLossDisplayContext: RealizedGainLossDisplayContext,
  hasVisiblePositions: boolean
): string | undefined {
  if (!hasVisiblePositions && realizedGainLossByAssetId.size === 0) {
    return undefined;
  }

  const totalRealized = Array.from(realizedGainLossByAssetId.values()).reduce(
    (sum, realizedAmount) => sum.plus(realizedAmount),
    new Decimal(0)
  );
  const totalRealizedDisplay = convertRealizedGainLossToDisplay(totalRealized, realizedGainLossDisplayContext);
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
 * Build per-account asset balances from the canonical accounting model.
 * Groups accounting transaction views by accountId and calculates balances per account for each asset.
 */
export function buildAccountAssetBalances(
  accountingModel: AccountingModelBuildResult,
  accountMetadataById: Map<number, AccountMetadata>
): Map<string, AccountBreakdownItem[]> {
  const accountTransactions = new Map<number, AccountingTransactionView[]>();

  for (const transactionView of accountingModel.accountingTransactionViews) {
    const accountId = transactionView.processedTransaction.accountId;
    const existing = accountTransactions.get(accountId);
    if (existing) {
      existing.push(transactionView);
    } else {
      accountTransactions.set(accountId, [transactionView]);
    }
  }

  const accountBalances = new Map<number, Record<string, Decimal>>();
  for (const [accountId, transactionViews] of accountTransactions.entries()) {
    const balances: Record<string, Decimal> = {};

    for (const transactionView of transactionViews) {
      applyAccountingTransactionBalanceImpact(transactionView, (assetId, _assetSymbol, quantityDelta) => {
        balances[assetId] = (balances[assetId] ?? new Decimal(0)).plus(quantityDelta);
      });
    }

    accountBalances.set(accountId, balances);
  }

  const breakdown = new Map<string, AccountBreakdownItem[]>();

  for (const [accountId, balances] of accountBalances.entries()) {
    const fallbackTransaction = accountTransactions.get(accountId)?.[0]?.processedTransaction;
    const metadata = accountMetadataById.get(accountId) ?? {
      platformKey: fallbackTransaction?.platformKey ?? `account-${accountId}`,
      accountType: deriveAccountTypeFromSourceType(fallbackTransaction?.platformKind),
    };

    if (!accountMetadataById.has(accountId)) {
      logger.warn(
        { accountId, platformKey: metadata.platformKey },
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
        platformKey: metadata.platformKey,
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
  platformKind: Transaction['platformKind'] | undefined
): AccountMetadata['accountType'] {
  if (platformKind === 'blockchain') {
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

interface NetFiatInComputation {
  netFiatInUsd: Decimal;
  skippedNonUsdMovementsWithoutPrice: number;
}

function isNetFiatTransferTransaction(
  tx: Transaction,
  annotationsByTransactionId: ReadonlyMap<number, readonly TransactionAnnotation[]>
): boolean {
  const derivedOperation = deriveOperationLabel(tx, annotationsByTransactionId.get(tx.id) ?? []);
  return hasTransactionTransferIntent(tx, derivedOperation);
}

/**
 * Compute net external fiat funding in USD using transfer transaction views only.
 *
 * Net fiat in = fiat inflows - fiat outflows - fiat fees.
 */
export function computeNetFiatInUsd(
  accountingModel: AccountingModelBuildResult,
  transactionAnnotations: readonly TransactionAnnotation[] = []
): NetFiatInComputation {
  let netFiatInUsd = new Decimal(0);
  let skippedNonUsdMovementsWithoutPrice = 0;
  const annotationsByTransactionId = groupTransactionAnnotationsByTransactionId(transactionAnnotations);

  for (const transactionView of accountingModel.accountingTransactionViews) {
    const tx = transactionView.processedTransaction;
    if (!isNetFiatTransferTransaction(tx, annotationsByTransactionId)) {
      continue;
    }

    for (const inflow of transactionView.inflows) {
      if (!isFiatSymbol(inflow.assetSymbol)) {
        continue;
      }
      const usdAmount = toUsdAmount(inflow.assetSymbol, inflow.grossQuantity, inflow.priceAtTxTime?.price.amount);
      if (usdAmount === undefined) {
        skippedNonUsdMovementsWithoutPrice++;
        continue;
      }
      netFiatInUsd = netFiatInUsd.plus(usdAmount);
    }

    for (const outflow of transactionView.outflows) {
      if (!isFiatSymbol(outflow.assetSymbol)) {
        continue;
      }
      const usdAmount = toUsdAmount(outflow.assetSymbol, outflow.grossQuantity, outflow.priceAtTxTime?.price.amount);
      if (usdAmount === undefined) {
        skippedNonUsdMovementsWithoutPrice++;
        continue;
      }
      netFiatInUsd = netFiatInUsd.minus(usdAmount);
    }

    for (const fee of transactionView.fees) {
      if (!isFiatSymbol(fee.assetSymbol)) {
        continue;
      }
      const usdAmount = toUsdAmount(fee.assetSymbol, fee.quantity, fee.priceAtTxTime?.price.amount);
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
  if (currency && currency === USD_CURRENCY) {
    return amount;
  }

  return undefined;
}

function isFiatSymbol(assetSymbol: string): boolean {
  return isFiat(assetSymbol as Currency);
}

function tryCreateCurrency(assetSymbol: string): Currency | undefined {
  const result = parseCurrency(assetSymbol);
  return result.isOk() ? result.value : undefined;
}
