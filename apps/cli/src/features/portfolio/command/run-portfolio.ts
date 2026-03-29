import type { PortfolioHandlerParams, PortfolioResult } from '@exitbook/accounting/portfolio';
import type { Result } from '@exitbook/foundation';

import type { PortfolioCommandScope } from './portfolio-command-scope.js';

export async function runPortfolio(
  scope: PortfolioCommandScope,
  params: PortfolioHandlerParams
): Promise<Result<PortfolioResult, Error>> {
  return scope.handler.execute(params);
}
