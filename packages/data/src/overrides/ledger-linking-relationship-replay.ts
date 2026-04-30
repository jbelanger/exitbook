import {
  buildReviewedLedgerLinkingRelationshipStableKey,
  LedgerLinkingReviewedRelationshipOverrideSchema,
  type LedgerLinkingReviewedRelationshipOverride,
} from '@exitbook/accounting/ledger-linking';
import type { OverrideEvent } from '@exitbook/core';
import { err, ok, tryParseDecimal, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

import type { OverrideStore } from './override-store.js';

const LEDGER_LINKING_RELATIONSHIP_SCOPES = ['ledger-linking-relationship-accept'] as const;

export function replayLedgerLinkingRelationshipOverrides(
  overrides: readonly OverrideEvent[]
): Result<LedgerLinkingReviewedRelationshipOverride[], Error> {
  const reviewedOverridesByRelationshipKey = new Map<string, LedgerLinkingReviewedRelationshipOverride>();

  for (const override of overrides) {
    if (override.scope !== 'ledger-linking-relationship-accept') {
      return err(
        new Error(
          `Ledger-linking relationship replay received unsupported scope '${override.scope}'. Only 'ledger-linking-relationship-accept' is allowed.`
        )
      );
    }

    if (override.payload.type !== 'ledger_linking_relationship_accept') {
      return err(
        new Error(
          `Ledger-linking relationship replay expected payload type 'ledger_linking_relationship_accept' for scope 'ledger-linking-relationship-accept', got '${override.payload.type}'`
        )
      );
    }

    const quantityResult = parsePositiveOverrideQuantity(override);
    if (quantityResult.isErr()) {
      return err(quantityResult.error);
    }

    const reviewedOverride = LedgerLinkingReviewedRelationshipOverrideSchema.safeParse({
      acceptedAt: override.created_at,
      assetIdentityReason: override.payload.asset_identity_reason,
      assetSymbol: override.payload.asset_symbol,
      overrideEventId: override.id,
      proposalKind: override.payload.proposal_kind,
      proposalUniqueness: override.payload.proposal_uniqueness,
      quantity: quantityResult.value,
      relationshipKind: override.payload.relationship_kind,
      reviewId: override.payload.review_id,
      sourceActivityFingerprint: override.payload.source_activity_fingerprint,
      sourceAssetId: override.payload.source_asset_id,
      sourceJournalFingerprint: override.payload.source_journal_fingerprint,
      sourcePostingFingerprint: override.payload.source_posting_fingerprint,
      targetActivityFingerprint: override.payload.target_activity_fingerprint,
      targetAssetId: override.payload.target_asset_id,
      targetJournalFingerprint: override.payload.target_journal_fingerprint,
      targetPostingFingerprint: override.payload.target_posting_fingerprint,
      timeDirection: override.payload.time_direction,
      timeDistanceSeconds: override.payload.time_distance_seconds,
    });
    if (!reviewedOverride.success) {
      return err(
        new Error(`Invalid ledger-linking relationship override ${override.id}: ${reviewedOverride.error.message}`)
      );
    }

    reviewedOverridesByRelationshipKey.set(
      buildReviewedLedgerLinkingRelationshipStableKey(reviewedOverride.data),
      reviewedOverride.data
    );
  }

  return ok([...reviewedOverridesByRelationshipKey.values()].sort(compareReviewedOverrides));
}

export async function readLedgerLinkingRelationshipOverrides(
  overrideStore: Pick<OverrideStore, 'exists' | 'readByScopes'>,
  profileKey: string
): Promise<Result<LedgerLinkingReviewedRelationshipOverride[], Error>> {
  if (!overrideStore.exists()) {
    return ok([]);
  }

  const overridesResult = await overrideStore.readByScopes(profileKey, [...LEDGER_LINKING_RELATIONSHIP_SCOPES]);
  if (overridesResult.isErr()) {
    return err(
      new Error(`Failed to read ledger-linking relationship override events: ${overridesResult.error.message}`)
    );
  }

  return replayLedgerLinkingRelationshipOverrides(overridesResult.value);
}

function parsePositiveOverrideQuantity(override: OverrideEvent): Result<Decimal, Error> {
  if (override.payload.type !== 'ledger_linking_relationship_accept') {
    return err(
      new Error(
        `Ledger-linking relationship replay expected payload type 'ledger_linking_relationship_accept' for quantity parsing, got '${override.payload.type}'`
      )
    );
  }

  const parsed = { value: new Decimal(0) };
  if (!tryParseDecimal(override.payload.quantity, parsed) || !parsed.value.gt(0)) {
    return err(new Error(`Invalid ledger-linking relationship override ${override.id}: quantity must be positive`));
  }

  return ok(parsed.value);
}

function compareReviewedOverrides(
  left: LedgerLinkingReviewedRelationshipOverride,
  right: LedgerLinkingReviewedRelationshipOverride
): number {
  return (
    left.relationshipKind.localeCompare(right.relationshipKind) ||
    left.sourcePostingFingerprint.localeCompare(right.sourcePostingFingerprint) ||
    left.targetPostingFingerprint.localeCompare(right.targetPostingFingerprint) ||
    left.quantity.cmp(right.quantity)
  );
}
