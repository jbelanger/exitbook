/* eslint-disable unicorn/no-null -- null required by Kysely for nullable columns */
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import type { ControlledTransaction, Insertable, Selectable } from '@exitbook/sqlite';
import {
  ANNOTATION_KINDS,
  ANNOTATION_PROVENANCE_INPUTS,
  ANNOTATION_ROLES,
  canonicalizeDerivedFromTxIds as canonicalizeDerivedFromTxIdsArray,
  type AnnotationKind,
  type AnnotationProvenanceInput,
  type AnnotationRole,
  type DerivedFromTxIds,
  type ReplaceByDetectorGroupInput,
  type ReplaceByDetectorInput,
  type ReplaceByTransactionInput,
  type ITransactionAnnotationStore,
  type TransactionAnnotation,
  type TransactionAnnotationQuery,
  toDerivedFromTxIds,
} from '@exitbook/transaction-interpretation';

import type { DatabaseSchema, TransactionAnnotationsTable } from '../database-schema.js';
import type { KyselyDB } from '../database.js';
import { BaseRepository } from '../repositories/base-repository.js';
import { withControlledTransaction } from '../utils/controlled-transaction.js';

type AnnotationRow = Selectable<TransactionAnnotationsTable>;
type AnnotationStoreExecutor = KyselyDB | ControlledTransaction<DatabaseSchema>;

const KIND_SET: ReadonlySet<AnnotationKind> = new Set(ANNOTATION_KINDS);
const ROLE_SET: ReadonlySet<AnnotationRole> = new Set(ANNOTATION_ROLES);
const PROVENANCE_SET: ReadonlySet<AnnotationProvenanceInput> = new Set(ANNOTATION_PROVENANCE_INPUTS);

/**
 * Canonical JSON for `derived_from_tx_ids`. Sorted ascending so reprocess
 * replacement-by-inputs can match by literal column equality even if detectors
 * emit the ids in different orders across runs.
 */
function canonicalizeDerivedFromTxIds(ids: DerivedFromTxIds): string {
  const sorted = canonicalizeDerivedFromTxIdsArray(ids);
  return JSON.stringify(sorted);
}

function canonicalizeProvenanceInputs(inputs: readonly AnnotationProvenanceInput[]): string {
  const sorted = [...inputs].sort();
  return JSON.stringify(sorted);
}

function serializeMetadata(metadata: Record<string, unknown> | undefined): Result<string | null, Error> {
  if (metadata === undefined) return ok(null);
  try {
    return ok(JSON.stringify(metadata));
  } catch (error) {
    return wrapError(error, 'Failed to serialize annotation metadata');
  }
}

function parseDerivedFromTxIds(raw: string): Result<DerivedFromTxIds, Error> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return wrapError(error, 'Failed to parse derived_from_tx_ids_json');
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return err(new Error('derived_from_tx_ids_json must be a non-empty array'));
  }
  for (const id of parsed) {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      return err(new Error(`derived_from_tx_ids_json contains invalid id: ${JSON.stringify(id)}`));
    }
  }
  return toDerivedFromTxIds(parsed);
}

function parseProvenanceInputs(raw: string): Result<readonly AnnotationProvenanceInput[], Error> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return wrapError(error, 'Failed to parse provenance_inputs_json');
  }

  if (!Array.isArray(parsed)) {
    return err(new Error('provenance_inputs_json must be an array'));
  }
  for (const entry of parsed) {
    if (typeof entry !== 'string' || !PROVENANCE_SET.has(entry as AnnotationProvenanceInput)) {
      return err(new Error(`provenance_inputs_json contains unknown entry: ${JSON.stringify(entry)}`));
    }
  }
  return ok(parsed as readonly AnnotationProvenanceInput[]);
}

function parseMetadata(raw: string | null): Result<Record<string, unknown> | undefined, Error> {
  if (raw === null) return ok(undefined);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return wrapError(error, 'Failed to parse annotation metadata_json');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return err(new Error('metadata_json must be a JSON object'));
  }
  return ok(parsed as Record<string, unknown>);
}

function requireStoredJsonString(value: unknown, field: string): Result<string, Error> {
  if (typeof value !== 'string') {
    return err(new Error(`${field} must be a JSON string in storage`));
  }
  return ok(value);
}

function requireNullableStoredJsonString(value: unknown, field: string): Result<string | null, Error> {
  if (value === null) {
    return ok(null);
  }
  if (typeof value !== 'string') {
    return err(new Error(`${field} must be a JSON string in storage`));
  }
  return ok(value);
}

function rowToAnnotation(row: AnnotationRow): Result<TransactionAnnotation, Error> {
  if (!KIND_SET.has(row.kind)) {
    return err(new Error(`Stored annotation row has unknown kind: ${row.kind}`));
  }
  if (row.role !== null && !ROLE_SET.has(row.role)) {
    return err(new Error(`Stored annotation row has unknown role: ${row.role}`));
  }

  const derivedFromTxIdsJsonResult = requireStoredJsonString(row.derived_from_tx_ids_json, 'derived_from_tx_ids_json');
  if (derivedFromTxIdsJsonResult.isErr()) return err(derivedFromTxIdsJsonResult.error);

  const derivedFromTxIdsResult = parseDerivedFromTxIds(derivedFromTxIdsJsonResult.value);
  if (derivedFromTxIdsResult.isErr()) return err(derivedFromTxIdsResult.error);

  const provenanceJsonResult = requireStoredJsonString(row.provenance_inputs_json, 'provenance_inputs_json');
  if (provenanceJsonResult.isErr()) return err(provenanceJsonResult.error);

  const provenanceResult = parseProvenanceInputs(provenanceJsonResult.value);
  if (provenanceResult.isErr()) return err(provenanceResult.error);

  const metadataJsonResult = requireNullableStoredJsonString(row.metadata_json, 'metadata_json');
  if (metadataJsonResult.isErr()) return err(metadataJsonResult.error);

  const metadataResult = parseMetadata(metadataJsonResult.value);
  if (metadataResult.isErr()) return err(metadataResult.error);

  let target: TransactionAnnotation['target'];
  if (row.target_scope === 'movement') {
    if (row.movement_fingerprint === null) {
      return err(new Error('Stored movement-scoped annotation is missing movement_fingerprint'));
    }
    target = { scope: 'movement', movementFingerprint: row.movement_fingerprint };
  } else {
    target = { scope: 'transaction' };
  }

  const annotation: TransactionAnnotation = {
    annotationFingerprint: row.annotation_fingerprint,
    accountId: row.account_id,
    transactionId: row.transaction_id,
    txFingerprint: row.tx_fingerprint,
    kind: row.kind,
    tier: row.tier,
    target,
    detectorId: row.detector_id,
    derivedFromTxIds: derivedFromTxIdsResult.value,
    provenanceInputs: provenanceResult.value,
    ...(row.protocol_ref_id === null
      ? {}
      : {
          protocolRef: {
            id: row.protocol_ref_id,
            ...(row.protocol_ref_version === null ? {} : { version: row.protocol_ref_version }),
          },
        }),
    ...(row.role === null ? {} : { role: row.role }),
    ...(row.group_key === null ? {} : { groupKey: row.group_key }),
    ...(metadataResult.value === undefined ? {} : { metadata: metadataResult.value }),
  };

  return ok(annotation);
}

type AnnotationInsertRow = Insertable<TransactionAnnotationsTable>;

function annotationToInsert(annotation: TransactionAnnotation, now: string): Result<AnnotationInsertRow, Error> {
  const metadataResult = serializeMetadata(annotation.metadata);
  if (metadataResult.isErr()) return err(metadataResult.error);

  return ok({
    annotation_fingerprint: annotation.annotationFingerprint,
    account_id: annotation.accountId,
    transaction_id: annotation.transactionId,
    tx_fingerprint: annotation.txFingerprint,
    target_scope: annotation.target.scope,
    movement_fingerprint: annotation.target.scope === 'movement' ? annotation.target.movementFingerprint : null,
    kind: annotation.kind,
    tier: annotation.tier,
    role: annotation.role ?? null,
    protocol_ref_id: annotation.protocolRef?.id ?? null,
    protocol_ref_version: annotation.protocolRef?.version ?? null,
    group_key: annotation.groupKey ?? null,
    detector_id: annotation.detectorId,
    derived_from_tx_ids_json: canonicalizeDerivedFromTxIds(annotation.derivedFromTxIds),
    provenance_inputs_json: canonicalizeProvenanceInputs(annotation.provenanceInputs),
    metadata_json: metadataResult.value,
    created_at: now,
    updated_at: null,
  });
}

export class TransactionAnnotationStore extends BaseRepository implements ITransactionAnnotationStore {
  constructor(db: KyselyDB) {
    super(db, 'transaction-annotation-store');
  }

  async readAnnotations(query: TransactionAnnotationQuery): Promise<Result<readonly TransactionAnnotation[], Error>> {
    if (query.kinds.length === 0) {
      return err(new Error('TransactionAnnotationQuery.kinds must not be empty'));
    }
    if (query.tiers.length === 0) {
      return err(new Error('TransactionAnnotationQuery.tiers must not be empty'));
    }

    try {
      let builder = this.db
        .selectFrom('transaction_annotations')
        .selectAll()
        .where('kind', 'in', query.kinds)
        .where('tier', 'in', query.tiers);

      if (query.accountId !== undefined) {
        builder = builder.where('account_id', '=', query.accountId);
      }
      if (query.accountIds !== undefined) {
        if (query.accountIds.length === 0) {
          return ok([]);
        }
        builder = builder.where('account_id', 'in', query.accountIds);
      }
      if (query.transactionId !== undefined) {
        builder = builder.where('transaction_id', '=', query.transactionId);
      }
      if (query.transactionIds !== undefined) {
        if (query.transactionIds.length === 0) {
          return ok([]);
        }
        builder = builder.where('transaction_id', 'in', query.transactionIds);
      }
      if (query.protocolRefId !== undefined) {
        builder = builder.where('protocol_ref_id', '=', query.protocolRefId);
      }
      if (query.groupKey !== undefined) {
        builder = builder.where('group_key', '=', query.groupKey);
      }

      const rows = await builder.execute();
      const out: TransactionAnnotation[] = [];
      for (const row of rows) {
        const mapped = rowToAnnotation(row);
        if (mapped.isErr()) return err(mapped.error);
        out.push(mapped.value);
      }
      return ok(out);
    } catch (error) {
      this.logger.error({ error }, 'Failed to read annotations');
      return wrapError(error, 'Failed to read annotations');
    }
  }

  async replaceForTransaction(input: ReplaceByTransactionInput): Promise<Result<void, Error>> {
    const validationResult = this.validateTransactionScopedReplacement(input);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    return this.replaceAnnotations(
      async (trx) => {
        await trx.deleteFrom('transaction_annotations').where('transaction_id', '=', input.transactionId).execute();
      },
      input.annotations,
      'Failed to replace annotations for transaction'
    );
  }

  async replaceForDetectorInputs(input: ReplaceByDetectorInput): Promise<Result<void, Error>> {
    const canonicalKey = canonicalizeDerivedFromTxIds(input.derivedFromTxIds);

    const validationResult = this.validateDetectorInputsReplacement(input, canonicalKey);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    return this.replaceAnnotations(
      async (trx) => {
        await trx
          .deleteFrom('transaction_annotations')
          .where('detector_id', '=', input.detectorId)
          .where('derived_from_tx_ids_json', '=', canonicalKey)
          .execute();
      },
      input.annotations,
      'Failed to replace annotations for detector inputs'
    );
  }

  async replaceForDetectorGroup(input: ReplaceByDetectorGroupInput): Promise<Result<void, Error>> {
    const validationResult = this.validateDetectorGroupReplacement(input);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    return this.replaceAnnotations(
      async (trx) => {
        await trx
          .deleteFrom('transaction_annotations')
          .where('detector_id', '=', input.detectorId)
          .where('account_id', '=', input.accountId)
          .where('group_key', '=', input.groupKey)
          .execute();
      },
      input.annotations,
      'Failed to replace annotations for detector group'
    );
  }

  private validateTransactionScopedReplacement(input: ReplaceByTransactionInput): Result<void, Error> {
    for (const annotation of input.annotations) {
      if (annotation.transactionId !== input.transactionId) {
        return err(
          new Error(
            `Annotation ${annotation.annotationFingerprint} targets transaction ${annotation.transactionId} ` +
              `but replacement scope is transaction ${input.transactionId}`
          )
        );
      }
    }

    return ok(undefined);
  }

  private validateDetectorInputsReplacement(input: ReplaceByDetectorInput, canonicalKey: string): Result<void, Error> {
    for (const annotation of input.annotations) {
      if (annotation.detectorId !== input.detectorId) {
        return err(
          new Error(
            `Annotation ${annotation.annotationFingerprint} tagged with detector ${annotation.detectorId} ` +
              `does not match replacement detector ${input.detectorId}`
          )
        );
      }
      if (canonicalizeDerivedFromTxIds(annotation.derivedFromTxIds) !== canonicalKey) {
        return err(
          new Error(`Annotation ${annotation.annotationFingerprint} derivedFromTxIds do not match the replacement key`)
        );
      }
    }

    return ok(undefined);
  }

  private validateDetectorGroupReplacement(input: ReplaceByDetectorGroupInput): Result<void, Error> {
    for (const annotation of input.annotations) {
      if (annotation.detectorId !== input.detectorId) {
        return err(
          new Error(
            `Annotation ${annotation.annotationFingerprint} tagged with detector ${annotation.detectorId} ` +
              `does not match replacement detector ${input.detectorId}`
          )
        );
      }
      if (annotation.accountId !== input.accountId) {
        return err(
          new Error(
            `Annotation ${annotation.annotationFingerprint} for account ${annotation.accountId} ` +
              `does not match replacement account ${input.accountId}`
          )
        );
      }
      if (annotation.groupKey !== input.groupKey) {
        return err(
          new Error(
            `Annotation ${annotation.annotationFingerprint} groupKey ${annotation.groupKey ?? '<undefined>'} ` +
              `does not match replacement groupKey ${input.groupKey}`
          )
        );
      }
    }

    return ok(undefined);
  }

  private async replaceAnnotations(
    deleteExisting: (trx: ControlledTransaction<DatabaseSchema>) => Promise<void>,
    annotations: readonly TransactionAnnotation[],
    errorContext: string
  ): Promise<Result<void, Error>> {
    return withControlledTransaction(
      this.db,
      this.logger,
      async (trx) => {
        await deleteExisting(trx);
        return this.insertAnnotations(trx, annotations);
      },
      errorContext
    );
  }

  private async insertAnnotations(
    db: AnnotationStoreExecutor,
    annotations: readonly TransactionAnnotation[]
  ): Promise<Result<void, Error>> {
    if (annotations.length === 0) return ok(undefined);

    const now = new Date().toISOString();
    const values: AnnotationInsertRow[] = [];
    for (const annotation of annotations) {
      const row = annotationToInsert(annotation, now);
      if (row.isErr()) return err(row.error);
      values.push(row.value);
    }

    try {
      await db.insertInto('transaction_annotations').values(values).execute();
      return ok(undefined);
    } catch (error) {
      this.logger.error({ error }, 'Failed to insert annotations');
      return wrapError(error, 'Failed to insert annotations');
    }
  }
}
