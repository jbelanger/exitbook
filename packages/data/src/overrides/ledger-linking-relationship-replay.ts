import {
  buildReviewedLedgerLinkingRelationshipStableKey,
  type LedgerLinkingReviewedRelationshipAllocationOverride,
  LedgerLinkingReviewedRelationshipOverrideSchema,
  type LedgerLinkingReviewedRelationshipOverride,
} from '@exitbook/accounting/ledger-linking';
import type { OverrideEvent } from '@exitbook/core';
import { err, ok, parseCurrency, tryParseDecimal, type Result } from '@exitbook/foundation';
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

    const allocationsResult = parseReviewedOverrideAllocations(override);
    if (allocationsResult.isErr()) {
      return err(allocationsResult.error);
    }

    const reviewedOverride = LedgerLinkingReviewedRelationshipOverrideSchema.safeParse({
      acceptedAt: override.created_at,
      allocations: allocationsResult.value,
      evidence: override.payload.evidence,
      overrideEventId: override.id,
      proposalKind: override.payload.proposal_kind,
      relationshipKind: override.payload.relationship_kind,
      reviewId: override.payload.review_id,
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

function parseReviewedOverrideAllocations(
  override: OverrideEvent
): Result<LedgerLinkingReviewedRelationshipAllocationOverride[], Error> {
  if (override.payload.type !== 'ledger_linking_relationship_accept') {
    return err(
      new Error(
        `Ledger-linking relationship replay expected payload type 'ledger_linking_relationship_accept' for allocation parsing, got '${override.payload.type}'`
      )
    );
  }

  const allocations: LedgerLinkingReviewedRelationshipAllocationOverride[] = [];

  for (const allocation of override.payload.allocations) {
    const assetSymbolResult = parseCurrency(allocation.asset_symbol);
    if (assetSymbolResult.isErr()) {
      return err(
        new Error(
          `Invalid ledger-linking relationship override ${override.id}: ${allocation.allocation_side} allocation ${allocation.posting_fingerprint} asset symbol is invalid`
        )
      );
    }

    const parsed = { value: new Decimal(0) };
    if (!tryParseDecimal(allocation.quantity, parsed) || !parsed.value.gt(0)) {
      return err(
        new Error(
          `Invalid ledger-linking relationship override ${override.id}: ${allocation.allocation_side} allocation ${allocation.posting_fingerprint} quantity must be positive`
        )
      );
    }

    allocations.push({
      allocationSide: allocation.allocation_side,
      assetId: allocation.asset_id,
      assetSymbol: assetSymbolResult.value,
      journalFingerprint: allocation.journal_fingerprint,
      postingFingerprint: allocation.posting_fingerprint,
      quantity: parsed.value,
      sourceActivityFingerprint: allocation.source_activity_fingerprint,
    });
  }

  return ok(allocations);
}

function compareReviewedOverrides(
  left: LedgerLinkingReviewedRelationshipOverride,
  right: LedgerLinkingReviewedRelationshipOverride
): number {
  return (
    left.relationshipKind.localeCompare(right.relationshipKind) ||
    left.proposalKind.localeCompare(right.proposalKind) ||
    compareFirstAllocation(left, right)
  );
}

function compareFirstAllocation(
  left: LedgerLinkingReviewedRelationshipOverride,
  right: LedgerLinkingReviewedRelationshipOverride
): number {
  const leftAllocation = left.allocations[0];
  const rightAllocation = right.allocations[0];

  if (leftAllocation === undefined || rightAllocation === undefined) {
    return left.allocations.length - right.allocations.length;
  }

  return (
    leftAllocation.allocationSide.localeCompare(rightAllocation.allocationSide) ||
    leftAllocation.postingFingerprint.localeCompare(rightAllocation.postingFingerprint) ||
    leftAllocation.quantity.cmp(rightAllocation.quantity)
  );
}
