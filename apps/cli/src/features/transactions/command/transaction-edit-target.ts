import { resultDoAsync, type Result } from '@exitbook/foundation';

import { cliErr, type CliFailure } from '../../../cli/command.js';
import {
  getTransactionSelectorErrorExitCode,
  resolveOwnedTransactionSelector,
  type ResolvedTransactionSelector,
} from '../transaction-selector.js';

export interface TransactionEditTarget {
  platformKey: string;
  transactionId: number;
  txFingerprint: string;
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
): Promise<Result<TransactionEditTarget, CliFailure>> {
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

    return toTransactionEditTarget(selectorResult.value);
  });
}

function toTransactionEditTarget(selector: ResolvedTransactionSelector): TransactionEditTarget {
  return {
    platformKey: selector.transaction.platformKey,
    transactionId: selector.transaction.id,
    txFingerprint: selector.transaction.txFingerprint,
  };
}
