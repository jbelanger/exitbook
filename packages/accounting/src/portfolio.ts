export { PortfolioHandler } from './portfolio/portfolio-handler.js';
export type { PortfolioHandlerDeps, PortfolioHandlerParams, PortfolioResult } from './portfolio/portfolio-handler.js';
export type { AcquisitionLot } from './cost-basis/model/types.js';
export type {
  AccountBreakdownItem,
  OpenLotItem,
  PortfolioPositionItem,
  SortMode,
  SpotPriceResult,
} from './portfolio/portfolio-types.js';
export type {
  CalculatePortfolioHoldings,
  PortfolioHoldingsCalculation,
  ReadPortfolioAssetReviewSummaries,
  ReadPortfolioDependencyWatermark,
} from './ports/index.js';
export {
  aggregatePositionsByAssetSymbol,
  buildAccountAssetBalances,
  buildCanadaPortfolioPositions,
  buildClosedPositionsByAssetId,
  buildPortfolioPositions,
  computeNetFiatInUsd,
  computeTotalRealizedGainLossAllTime,
  computeUnrealizedPnL,
  computeWeightedAvgCost,
  sortPositions,
} from './portfolio/portfolio-position-building.js';
export { convertSpotPricesToDisplayCurrency, fetchSpotPrices } from './portfolio/portfolio-pricing.js';
export type {
  CanadaDisplayCostBasisReport,
  CanadaTaxInputContext,
  CanadaTaxReport,
} from './cost-basis/jurisdictions/canada/tax/canada-tax-types.js';
