import { err, ok, type Result } from '@exitbook/foundation';

import type { CostBasisContext } from '../../ports/cost-basis-persistence.js';
import { collectCanadaTaxPackageSourceCoverage } from '../jurisdictions/canada/export/canada-tax-package-source-coverage.js';
import { collectStandardTaxPackageSourceCoverage } from '../standard/export/standard-tax-package-source-coverage.js';
import type { CostBasisWorkflowResult } from '../workflow/workflow-result-types.js';

import type { TaxPackageBuildContext } from './tax-package-build-context.js';
import { buildIndexedTaxPackageSourceContext } from './tax-package-source-context.js';
import { validateTaxPackageSourceCoverage } from './tax-package-source-coverage.js';

interface BuildTaxPackageBuildContextParams {
  artifact: CostBasisWorkflowResult;
  sourceContext: CostBasisContext;
  scopeKey: string;
  snapshotId?: string | undefined;
}

export function buildTaxPackageBuildContext(
  params: BuildTaxPackageBuildContextParams
): Result<TaxPackageBuildContext, Error> {
  const indexedSourceContextResult = buildIndexedTaxPackageSourceContext(params.sourceContext);
  if (indexedSourceContextResult.isErr()) {
    return err(indexedSourceContextResult.error);
  }
  const indexedSourceContext = indexedSourceContextResult.value;

  const coverageRequestResult = collectArtifactSourceCoverage(params.artifact);
  if (coverageRequestResult.isErr()) {
    return err(coverageRequestResult.error);
  }

  const validationResult = validateTaxPackageSourceCoverage(indexedSourceContext, coverageRequestResult.value);
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  return ok({
    artifactRef: {
      calculationId: getArtifactCalculationId(params.artifact),
      scopeKey: params.scopeKey,
      snapshotId: params.snapshotId,
    },
    workflowResult: params.artifact,
    sourceContext: indexedSourceContext,
  });
}

function collectArtifactSourceCoverage(artifact: CostBasisWorkflowResult) {
  if (artifact.kind === 'standard-workflow') {
    return collectStandardTaxPackageSourceCoverage(artifact);
  }

  return collectCanadaTaxPackageSourceCoverage(artifact);
}

function getArtifactCalculationId(artifact: CostBasisWorkflowResult): string {
  if (artifact.kind === 'standard-workflow') {
    return artifact.summary.calculation.id;
  }

  return artifact.calculation.id;
}
