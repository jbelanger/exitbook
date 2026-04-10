import {
  computeResolvedLinkFingerprint,
  type CreateOverrideEventOptions,
  type NewTransactionLink,
  type OverrideEvent,
  type TransactionLink,
} from '@exitbook/core';
import type { OverrideStore } from '@exitbook/data/overrides';
import { err, resultDoAsync, resultTryAsync, type Result } from '@exitbook/foundation';

export interface TransactionFingerprintReader {
  findById(transactionId: number): Promise<Result<{ txFingerprint: string } | undefined, Error>>;
}

export type LinkOverrideIdentity = Pick<
  TransactionLink | NewTransactionLink,
  | 'assetSymbol'
  | 'sourceAmount'
  | 'sourceAssetId'
  | 'sourceMovementFingerprint'
  | 'sourceTransactionId'
  | 'targetAmount'
  | 'targetAssetId'
  | 'targetMovementFingerprint'
  | 'targetTransactionId'
>;

export async function appendLinkOverrideEvent(
  txRepo: TransactionFingerprintReader,
  overrideStore: OverrideStore,
  profileKey: string,
  link: LinkOverrideIdentity,
  reason?: string  
): Promise<Result<OverrideEvent, Error>> {
  return resultDoAsync(async function* () {
    const fingerprints = yield* await resolveFingerprints(txRepo, link);

    return yield* await overrideStore.append({
      profileKey,
      scope: 'link',
      reason,
      payload: {
        type: 'link_override',
        action: 'confirm',
        link_type: 'transfer',
        source_fingerprint: fingerprints.sourceFp,
        target_fingerprint: fingerprints.targetFp,
        asset: link.assetSymbol,
        resolved_link_fingerprint: fingerprints.resolvedLinkFp,
        source_asset_id: link.sourceAssetId,
        target_asset_id: link.targetAssetId,
        source_movement_fingerprint: link.sourceMovementFingerprint,
        target_movement_fingerprint: link.targetMovementFingerprint,
        source_amount: link.sourceAmount.toFixed(),
        target_amount: link.targetAmount.toFixed(),
      },
    } satisfies CreateOverrideEventOptions);
  });
}

export async function appendUnlinkOverrideEvent(
  txRepo: TransactionFingerprintReader,
  overrideStore: OverrideStore,
  profileKey: string,
  link: LinkOverrideIdentity
): Promise<Result<OverrideEvent, Error>> {
  return resultDoAsync(async function* () {
    const fingerprints = yield* await resolveFingerprints(txRepo, link);

    return yield* await overrideStore.append({
      profileKey,
      scope: 'unlink',
      payload: {
        type: 'unlink_override',
        resolved_link_fingerprint: fingerprints.resolvedLinkFp,
      },
    } satisfies CreateOverrideEventOptions);
  });
}

async function resolveFingerprints(
  txRepo: TransactionFingerprintReader,
  link: LinkOverrideIdentity
): Promise<Result<{ resolvedLinkFp: string; sourceFp: string; targetFp: string }, Error>> {
  return resultTryAsync(async function* () {
    const [sourceResult, targetResult] = await Promise.all([
      txRepo.findById(link.sourceTransactionId),
      txRepo.findById(link.targetTransactionId),
    ]);

    const sourceTx = yield* sourceResult;
    const targetTx = yield* targetResult;

    if (!sourceTx || !targetTx) {
      return yield* err(new Error('Source or target transaction not found for override event'));
    }

    const resolvedLinkFp = yield* computeResolvedLinkFingerprint({
      sourceAssetId: link.sourceAssetId,
      targetAssetId: link.targetAssetId,
      sourceMovementFingerprint: link.sourceMovementFingerprint,
      targetMovementFingerprint: link.targetMovementFingerprint,
    });

    return {
      sourceFp: sourceTx.txFingerprint,
      targetFp: targetTx.txFingerprint,
      resolvedLinkFp,
    };
  }, 'Unexpected error resolving fingerprints for override event');
}
