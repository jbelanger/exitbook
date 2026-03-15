import { err, ok, type Result } from '@exitbook/core';

import { buildCanadaTaxPackage } from './canada-tax-package-builder.js';
import type { TaxPackageBuildContext } from './tax-package-build-context.js';
import { evaluateTaxPackageReadiness } from './tax-package-review-gate.js';
import type { TaxPackageValidatedScope } from './tax-package-scope-validator.js';
import type {
  ExportTaxPackageArtifactRef,
  ITaxPackageFileWriter,
  TaxPackageExportResult,
  TaxPackageReadinessMetadata,
} from './tax-package-types.js';

export interface ExportTaxPackageInput {
  context: TaxPackageBuildContext;
  readinessMetadata?: TaxPackageReadinessMetadata | undefined;
  scope: TaxPackageValidatedScope;
}

export async function exportTaxPackage(
  input: ExportTaxPackageInput,
  deps: {
    now: () => Date;
    writer: ITaxPackageFileWriter;
  }
): Promise<Result<TaxPackageExportResult, Error>> {
  const readiness = evaluateTaxPackageReadiness({
    workflowResult: input.context.workflowResult,
    scope: input.scope,
    metadata: input.readinessMetadata,
  });

  const buildResult = buildJurisdictionPackage(input, readiness, deps.now);
  if (buildResult.isErr()) {
    return err(buildResult.error);
  }

  const writeResult = await deps.writer.writeAll(buildResult.value.files);
  if (writeResult.isErr()) {
    return err(writeResult.error);
  }

  const artifactRef: ExportTaxPackageArtifactRef = {
    calculationId: input.context.artifactRef.calculationId,
    snapshotId: input.context.artifactRef.snapshotId,
    scopeKey: input.context.artifactRef.scopeKey,
  };

  return ok({
    artifactRef,
    files: writeResult.value,
    manifest: buildResult.value.manifest,
    status: buildResult.value.status,
  });
}

function buildJurisdictionPackage(
  input: ExportTaxPackageInput,
  readiness: ReturnType<typeof evaluateTaxPackageReadiness>,
  now: () => Date
) {
  switch (input.scope.config.jurisdiction) {
    case 'CA':
      return buildCanadaTaxPackage({
        context: input.context,
        readiness,
        now,
      });
    case 'US':
      return err(new Error('US tax package export is not implemented yet.'));
    default:
      return err(
        new Error(`Tax package export is not supported for jurisdiction '${input.scope.config.jurisdiction}'.`)
      );
  }
}
