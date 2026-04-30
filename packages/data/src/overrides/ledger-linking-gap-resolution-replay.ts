import { buildLedgerLinkingGapResolutionKey } from '@exitbook/accounting/ledger-linking';
import type { LedgerLinkingGapResolutionKind, OverrideEvent } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import type { OverrideStore } from './override-store.js';

export interface ResolvedLedgerLinkingGapResolution {
  claimedAmount: string;
  postingFingerprint: string;
  reason?: string | undefined;
  remainingAmount: string;
  resolutionKind: LedgerLinkingGapResolutionKind;
  resolvedAt: string;
  reviewId: string;
}

export function replayResolvedLedgerLinkingGapResolutions(
  overrides: readonly OverrideEvent[]
): Result<Map<string, ResolvedLedgerLinkingGapResolution>, Error> {
  const resolvedByKey = new Map<string, ResolvedLedgerLinkingGapResolution>();

  for (const override of overrides) {
    if (override.scope !== 'ledger-linking-gap-resolution-accept') {
      return err(
        new Error(
          `Ledger-linking gap resolution replay received unsupported scope '${override.scope}'. Only 'ledger-linking-gap-resolution-accept' is allowed.`
        )
      );
    }

    if (override.payload.type !== 'ledger_linking_gap_resolution_accept') {
      return err(
        new Error(
          `Ledger-linking gap resolution replay expected payload type 'ledger_linking_gap_resolution_accept' for scope 'ledger-linking-gap-resolution-accept', got '${override.payload.type}'`
        )
      );
    }

    resolvedByKey.set(
      buildLedgerLinkingGapResolutionKey({
        postingFingerprint: override.payload.posting_fingerprint,
      }),
      {
        claimedAmount: override.payload.claimed_amount,
        postingFingerprint: override.payload.posting_fingerprint,
        reason: override.reason,
        remainingAmount: override.payload.remaining_amount,
        resolutionKind: override.payload.resolution_kind,
        resolvedAt: override.created_at,
        reviewId: override.payload.review_id,
      }
    );
  }

  return ok(resolvedByKey);
}

export async function readResolvedLedgerLinkingGapResolutions(
  overrideStore: Pick<OverrideStore, 'exists' | 'readByScopes'>,
  profileKey: string
): Promise<Result<Map<string, ResolvedLedgerLinkingGapResolution>, Error>> {
  if (!overrideStore.exists()) {
    return ok(new Map<string, ResolvedLedgerLinkingGapResolution>());
  }

  const overridesResult = await overrideStore.readByScopes(profileKey, ['ledger-linking-gap-resolution-accept']);
  if (overridesResult.isErr()) {
    return err(
      new Error(`Failed to read ledger-linking gap resolution override events: ${overridesResult.error.message}`)
    );
  }

  return replayResolvedLedgerLinkingGapResolutions(overridesResult.value);
}

export async function readResolvedLedgerLinkingGapResolutionKeys(
  overrideStore: Pick<OverrideStore, 'exists' | 'readByScopes'>,
  profileKey: string
): Promise<Result<Set<string>, Error>> {
  const resolutionsResult = await readResolvedLedgerLinkingGapResolutions(overrideStore, profileKey);
  if (resolutionsResult.isErr()) {
    return err(resolutionsResult.error);
  }

  return ok(new Set(resolutionsResult.value.keys()));
}
