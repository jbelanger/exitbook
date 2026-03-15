import { err, ok, type Result } from '@exitbook/core';

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

async function backfillArtifactIndexHashes(
  buildResult: TaxPackageBuildResult
): Promise<Result<TaxPackageBuildResult, Error>> {
  const filesByPath = new Map(buildResult.files.map((file) => [file.relativePath, file] as const));
  const manifestFile = filesByPath.get('manifest.json');
  if (!manifestFile) {
    return err(new Error('Tax package build result is missing manifest.json'));
  }

  const artifactIndexResult = await withArtifactHashes(buildResult.manifest.artifactIndex, filesByPath);
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

async function withArtifactHashes(
  artifactIndex: readonly TaxPackageManifest['artifactIndex'][number][],
  filesByPath: ReadonlyMap<string, TaxPackageFile>
): Promise<Result<TaxPackageManifest['artifactIndex'], Error>> {
  try {
    const hashedEntries = await Promise.all(
      artifactIndex.map(async (entry) => {
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
          sha256: await computeSha256(file.content),
        };
      })
    );

    return ok(hashedEntries);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

function serializeManifest(manifest: TaxPackageManifest): string {
  // eslint-disable-next-line unicorn/no-null -- needed here for JSON formatting
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function computeSha256(content: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
