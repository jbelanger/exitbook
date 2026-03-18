import type { Result } from '@exitbook/core';
import type { TransactionDraft } from '@exitbook/core';
import { computeTxFingerprint as computeCanonicalTxFingerprint } from '@exitbook/core/identity';

export async function deriveProcessedTransactionFingerprint(
  input: TransactionDraft,
  accountFingerprint: string
): Promise<Result<string, Error>> {
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
