import type { TransactionDraft } from '@exitbook/core';
import { computeTxFingerprint as computeCanonicalTxFingerprint } from '@exitbook/core/identity';
import type { Result } from '@exitbook/foundation';

type FingerprintTransactionInput = Pick<
  TransactionDraft,
  'blockchain' | 'identityMaterial' | 'platformKey' | 'platformKind'
>;

export function deriveTransactionFingerprint(
  input: FingerprintTransactionInput,
  accountFingerprint: string
): Result<string, Error> {
  if (input.platformKind === 'blockchain') {
    return computeCanonicalTxFingerprint({
      accountFingerprint,
      platformKey: input.platformKey,
      platformKind: 'blockchain',
      blockchainTransactionHash: input.blockchain?.transaction_hash,
    });
  }

  return computeCanonicalTxFingerprint({
    accountFingerprint,
    platformKey: input.platformKey,
    platformKind: 'exchange',
    componentEventIds: input.identityMaterial?.componentEventIds,
  });
}
