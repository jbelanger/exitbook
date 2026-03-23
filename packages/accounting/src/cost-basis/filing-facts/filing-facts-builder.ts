import type { Result } from '@exitbook/foundation';

import type { CostBasisWorkflowResult } from '../workflow/workflow-result-types.js';

import { buildCanadaCostBasisFilingFacts } from './canada-filing-facts-builder.js';
import type { CostBasisFilingFacts } from './filing-facts-types.js';
import { buildStandardCostBasisFilingFacts } from './standard-filing-facts-builder.js';

interface BuildCostBasisFilingFactsInput {
  artifact: CostBasisWorkflowResult;
  scopeKey?: string | undefined;
  snapshotId?: string | undefined;
}

export function buildCostBasisFilingFacts(input: BuildCostBasisFilingFactsInput): Result<CostBasisFilingFacts, Error> {
  if (input.artifact.kind === 'standard-workflow') {
    return buildStandardCostBasisFilingFacts({
      artifact: input.artifact,
      scopeKey: input.scopeKey,
      snapshotId: input.snapshotId,
    });
  }

  return buildCanadaCostBasisFilingFacts({
    artifact: input.artifact,
    scopeKey: input.scopeKey,
    snapshotId: input.snapshotId,
  });
}
