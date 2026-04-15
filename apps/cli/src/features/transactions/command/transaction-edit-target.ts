import type { Transaction } from '@exitbook/core';
import { resultDoAsync, type Result } from '@exitbook/foundation';

import { cliErr, type CliFailure } from '../../../cli/command.js';
import {
  formatTransactionFingerprintRef,
  getTransactionSelectorErrorExitCode,
  resolveOwnedTransactionSelector,
  type ResolvedTransactionSelector,
} from '../transaction-selector.js';

export interface TransactionEditTarget {
  accountId: number;
  platformKey: string;
  transactionId: number;
  txFingerprint: string;
  txRef: string;
}

export interface TransactionEditTransactionSummary {
  platformKey: string;
  txFingerprint: string;
  txRef: string;
}

export interface ResolvedTransactionEditTarget {
  target: TransactionEditTarget;
  transaction: Transaction;
}

interface TransactionEditTargetLookup {
  findByFingerprintRef(
    profileId: number,
    fingerprintRef: string
  ): ReturnType<Parameters<typeof resolveOwnedTransactionSelector>[0]['getByFingerprintRef']>;
}

export async function resolveTransactionEditTarget(
  transactionService: TransactionEditTargetLookup,
  profileId: number,
  selector: string
): Promise<Result<ResolvedTransactionEditTarget, CliFailure>> {
  return resultDoAsync(async function* () {
    const selectorResult = await resolveOwnedTransactionSelector(
      {
        getByFingerprintRef: (ownerProfileId, fingerprintRef) =>
          transactionService.findByFingerprintRef(ownerProfileId, fingerprintRef),
      },
      profileId,
      selector
    );
    if (selectorResult.isErr()) {
      return yield* cliErr(selectorResult.error, getTransactionSelectorErrorExitCode(selectorResult.error));
    }

    return {
      target: toTransactionEditTarget(selectorResult.value),
      transaction: selectorResult.value.transaction,
    };
  });
}

function toTransactionEditTarget(selector: ResolvedTransactionSelector): TransactionEditTarget {
  return {
    accountId: selector.transaction.accountId,
    platformKey: selector.transaction.platformKey,
    transactionId: selector.transaction.id,
    txFingerprint: selector.transaction.txFingerprint,
    txRef: formatTransactionFingerprintRef(selector.transaction.txFingerprint),
  };
}

export function toTransactionEditTransactionSummary(target: TransactionEditTarget): TransactionEditTransactionSummary {
  return {
    platformKey: target.platformKey,
    txFingerprint: target.txFingerprint,
    txRef: target.txRef,
  };
}
