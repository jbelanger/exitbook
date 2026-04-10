import type { ValidatedCostBasisConfig } from '@exitbook/accounting/cost-basis';
import type { Result } from '@exitbook/foundation';

import type { CostBasisCommandScope } from './cost-basis-command-scope.js';
import type { CostBasisArtifactExecutionResult } from './cost-basis-handler.js';

interface CostBasisRunOptions {
  refresh?: boolean | undefined;
}

export async function runCostBasisArtifact(
  scope: CostBasisCommandScope,
  params: ValidatedCostBasisConfig,
  options?: CostBasisRunOptions
): Promise<Result<CostBasisArtifactExecutionResult, Error>> {
  return scope.handler.executeArtifactWithContext(params, options);
}
