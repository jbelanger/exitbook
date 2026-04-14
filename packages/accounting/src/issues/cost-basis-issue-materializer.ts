import type { AssetReviewSummary } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';

import { buildTaxPackageBuildContext } from '../cost-basis/export/tax-package-context-builder.js';
import { deriveTaxPackageReadinessMetadata } from '../cost-basis/export/tax-package-readiness-metadata.js';
import { evaluateTaxPackageReadiness } from '../cost-basis/export/tax-package-review-gate.js';
import { validateTaxPackageScope } from '../cost-basis/export/tax-package-scope-validator.js';
import type { AccountingExclusionPolicy } from '../cost-basis/standard/validation/accounting-exclusion-policy.js';
import type { ValidatedCostBasisConfig } from '../cost-basis/workflow/cost-basis-input.js';
import { CostBasisWorkflow } from '../cost-basis/workflow/cost-basis-workflow.js';
import type { ICostBasisContextReader } from '../ports/cost-basis-persistence.js';

import {
  buildCostBasisAccountingIssueScopeKey,
  buildCostBasisAccountingIssueScopeSnapshot,
} from './cost-basis-issues.js';
import type { AccountingIssueScopeSnapshot } from './issue-model.js';

export interface MaterializeCostBasisAccountingIssueScopeSnapshotInput {
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary> | undefined;
  config: ValidatedCostBasisConfig;
  contextReader: ICostBasisContextReader;
  priceRuntime?: IPriceProviderRuntime | undefined;
  profileId: number;
  updatedAt?: Date | undefined;
}

/**
 * Cost-basis issue production runs the filing workflow in soft-price mode so
 * missing price coverage becomes surfaced accounting work instead of a hard
 * command failure.
 */
export async function materializeCostBasisAccountingIssueScopeSnapshot(
  input: MaterializeCostBasisAccountingIssueScopeSnapshotInput
): Promise<Result<AccountingIssueScopeSnapshot, Error>> {
  const validatedScope = validateTaxPackageScope({
    config: input.config,
  });
  if (validatedScope.isErr()) {
    return err(validatedScope.error);
  }

  const sourceContext = await input.contextReader.loadCostBasisContext();
  if (sourceContext.isErr()) {
    return err(sourceContext.error);
  }

  const workflow = new CostBasisWorkflow(input.contextReader, input.priceRuntime);
  const workflowResult = await workflow.execute(input.config, sourceContext.value.transactions, {
    accountingExclusionPolicy: input.accountingExclusionPolicy,
    assetReviewSummaries: input.assetReviewSummaries,
    missingPricePolicy: 'exclude',
  });
  if (workflowResult.isErr()) {
    return err(workflowResult.error);
  }

  const scopeKey = buildCostBasisAccountingIssueScopeKey(input.profileId, input.config);
  const buildContext = buildTaxPackageBuildContext({
    artifact: workflowResult.value,
    sourceContext: sourceContext.value,
    scopeKey,
  });
  if (buildContext.isErr()) {
    return err(buildContext.error);
  }

  const readinessMetadata = deriveTaxPackageReadinessMetadata({
    context: buildContext.value,
    assetReviewSummaries: input.assetReviewSummaries,
  });
  const readiness = evaluateTaxPackageReadiness({
    workflowResult: workflowResult.value,
    scope: validatedScope.value,
    metadata: readinessMetadata,
  });

  return ok(
    buildCostBasisAccountingIssueScopeSnapshot({
      config: input.config,
      profileId: input.profileId,
      readiness,
      readinessMetadata,
      scope: validatedScope.value,
      updatedAt: input.updatedAt,
    })
  );
}
