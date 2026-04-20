import { err, ok, randomUUID, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { CostBasisDependencyWatermark, CostBasisSnapshotRecord } from '../../ports/cost-basis-persistence.js';
import { hashCostBasisStableValue } from '../cost-basis-stable-hash.js';
import {
  buildCanadaArtifactSnapshotParts,
  fromStoredCanadaArtifact,
} from '../jurisdictions/canada/artifacts/canada-artifact-codec.js';
import type { CostBasisJurisdiction, CostBasisMethod, FiatCurrency } from '../model/cost-basis-config.js';
import type { CostBasisWorkflowResult } from '../workflow/cost-basis-workflow.js';

import { StoredCostBasisArtifactEnvelopeSchema, type StoredArtifactEnvelope } from './artifact-storage-schemas.js';
import type { CostBasisArtifactDebugPayload } from './artifact-storage-shared.js';
import {
  buildStandardDebugPayload,
  fromStoredDebug,
  fromStoredStandardArtifact,
  resolveStoredCostBasisCalculationWindow,
  toStoredStandardArtifact,
  toStoredStandardDebug,
} from './standard-artifact-codec.js';

const logger = getLogger('cost-basis.artifacts.storage');

export type { CostBasisArtifactDebugPayload } from './artifact-storage-shared.js';

interface CostBasisSnapshotBuildResult {
  artifact: CostBasisWorkflowResult;
  debug: CostBasisArtifactDebugPayload;
  snapshot: CostBasisSnapshotRecord;
  scopeKey: string;
  snapshotId: string;
}

interface CostBasisArtifactReuseResult {
  artifact: CostBasisWorkflowResult;
  debug: CostBasisArtifactDebugPayload;
  snapshotId: string;
}

interface CostBasisArtifactFreshnessResult {
  status: 'fresh' | 'stale';
  reason?: string | undefined;
}

export const COST_BASIS_STORAGE_SCHEMA_VERSION = 4;
export const COST_BASIS_CALCULATION_ENGINE_VERSION = 1;

export function buildAccountingExclusionFingerprint(excludedAssetIds: ReadonlySet<string>): string {
  const sorted = [...excludedAssetIds].sort();
  if (sorted.length === 0) {
    return 'excluded-assets:none';
  }

  return `excluded-assets:${hashCostBasisStableValue(JSON.stringify(sorted))}`;
}

export function evaluateCostBasisArtifactFreshness(
  snapshot: CostBasisSnapshotRecord,
  watermark: CostBasisDependencyWatermark
): CostBasisArtifactFreshnessResult {
  if (snapshot.storageSchemaVersion !== COST_BASIS_STORAGE_SCHEMA_VERSION) {
    return { status: 'stale', reason: 'storage-schema-version-mismatch' };
  }

  if (snapshot.calculationEngineVersion !== COST_BASIS_CALCULATION_ENGINE_VERSION) {
    return { status: 'stale', reason: 'calculation-engine-version-mismatch' };
  }

  if (watermark.links.status !== 'fresh' || !watermark.links.lastBuiltAt) {
    return { status: 'stale', reason: 'links-not-fresh' };
  }

  if (watermark.assetReview.status !== 'fresh' || !watermark.assetReview.lastBuiltAt) {
    return { status: 'stale', reason: 'asset-review-not-fresh' };
  }

  if (watermark.links.lastBuiltAt.getTime() !== snapshot.linksBuiltAt.getTime()) {
    return { status: 'stale', reason: 'links-built-at-mismatch' };
  }

  if (watermark.assetReview.lastBuiltAt.getTime() !== snapshot.assetReviewBuiltAt.getTime()) {
    return { status: 'stale', reason: 'asset-review-built-at-mismatch' };
  }

  if (
    (watermark.pricesLastMutatedAt?.getTime() ?? undefined) !== (snapshot.pricesLastMutatedAt?.getTime() ?? undefined)
  ) {
    return { status: 'stale', reason: 'prices-last-mutated-at-mismatch' };
  }

  if (watermark.exclusionFingerprint !== snapshot.exclusionFingerprint) {
    return { status: 'stale', reason: 'exclusion-fingerprint-mismatch' };
  }

  return { status: 'fresh' };
}

export function buildCostBasisSnapshotRecord(
  artifact: CostBasisWorkflowResult,
  dependencyWatermark: CostBasisDependencyWatermark,
  scopeKey: string
): Result<CostBasisSnapshotBuildResult, Error> {
  if (!dependencyWatermark.links.lastBuiltAt || !dependencyWatermark.assetReview.lastBuiltAt) {
    return err(new Error('Cannot persist a cost-basis snapshot without fresh upstream projection timestamps'));
  }

  const snapshotId = randomUUID();
  const createdAt = new Date();
  let debug: CostBasisArtifactDebugPayload;
  let envelope: StoredArtifactEnvelope;
  let displayCurrency: FiatCurrency;
  let endDate: string;
  let jurisdiction: CostBasisJurisdiction;
  let method: CostBasisMethod;
  let startDate: string;
  let taxYear: number;

  if (artifact.kind === 'standard-workflow') {
    const calculationWindowResult = resolveStoredCostBasisCalculationWindow(artifact.summary.calculation);
    if (calculationWindowResult.isErr()) {
      return err(calculationWindowResult.error);
    }

    const standardDebug = buildStandardDebugPayload(artifact);
    envelope = {
      artifactKind: 'standard',
      storageSchemaVersion: COST_BASIS_STORAGE_SCHEMA_VERSION,
      calculationEngineVersion: COST_BASIS_CALCULATION_ENGINE_VERSION,
      scopeKey,
      snapshotId,
      calculationId: artifact.summary.calculation.id,
      createdAt: createdAt.toISOString(),
      artifact: toStoredStandardArtifact(artifact, calculationWindowResult.value),
      debug: toStoredStandardDebug(standardDebug),
    };
    debug = standardDebug;
    jurisdiction = artifact.summary.calculation.config.jurisdiction;
    method = artifact.summary.calculation.config.method;
    taxYear = artifact.summary.calculation.config.taxYear;
    displayCurrency = artifact.summary.calculation.config.currency;
    startDate = calculationWindowResult.value.startDate.toISOString();
    endDate = calculationWindowResult.value.endDate.toISOString();
  } else {
    const canadaSnapshotPartsResult = buildCanadaArtifactSnapshotParts(artifact);
    if (canadaSnapshotPartsResult.isErr()) {
      return err(canadaSnapshotPartsResult.error);
    }

    const canadaSnapshotParts = canadaSnapshotPartsResult.value;
    envelope = {
      artifactKind: 'canada',
      storageSchemaVersion: COST_BASIS_STORAGE_SCHEMA_VERSION,
      calculationEngineVersion: COST_BASIS_CALCULATION_ENGINE_VERSION,
      scopeKey,
      snapshotId,
      calculationId: canadaSnapshotParts.metadata.calculationId,
      createdAt: createdAt.toISOString(),
      artifact: canadaSnapshotParts.artifact,
      debug: canadaSnapshotParts.debug,
    };
    debug = canadaSnapshotParts.debugPayload;
    jurisdiction = canadaSnapshotParts.metadata.jurisdiction;
    method = canadaSnapshotParts.metadata.method;
    taxYear = canadaSnapshotParts.metadata.taxYear;
    displayCurrency = canadaSnapshotParts.metadata.displayCurrency;
    startDate = canadaSnapshotParts.metadata.startDate;
    endDate = canadaSnapshotParts.metadata.endDate;
  }

  const parsedEnvelope = StoredCostBasisArtifactEnvelopeSchema.safeParse(envelope);
  if (!parsedEnvelope.success) {
    return err(new Error(`Invalid stored cost-basis artifact envelope: ${parsedEnvelope.error.message}`));
  }

  const snapshot: CostBasisSnapshotRecord = {
    scopeKey,
    snapshotId,
    storageSchemaVersion: COST_BASIS_STORAGE_SCHEMA_VERSION,
    calculationEngineVersion: COST_BASIS_CALCULATION_ENGINE_VERSION,
    artifactKind: envelope.artifactKind,
    linksBuiltAt: dependencyWatermark.links.lastBuiltAt,
    assetReviewBuiltAt: dependencyWatermark.assetReview.lastBuiltAt,
    ...(dependencyWatermark.pricesLastMutatedAt
      ? { pricesLastMutatedAt: dependencyWatermark.pricesLastMutatedAt }
      : {}),
    exclusionFingerprint: dependencyWatermark.exclusionFingerprint,
    calculationId: envelope.calculationId,
    jurisdiction,
    method,
    taxYear,
    displayCurrency,
    startDate,
    endDate,
    artifactJson: JSON.stringify(envelope.artifact),
    debugJson: JSON.stringify(envelope.debug),
    createdAt,
    updatedAt: createdAt,
  };

  return ok({
    artifact,
    debug,
    snapshot,
    scopeKey,
    snapshotId,
  });
}

export function readCostBasisSnapshotArtifact(
  snapshot: CostBasisSnapshotRecord
): Result<CostBasisArtifactReuseResult, Error> {
  let parsedArtifactJson: unknown;
  let parsedDebugJson: unknown;

  try {
    parsedArtifactJson = JSON.parse(snapshot.artifactJson) as unknown;
    parsedDebugJson = JSON.parse(snapshot.debugJson) as unknown;
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }

  const envelopeResult = StoredCostBasisArtifactEnvelopeSchema.safeParse({
    artifactKind: snapshot.artifactKind,
    storageSchemaVersion: snapshot.storageSchemaVersion,
    calculationEngineVersion: snapshot.calculationEngineVersion,
    scopeKey: snapshot.scopeKey,
    snapshotId: snapshot.snapshotId,
    calculationId: snapshot.calculationId,
    createdAt: snapshot.createdAt.toISOString(),
    artifact: parsedArtifactJson,
    debug: parsedDebugJson,
  });
  if (!envelopeResult.success) {
    logger.warn(
      { scopeKey: snapshot.scopeKey, snapshotId: snapshot.snapshotId, error: envelopeResult.error.format() },
      'Stored cost-basis snapshot could not be parsed'
    );
    return err(new Error(`Unreadable stored cost-basis artifact: ${envelopeResult.error.message}`));
  }

  const envelope = envelopeResult.data;
  const artifact =
    envelope.artifactKind === 'standard'
      ? fromStoredStandardArtifact(envelope.artifact)
      : fromStoredCanadaArtifact(envelope.artifact);
  const debug = fromStoredDebug(envelope.debug);

  return ok({
    artifact,
    debug,
    snapshotId: snapshot.snapshotId,
  });
}
