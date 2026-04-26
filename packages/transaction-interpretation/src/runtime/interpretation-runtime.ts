import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import { ZodError } from 'zod';

import { TransactionAnnotationSchema } from '../annotations/annotation-schemas.js';
import {
  canonicalizeDerivedFromTxIds,
  type DerivedFromTxIds,
  type TransactionAnnotation,
} from '../annotations/annotation-types.js';
import type { ITransactionAnnotationDetector } from '../detectors/transaction-annotation-detector.js';
import type { ITransactionAnnotationProfileDetector } from '../detectors/transaction-annotation-profile-detector.js';
import type { ITransactionAnnotationStore } from '../persistence/transaction-annotation-store.js';

import type { TransactionAnnotationDetectorRegistry } from './transaction-annotation-detector-registry.js';
import { TransactionAnnotationProfileDetectorRegistry } from './transaction-annotation-profile-detector-registry.js';
import type { ITransactionInterpretationSourceReader } from './transaction-interpretation-source-reader.js';

const logger = getLogger('transaction-interpretation:runtime');

export interface InterpretationRuntimeDeps {
  annotationStore: ITransactionAnnotationStore;
  registry: TransactionAnnotationDetectorRegistry;
  profileRegistry?: TransactionAnnotationProfileDetectorRegistry | undefined;
  sourceReader: ITransactionInterpretationSourceReader;
}

export interface RunDetectorForTransactionInput {
  detectorId: string;
  accountId: number;
  transactionId: number;
  txFingerprint: string;
}

export interface RunDetectorForProfileInput {
  detectorId: string;
  profileId: number;
}

function formatSchemaError(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
}

function validateAnnotationsForTransaction(
  annotations: readonly TransactionAnnotation[],
  detector: ITransactionAnnotationDetector,
  input: RunDetectorForTransactionInput
): Result<readonly TransactionAnnotation[], Error> {
  for (const annotation of annotations) {
    const parseResult = TransactionAnnotationSchema.safeParse(annotation);
    if (!parseResult.success) {
      return err(
        new Error(
          `Detector '${detector.id}' emitted an invalid annotation for transaction ${input.transactionId}: ` +
            formatSchemaError(parseResult.error)
        )
      );
    }

    if (annotation.accountId !== input.accountId) {
      return err(
        new Error(
          `Detector '${detector.id}' emitted annotation ${annotation.annotationFingerprint} for account ` +
            `${annotation.accountId}, expected ${input.accountId}`
        )
      );
    }

    if (annotation.transactionId !== input.transactionId) {
      return err(
        new Error(
          `Detector '${detector.id}' emitted annotation ${annotation.annotationFingerprint} for transaction ` +
            `${annotation.transactionId}, expected ${input.transactionId}`
        )
      );
    }

    if (annotation.txFingerprint !== input.txFingerprint) {
      return err(
        new Error(
          `Detector '${detector.id}' emitted annotation ${annotation.annotationFingerprint} for txFingerprint ` +
            `${annotation.txFingerprint}, expected ${input.txFingerprint}`
        )
      );
    }

    if (annotation.detectorId !== detector.id) {
      return err(
        new Error(
          `Detector '${detector.id}' emitted annotation ${annotation.annotationFingerprint} tagged with detectorId ` +
            `${annotation.detectorId}`
        )
      );
    }

    if (!detector.kinds.includes(annotation.kind)) {
      return err(
        new Error(
          `Detector '${detector.id}' emitted unsupported kind '${annotation.kind}' for annotation ` +
            `${annotation.annotationFingerprint}`
        )
      );
    }

    if (annotation.derivedFromTxIds.length !== 1 || annotation.derivedFromTxIds[0] !== input.transactionId) {
      return err(
        new Error(
          `Detector '${detector.id}' emitted annotation ${annotation.annotationFingerprint} with derivedFromTxIds ` +
            `[${annotation.derivedFromTxIds.join(', ')}], expected exactly [${input.transactionId}]`
        )
      );
    }
  }

  return ok(annotations);
}

function validateAnnotationsForProfile(
  annotations: readonly TransactionAnnotation[],
  detector: ITransactionAnnotationProfileDetector,
  profileInput: RunDetectorForProfileInput,
  scopeTransactions: readonly {
    accountId: number;
    id: number;
    txFingerprint: string;
  }[]
): Result<readonly TransactionAnnotation[], Error> {
  const transactionsById = new Map(scopeTransactions.map((transaction) => [transaction.id, transaction]));

  for (const annotation of annotations) {
    const parseResult = TransactionAnnotationSchema.safeParse(annotation);
    if (!parseResult.success) {
      return err(
        new Error(
          `Profile detector '${detector.id}' emitted an invalid annotation for profile ${profileInput.profileId}: ` +
            formatSchemaError(parseResult.error)
        )
      );
    }

    if (annotation.detectorId !== detector.id) {
      return err(
        new Error(
          `Profile detector '${detector.id}' emitted annotation ${annotation.annotationFingerprint} tagged with ` +
            `detectorId ${annotation.detectorId}`
        )
      );
    }

    if (!detector.kinds.includes(annotation.kind)) {
      return err(
        new Error(
          `Profile detector '${detector.id}' emitted unsupported kind '${annotation.kind}' for annotation ` +
            `${annotation.annotationFingerprint}`
        )
      );
    }

    const transaction = transactionsById.get(annotation.transactionId);
    if (transaction === undefined) {
      return err(
        new Error(
          `Profile detector '${detector.id}' emitted annotation ${annotation.annotationFingerprint} for transaction ` +
            `${annotation.transactionId}, which is outside profile ${profileInput.profileId}`
        )
      );
    }

    if (annotation.accountId !== transaction.accountId) {
      return err(
        new Error(
          `Profile detector '${detector.id}' emitted annotation ${annotation.annotationFingerprint} for account ` +
            `${annotation.accountId}, expected ${transaction.accountId}`
        )
      );
    }

    if (annotation.txFingerprint !== transaction.txFingerprint) {
      return err(
        new Error(
          `Profile detector '${detector.id}' emitted annotation ${annotation.annotationFingerprint} for txFingerprint ` +
            `${annotation.txFingerprint}, expected ${transaction.txFingerprint}`
        )
      );
    }

    if (!annotation.derivedFromTxIds.includes(annotation.transactionId)) {
      return err(
        new Error(
          `Profile detector '${detector.id}' emitted annotation ${annotation.annotationFingerprint} whose ` +
            `derivedFromTxIds do not include transaction ${annotation.transactionId}`
        )
      );
    }

    for (const derivedTransactionId of annotation.derivedFromTxIds) {
      if (!transactionsById.has(derivedTransactionId)) {
        return err(
          new Error(
            `Profile detector '${detector.id}' emitted annotation ${annotation.annotationFingerprint} with ` +
              `derivedFromTxIds containing transaction ${derivedTransactionId}, which is outside profile ` +
              `${profileInput.profileId}`
          )
        );
      }
    }
  }

  return ok(annotations);
}

function buildDerivedFromTxIdsKey(derivedFromTxIds: DerivedFromTxIds): string {
  return canonicalizeDerivedFromTxIds(derivedFromTxIds).join(',');
}

function groupAnnotationsByDerivedFromTxIds(
  annotations: readonly TransactionAnnotation[]
): Map<string, { annotations: TransactionAnnotation[]; derivedFromTxIds: DerivedFromTxIds }> {
  const groups = new Map<string, { annotations: TransactionAnnotation[]; derivedFromTxIds: DerivedFromTxIds }>();

  for (const annotation of annotations) {
    const derivedFromTxIds = canonicalizeDerivedFromTxIds(annotation.derivedFromTxIds);
    const key = buildDerivedFromTxIdsKey(derivedFromTxIds);
    const existing = groups.get(key);
    if (existing !== undefined) {
      existing.annotations.push(annotation);
      continue;
    }

    groups.set(key, {
      annotations: [annotation],
      derivedFromTxIds,
    });
  }

  return groups;
}

/**
 * Minimal runtime shell. Phase 1 will expand this with batch execution over
 * a transaction set and post-processing detector scheduling. Kept here so
 * package consumers have a stable import path from day one.
 */
export class InterpretationRuntime {
  readonly #annotationStore: ITransactionAnnotationStore;
  readonly #profileRegistry: TransactionAnnotationProfileDetectorRegistry;
  readonly #registry: TransactionAnnotationDetectorRegistry;
  readonly #sourceReader: ITransactionInterpretationSourceReader;

  constructor(deps: InterpretationRuntimeDeps) {
    this.#annotationStore = deps.annotationStore;
    this.#profileRegistry = deps.profileRegistry ?? new TransactionAnnotationProfileDetectorRegistry();
    this.#registry = deps.registry;
    this.#sourceReader = deps.sourceReader;
  }

  async runForTransaction(input: RunDetectorForTransactionInput): Promise<Result<void, Error>> {
    const detector: ITransactionAnnotationDetector | undefined = this.#registry.get(input.detectorId);
    if (detector === undefined) {
      return err(new Error(`Detector '${input.detectorId}' is not registered`));
    }

    const sourceResult = await this.#sourceReader.loadTransactionForInterpretation({
      accountId: input.accountId,
      transactionId: input.transactionId,
    });
    if (sourceResult.isErr()) {
      logger.warn(
        { detectorId: input.detectorId, transactionId: input.transactionId, error: sourceResult.error.message },
        'Failed to load transaction interpretation source'
      );
      return err(sourceResult.error);
    }

    const transaction = sourceResult.value;
    if (transaction === undefined) {
      return err(new Error(`Transaction ${input.transactionId} was not found for account ${input.accountId}`));
    }

    if (transaction.txFingerprint !== input.txFingerprint) {
      return err(
        new Error(
          `Loaded transaction ${input.transactionId} has txFingerprint ${transaction.txFingerprint}, expected ${input.txFingerprint}`
        )
      );
    }

    const runResult = await detector.run({
      accountId: input.accountId,
      transactionId: input.transactionId,
      txFingerprint: input.txFingerprint,
      transaction,
    });

    if (runResult.isErr()) {
      logger.warn(
        { detectorId: input.detectorId, transactionId: input.transactionId, error: runResult.error.message },
        'Detector run failed'
      );
      return err(runResult.error);
    }

    const validationResult = validateAnnotationsForTransaction(runResult.value.annotations, detector, input);
    if (validationResult.isErr()) {
      logger.warn(
        { detectorId: input.detectorId, transactionId: input.transactionId, error: validationResult.error.message },
        'Detector emitted invalid annotation output'
      );
      return err(validationResult.error);
    }

    const replaceResult = await this.#annotationStore.replaceForDetectorInputs({
      detectorId: detector.id,
      derivedFromTxIds: [input.transactionId],
      annotations: validationResult.value,
    });

    if (replaceResult.isErr()) {
      return err(replaceResult.error);
    }

    return ok(undefined);
  }

  async runForProfile(input: RunDetectorForProfileInput): Promise<Result<void, Error>> {
    const detector = this.#profileRegistry.get(input.detectorId);
    if (detector === undefined) {
      return err(new Error(`Profile detector '${input.detectorId}' is not registered`));
    }

    const scopeResult = await this.#sourceReader.loadProfileInterpretationScope({
      profileId: input.profileId,
    });
    if (scopeResult.isErr()) {
      logger.warn(
        { detectorId: input.detectorId, profileId: input.profileId, error: scopeResult.error.message },
        'Failed to load interpretation profile scope'
      );
      return err(scopeResult.error);
    }

    const runResult = await detector.run({
      accounts: scopeResult.value.accounts,
      profileId: input.profileId,
      transactions: scopeResult.value.transactions,
    });
    if (runResult.isErr()) {
      logger.warn(
        { detectorId: input.detectorId, profileId: input.profileId, error: runResult.error.message },
        'Profile detector run failed'
      );
      return err(runResult.error);
    }

    const validationResult = validateAnnotationsForProfile(
      runResult.value.annotations,
      detector,
      input,
      scopeResult.value.transactions.map((transaction) => ({
        accountId: transaction.accountId,
        id: transaction.id,
        txFingerprint: transaction.txFingerprint,
      }))
    );
    if (validationResult.isErr()) {
      logger.warn(
        { detectorId: input.detectorId, profileId: input.profileId, error: validationResult.error.message },
        'Profile detector emitted invalid annotation output'
      );
      return err(validationResult.error);
    }

    const existingAnnotationsResult = await this.#annotationStore.readAnnotations({
      accountIds: scopeResult.value.accounts.map((account) => account.accountId),
      kinds: detector.kinds,
      tiers: ['asserted', 'heuristic'],
    });
    if (existingAnnotationsResult.isErr()) {
      return err(existingAnnotationsResult.error);
    }

    const existingGroups = groupAnnotationsByDerivedFromTxIds(
      existingAnnotationsResult.value.filter((annotation) => annotation.detectorId === detector.id)
    );
    const emittedGroups = groupAnnotationsByDerivedFromTxIds(validationResult.value);

    for (const { annotations, derivedFromTxIds } of emittedGroups.values()) {
      const replaceResult = await this.#annotationStore.replaceForDetectorInputs({
        detectorId: detector.id,
        derivedFromTxIds,
        annotations,
      });
      if (replaceResult.isErr()) {
        return err(replaceResult.error);
      }
    }

    for (const [key, existingGroup] of existingGroups.entries()) {
      if (emittedGroups.has(key)) {
        continue;
      }

      const replaceResult = await this.#annotationStore.replaceForDetectorInputs({
        detectorId: detector.id,
        derivedFromTxIds: existingGroup.derivedFromTxIds,
        annotations: [],
      });
      if (replaceResult.isErr()) {
        return err(replaceResult.error);
      }
    }

    return ok(undefined);
  }
}
