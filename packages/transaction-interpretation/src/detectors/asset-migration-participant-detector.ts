import {
  getPossibleAssetMigrationGroupKey,
  transactionHasDiagnosticCode,
  POSSIBLE_ASSET_MIGRATION_DIAGNOSTIC_CODE,
  type Transaction,
} from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import { computeAnnotationFingerprint, type AnnotationRole, type TransactionAnnotation } from '../annotations/index.js';

import type {
  DetectorInput,
  DetectorOutput,
  ITransactionAnnotationDetector,
} from './transaction-annotation-detector.js';

const DETECTOR_ID = 'asset-migration-participant';

interface AssetMigrationMetadata extends Record<string, unknown> {
  providerSubtype?: string | undefined;
}

function getMigrationRole(transaction: Transaction): AnnotationRole | undefined {
  const inflowCount = transaction.movements.inflows?.length ?? 0;
  const outflowCount = transaction.movements.outflows?.length ?? 0;

  if (inflowCount > 0 && outflowCount === 0) {
    return 'target';
  }

  if (outflowCount > 0 && inflowCount === 0) {
    return 'source';
  }

  return undefined;
}

function getMigrationDiagnostic(transaction: Transaction): NonNullable<Transaction['diagnostics']>[number] | undefined {
  return transaction.diagnostics?.find((diagnostic) => diagnostic.code === POSSIBLE_ASSET_MIGRATION_DIAGNOSTIC_CODE);
}

function buildMigrationMetadata(
  diagnostic: NonNullable<Transaction['diagnostics']>[number]
): AssetMigrationMetadata | undefined {
  const providerSubtype = diagnostic.metadata?.['providerSubtype'];
  if (typeof providerSubtype !== 'string') {
    return undefined;
  }

  const normalized = providerSubtype.trim();
  return normalized.length === 0 ? undefined : { providerSubtype: normalized };
}

function buildAssetMigrationAnnotation(input: DetectorInput): Result<TransactionAnnotation | undefined, Error> {
  if (!transactionHasDiagnosticCode(input.transaction, POSSIBLE_ASSET_MIGRATION_DIAGNOSTIC_CODE)) {
    return ok(undefined);
  }

  const role = getMigrationRole(input.transaction);
  if (role === undefined) {
    return ok(undefined);
  }

  const groupKey = getPossibleAssetMigrationGroupKey(input.transaction.diagnostics);
  if (groupKey === undefined) {
    return ok(undefined);
  }

  const diagnostic = getMigrationDiagnostic(input.transaction);
  if (diagnostic === undefined) {
    return ok(undefined);
  }

  const metadata = buildMigrationMetadata(diagnostic);
  const annotationFingerprintResult = computeAnnotationFingerprint({
    kind: 'asset_migration_participant',
    tier: 'heuristic',
    txFingerprint: input.txFingerprint,
    target: { scope: 'transaction' },
    role,
    groupKey,
    ...(metadata === undefined ? {} : { metadata }),
  });
  if (annotationFingerprintResult.isErr()) {
    return err(annotationFingerprintResult.error);
  }

  return ok({
    annotationFingerprint: annotationFingerprintResult.value,
    accountId: input.accountId,
    transactionId: input.transactionId,
    txFingerprint: input.txFingerprint,
    kind: 'asset_migration_participant',
    tier: 'heuristic',
    target: { scope: 'transaction' },
    role,
    groupKey,
    detectorId: DETECTOR_ID,
    derivedFromTxIds: [input.transactionId],
    provenanceInputs: ['diagnostic'],
    ...(metadata === undefined ? {} : { metadata }),
  });
}

export class AssetMigrationParticipantDetector implements ITransactionAnnotationDetector {
  readonly id = DETECTOR_ID;
  readonly kinds = ['asset_migration_participant'] as const;

  async run(input: DetectorInput): Promise<Result<DetectorOutput, Error>> {
    const annotationResult = buildAssetMigrationAnnotation(input);
    if (annotationResult.isErr()) {
      return err(annotationResult.error);
    }

    return ok({
      annotations: annotationResult.value === undefined ? [] : [annotationResult.value],
    });
  }
}
