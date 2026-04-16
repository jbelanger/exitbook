import type { AssetReviewSummary } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

import type { CostBasisDependencyWatermark } from './cost-basis-persistence.js';

export type ReadPortfolioAssetReviewSummaries = () => Promise<Result<ReadonlyMap<string, AssetReviewSummary>, Error>>;

export type ReadPortfolioDependencyWatermark = () => Promise<Result<CostBasisDependencyWatermark, Error>>;
