import { err, ok, sha256Hex, type Result } from '@exitbook/core';

import { buildCostBasisFilingFacts } from '../filing-facts/filing-facts-builder.js';
import type { CostBasisFilingFacts } from '../filing-facts/filing-facts-types.js';

import { buildCanadaTaxPackage } from './canada-tax-package-builder.js';
import type { TaxPackageBuildContext } from './tax-package-build-context.js';
import { evaluateTaxPackageReadiness } from './tax-package-review-gate.js';
import type { TaxPackageValidatedScope } from './tax-package-scope-validator.js';
import type {
  ExportTaxPackageArtifactRef,
  ITaxPackageFileWriter,
  TaxPackageBuildResult,
  TaxPackageExportResult,
  TaxPackageFile,
  TaxPackageManifest,
  TaxPackageReadinessMetadata,
} from './tax-package-types.js';
import { buildUsTaxPackage } from './us-tax-package-builder.js';

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

  const filingFactsResult = buildCostBasisFilingFacts({
    artifact: input.context.workflowResult,
    scopeKey: input.context.artifactRef.scopeKey,
    snapshotId: input.context.artifactRef.snapshotId,
  });
  if (filingFactsResult.isErr()) {
    return err(filingFactsResult.error);
  }

  const buildResult = buildJurisdictionPackage(input, readiness, deps.now, filingFactsResult.value);
  if (buildResult.isErr()) {
    return err(buildResult.error);
  }

  const preparedWriteResult = await backfillArtifactIndexHashes(buildResult.value);
  if (preparedWriteResult.isErr()) {
    return err(preparedWriteResult.error);
  }

  const writeResult = await deps.writer.writeAll(preparedWriteResult.value.files);
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
    manifest: preparedWriteResult.value.manifest,
    status: preparedWriteResult.value.status,
  });
}

function buildJurisdictionPackage(
  input: ExportTaxPackageInput,
  readiness: ReturnType<typeof evaluateTaxPackageReadiness>,
  now: () => Date,
  filingFacts: CostBasisFilingFacts
) {
  switch (input.scope.config.jurisdiction) {
    case 'CA':
      if (filingFacts.kind !== 'canada') {
        return err(new Error('Canada tax package export requires Canada filing facts'));
      }
      return buildCanadaTaxPackage({
        context: input.context,
        filingFacts,
        readiness,
        now,
      });
    case 'US':
      if (filingFacts.kind !== 'standard') {
        return err(new Error('US tax package export requires standard filing facts'));
      }
      return buildUsTaxPackage({
        context: input.context,
        filingFacts,
        readiness,
        now,
      });
    default:
      return err(
        new Error(`Tax package export is not supported for jurisdiction '${input.scope.config.jurisdiction}'.`)
      );
  }
}

async function backfillArtifactIndexHashes(
  buildResult: TaxPackageBuildResult
): Promise<Result<TaxPackageBuildResult, Error>> {
  const filesByPath = new Map(buildResult.files.map((file) => [file.relativePath, file] as const));
  const manifestFile = filesByPath.get('manifest.json');
  if (!manifestFile) {
    return err(new Error('Tax package build result is missing manifest.json'));
  }

  const artifactIndexResult = withArtifactHashes(buildResult.manifest.artifactIndex, filesByPath);
  if (artifactIndexResult.isErr()) {
    return err(artifactIndexResult.error);
  }

  const manifest: TaxPackageManifest = {
    ...buildResult.manifest,
    artifactIndex: artifactIndexResult.value,
  };
  const files = buildResult.files.map((file) =>
    file.relativePath === manifestFile.relativePath ? { ...file, content: serializeManifest(manifest) } : file
  );

  return ok({
    files,
    manifest,
    status: buildResult.status,
  });
}

function withArtifactHashes(
  artifactIndex: readonly TaxPackageManifest['artifactIndex'][number][],
  filesByPath: ReadonlyMap<string, TaxPackageFile>
): Result<TaxPackageManifest['artifactIndex'], Error> {
  try {
    const hashedEntries = artifactIndex.map((entry) => {
      if (entry.relativePath === 'manifest.json') {
        const { sha256: _ignoredSha256, ...manifestEntry } = entry;
        return manifestEntry;
      }

      const file = filesByPath.get(entry.relativePath);
      if (!file) {
        throw new Error(`Tax package artifact index references missing file '${entry.relativePath}'`);
      }

      return {
        ...entry,
        sha256: sha256Hex(file.content),
      };
    });

    return ok(hashedEntries);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

function serializeManifest(manifest: TaxPackageManifest): string {
  // eslint-disable-next-line unicorn/no-null -- needed here for JSON formatting
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
