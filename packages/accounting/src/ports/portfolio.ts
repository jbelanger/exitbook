import type { AssetReviewSummary, Transaction } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import type { CostBasisDependencyWatermark } from './cost-basis-persistence.js';

export interface PortfolioHoldingsCalculation {
  assetMetadata: Record<string, string>;
  balances: Record<string, Decimal>;
}

export interface IPortfolioDependencyReader {
  readAssetReviewSummaries(): Promise<Result<ReadonlyMap<string, AssetReviewSummary>, Error>>;
  readDependencyWatermark(): Promise<Result<CostBasisDependencyWatermark, Error>>;
}

export interface IPortfolioHoldingsCalculator {
  calculateHoldings(transactions: Transaction[]): PortfolioHoldingsCalculation;
}
