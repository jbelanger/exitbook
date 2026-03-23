import type { TransactionDraft } from '@exitbook/core';
import { computeTxFingerprint as computeCanonicalTxFingerprint } from '@exitbook/core/identity';
import type { Result } from '@exitbook/foundation';

type FingerprintTransactionInput = Pick<TransactionDraft, 'blockchain' | 'identityMaterial' | 'source' | 'sourceType'>;

export function deriveTransactionFingerprint(
  input: FingerprintTransactionInput,
  accountFingerprint: string
): Result<string, Error> {
  if (input.sourceType === 'blockchain') {
    return computeCanonicalTxFingerprint({
      accountFingerprint,
      source: input.source,
      sourceType: 'blockchain',
      blockchainTransactionHash: input.blockchain?.transaction_hash,
    });
  }

  return computeCanonicalTxFingerprint({
    accountFingerprint,
    source: input.source,
    sourceType: 'exchange',
    componentEventIds: input.identityMaterial?.componentEventIds,
  });
}
