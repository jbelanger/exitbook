import { getMovementRole, type Transaction } from '@exitbook/core';

import type { TransactionAnnotation } from '../annotations/annotation-types.js';
import { deriveOperationLabel } from '../labels/derive-operation-label.js';

const ALLOCATION_UNCERTAIN_DIAGNOSTIC_CODES = new Set(['allocation_uncertain']);
const UNKNOWN_CLASSIFICATION_DIAGNOSTIC_CODES = new Set(['classification_uncertain', 'classification_failed']);

export type TransactionReadinessIssueCode = 'uncertain_proceeds_allocation' | 'unknown_classification';

export interface TransactionReadinessIssue {
  code: TransactionReadinessIssueCode;
  diagnosticCode: string;
  diagnosticMessage: string;
}

function getAssertedTransactionAnnotations(
  annotations: readonly TransactionAnnotation[]
): readonly TransactionAnnotation[] {
  return annotations.filter((annotation) => annotation.tier === 'asserted');
}

export function collectTransactionReadinessIssues(
  transaction: Pick<Transaction, 'diagnostics' | 'movements' | 'operation'>,
  annotations: readonly TransactionAnnotation[] = []
): TransactionReadinessIssue[] {
  const issues: TransactionReadinessIssue[] = [];
  const derivedOperation = deriveOperationLabel(transaction, getAssertedTransactionAnnotations(annotations));

  const unknownClassificationDiagnostic = transaction.diagnostics?.find((diagnostic) =>
    UNKNOWN_CLASSIFICATION_DIAGNOSTIC_CODES.has(diagnostic.code)
  );
  if (
    unknownClassificationDiagnostic !== undefined &&
    derivedOperation.source !== 'annotation' &&
    !hasOnlyRoleExplainedMovements(transaction)
  ) {
    issues.push({
      code: 'unknown_classification',
      diagnosticCode: unknownClassificationDiagnostic.code,
      diagnosticMessage: unknownClassificationDiagnostic.message,
    });
  }

  const allocationUncertainDiagnostic = transaction.diagnostics?.find((diagnostic) =>
    ALLOCATION_UNCERTAIN_DIAGNOSTIC_CODES.has(diagnostic.code)
  );
  if (allocationUncertainDiagnostic !== undefined) {
    issues.push({
      code: 'uncertain_proceeds_allocation',
      diagnosticCode: allocationUncertainDiagnostic.code,
      diagnosticMessage: allocationUncertainDiagnostic.message,
    });
  }

  return issues;
}

function hasOnlyRoleExplainedMovements(transaction: Pick<Transaction, 'movements'>): boolean {
  const movements = [...(transaction.movements.inflows ?? []), ...(transaction.movements.outflows ?? [])];

  return movements.length > 0 && movements.every((movement) => getMovementRole(movement) !== 'principal');
}
