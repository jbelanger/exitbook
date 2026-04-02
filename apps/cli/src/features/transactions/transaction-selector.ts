import { AmbiguousTransactionFingerprintRefError, type Transaction } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import { z } from 'zod';

import { ExitCodes, type ExitCode } from '../../cli/exit-codes.js';

export const TRANSACTION_FINGERPRINT_REF_LENGTH = 10;
export const TransactionSelectorValueSchema = z.string().trim().min(1);

interface TransactionSelectorService {
  getByFingerprintRef(profileId: number, fingerprintRef: string): Promise<Result<Transaction | undefined, Error>>;
}

export interface ResolvedTransactionSelector {
  transaction: Transaction;
  kind: 'ref';
  value: string;
}

export class TransactionSelectorResolutionError extends Error {
  readonly kind: 'ambiguous' | 'missing' | 'not-found';

  constructor(kind: 'ambiguous' | 'missing' | 'not-found', message: string) {
    super(message);
    this.kind = kind;
    this.name = 'TransactionSelectorResolutionError';
  }
}

function normalizeTransactionSelectorValue(value: string): string {
  return value.trim().toLowerCase();
}

export function formatTransactionFingerprintRef(txFingerprint: string): string {
  if (txFingerprint.length <= TRANSACTION_FINGERPRINT_REF_LENGTH) {
    return txFingerprint;
  }

  return txFingerprint.slice(0, TRANSACTION_FINGERPRINT_REF_LENGTH);
}

export function buildTransactionSelectorFilters(selector: ResolvedTransactionSelector | undefined): {
  transaction?: string | undefined;
} {
  if (!selector) {
    return {};
  }

  return { transaction: selector.value };
}

export async function resolveOwnedTransactionSelector(
  transactionService: TransactionSelectorService,
  profileId: number,
  selector: string
): Promise<Result<ResolvedTransactionSelector, Error>> {
  const normalizedRef = normalizeTransactionSelectorValue(selector);
  const transactionResult = await transactionService.getByFingerprintRef(profileId, normalizedRef);

  if (transactionResult.isErr()) {
    if (transactionResult.error instanceof AmbiguousTransactionFingerprintRefError) {
      const matchSuffix =
        transactionResult.error.matches.length > 0
          ? ` Matches include: ${transactionResult.error.matches.join(', ')}`
          : '';

      return err(
        new TransactionSelectorResolutionError(
          'ambiguous',
          `Transaction selector '${normalizedRef}' is ambiguous. Use a longer fingerprint prefix.${matchSuffix}`
        )
      );
    }

    return err(transactionResult.error);
  }

  if (!transactionResult.value) {
    return err(new TransactionSelectorResolutionError('not-found', `Transaction ref '${normalizedRef}' not found`));
  }

  return ok({
    transaction: transactionResult.value,
    kind: 'ref',
    value: normalizedRef,
  });
}

export function getTransactionSelectorErrorExitCode(error: Error): ExitCode {
  if (!(error instanceof TransactionSelectorResolutionError)) {
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
