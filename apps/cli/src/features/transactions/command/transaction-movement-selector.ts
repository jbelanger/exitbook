import { formatMovementFingerprintRef, getMovementRole, type AssetMovement, type Transaction } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import { ExitCodes, type ExitCode } from '../../../cli/exit-codes.js';

export interface ResolvedTransactionMovementSelector {
  direction: 'inflow' | 'outflow';
  movement: AssetMovement;
  movementRef: string;
}

export interface TransactionEditMovementSummary {
  assetSymbol: string;
  direction: ResolvedTransactionMovementSelector['direction'];
  movementFingerprint: string;
  movementRef: string;
}

export class TransactionMovementSelectorResolutionError extends Error {
  readonly kind: 'ambiguous' | 'missing' | 'not-found';

  constructor(kind: 'ambiguous' | 'missing' | 'not-found', message: string) {
    super(message);
    this.kind = kind;
    this.name = 'TransactionMovementSelectorResolutionError';
  }
}

function normalizeMovementSelectorValue(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveTransactionMovementSelector(
  transaction: Transaction,
  selector: string
): Result<ResolvedTransactionMovementSelector, Error> {
  const normalizedSelector = normalizeMovementSelectorValue(selector);
  if (normalizedSelector.length === 0) {
    return err(new TransactionMovementSelectorResolutionError('missing', 'Movement ref must not be empty'));
  }

  const matches = [
    ...(transaction.movements.inflows ?? []).map((movement) => ({ direction: 'inflow' as const, movement })),
    ...(transaction.movements.outflows ?? []).map((movement) => ({ direction: 'outflow' as const, movement })),
  ].filter(({ movement }) => formatMovementFingerprintRef(movement.movementFingerprint) === normalizedSelector);

  if (matches.length === 0) {
    return err(
      new TransactionMovementSelectorResolutionError(
        'not-found',
        `Movement ref '${normalizedSelector}' not found on transaction ${transaction.txFingerprint}`
      )
    );
  }

  if (matches.length > 1) {
    return err(
      new TransactionMovementSelectorResolutionError(
        'ambiguous',
        `Movement ref '${normalizedSelector}' is ambiguous on transaction ${transaction.txFingerprint}`
      )
    );
  }

  const match = matches[0]!;
  return ok({
    direction: match.direction,
    movement: match.movement,
    movementRef: formatMovementFingerprintRef(match.movement.movementFingerprint),
  });
}

export function getTransactionMovementSelectorErrorExitCode(error: Error): ExitCode {
  if (!(error instanceof TransactionMovementSelectorResolutionError)) {
    return ExitCodes.GENERAL_ERROR;
  }

  switch (error.kind) {
    case 'not-found':
      return ExitCodes.NOT_FOUND;
    case 'ambiguous':
    case 'missing':
      return ExitCodes.INVALID_ARGS;
  }
}

export function formatResolvedMovementSummary(selection: ResolvedTransactionMovementSelector): string {
  const directionLabel = selection.direction === 'inflow' ? '+' : '-';
  const role = getMovementRole(selection.movement);
  const roleSuffix = role === 'principal' ? '' : ` [${role}]`;
  return `${directionLabel} ${selection.movement.grossAmount.toFixed()} ${selection.movement.assetSymbol}${roleSuffix}`;
}

export function toTransactionEditMovementSummary(
  selection: ResolvedTransactionMovementSelector
): TransactionEditMovementSummary {
  return {
    assetSymbol: selection.movement.assetSymbol,
    direction: selection.direction,
    movementFingerprint: selection.movement.movementFingerprint,
    movementRef: selection.movementRef,
  };
}
