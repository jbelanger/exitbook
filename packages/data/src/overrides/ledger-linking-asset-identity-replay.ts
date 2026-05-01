import {
  canonicalizeLedgerLinkingAssetIdentityPair,
  LedgerLinkingAssetIdentityAssertionSchema,
  type ILedgerLinkingAssetIdentityAssertionStore,
  type LedgerLinkingAssetIdentityAssertion,
  type LedgerLinkingAssetIdentityAssertionReplacementResult,
} from '@exitbook/accounting/ledger-linking';
import type { OverrideEvent } from '@exitbook/core';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';

import type { OverrideStore } from './override-store.js';

const LEDGER_LINKING_ASSET_IDENTITY_SCOPES = [
  'ledger-linking-asset-identity-accept',
  'ledger-linking-asset-identity-revoke',
] as const;

/**
 * Replay accepted ledger-linking asset identity override events.
 *
 * Latest event wins per relationship kind and canonical asset-id pair.
 */
export function replayLedgerLinkingAssetIdentityAssertionOverrides(
  overrides: readonly OverrideEvent[]
): Result<LedgerLinkingAssetIdentityAssertion[], Error> {
  const assertionsByKey = new Map<string, LedgerLinkingAssetIdentityAssertion>();

  for (const override of overrides) {
    if (
      override.scope !== 'ledger-linking-asset-identity-accept' &&
      override.scope !== 'ledger-linking-asset-identity-revoke'
    ) {
      return err(
        new Error(
          `Ledger-linking asset identity replay received unsupported scope '${override.scope}'. Only ledger-linking asset identity accept/revoke scopes are allowed.`
        )
      );
    }

    if (override.scope === 'ledger-linking-asset-identity-revoke') {
      if (override.payload.type !== 'ledger_linking_asset_identity_revoke') {
        return err(
          new Error(
            `Ledger-linking asset identity replay expected payload type 'ledger_linking_asset_identity_revoke' for scope 'ledger-linking-asset-identity-revoke', got '${override.payload.type}'`
          )
        );
      }

      const revokeKey = buildAssertionOverrideKeyFromParts({
        assetIdA: override.payload.asset_id_a,
        assetIdB: override.payload.asset_id_b,
        relationshipKind: override.payload.relationship_kind,
      });
      if (revokeKey.isErr()) {
        return err(revokeKey.error);
      }

      assertionsByKey.delete(revokeKey.value);
      continue;
    }

    if (override.payload.type !== 'ledger_linking_asset_identity_accept') {
      return err(
        new Error(
          `Ledger-linking asset identity replay expected payload type 'ledger_linking_asset_identity_accept' for scope 'ledger-linking-asset-identity-accept', got '${override.payload.type}'`
        )
      );
    }

    const canonicalPair = canonicalizeLedgerLinkingAssetIdentityPair(
      override.payload.asset_id_a,
      override.payload.asset_id_b
    );
    if (canonicalPair.isErr()) {
      return err(canonicalPair.error);
    }

    const assertion = LedgerLinkingAssetIdentityAssertionSchema.safeParse({
      assetIdA: canonicalPair.value.assetIdA,
      assetIdB: canonicalPair.value.assetIdB,
      evidenceKind: override.payload.evidence_kind,
      relationshipKind: override.payload.relationship_kind,
    });
    if (!assertion.success) {
      return err(
        new Error(`Invalid ledger-linking asset identity override ${override.id}: ${assertion.error.message}`)
      );
    }

    assertionsByKey.set(buildAssertionOverrideKey(assertion.data), assertion.data);
  }

  return ok([...assertionsByKey.values()].sort(compareAssertions));
}

export async function readLedgerLinkingAssetIdentityAssertionOverrides(
  overrideStore: Pick<OverrideStore, 'exists' | 'readByScopes'>,
  profileKey: string
): Promise<Result<LedgerLinkingAssetIdentityAssertion[], Error>> {
  if (!overrideStore.exists()) {
    return ok([]);
  }

  const overridesResult = await overrideStore.readByScopes(profileKey, [...LEDGER_LINKING_ASSET_IDENTITY_SCOPES]);
  if (overridesResult.isErr()) {
    return err(
      new Error(`Failed to read ledger-linking asset identity override events: ${overridesResult.error.message}`)
    );
  }

  return replayLedgerLinkingAssetIdentityAssertionOverrides(overridesResult.value);
}

export async function materializeStoredLedgerLinkingAssetIdentityAssertions(
  assertionStore: Pick<ILedgerLinkingAssetIdentityAssertionStore, 'replaceLedgerLinkingAssetIdentityAssertions'>,
  overrideStore: Pick<OverrideStore, 'exists' | 'readByScopes'>,
  profileId: number,
  profileKey: string
): Promise<Result<LedgerLinkingAssetIdentityAssertionReplacementResult, Error>> {
  return resultDoAsync(async function* () {
    const assertions = yield* await readLedgerLinkingAssetIdentityAssertionOverrides(overrideStore, profileKey);

    return yield* await assertionStore.replaceLedgerLinkingAssetIdentityAssertions(profileId, assertions);
  });
}

function buildAssertionOverrideKey(assertion: LedgerLinkingAssetIdentityAssertion): string {
  return [assertion.relationshipKind, assertion.assetIdA, assertion.assetIdB].join('\0');
}

function buildAssertionOverrideKeyFromParts(input: {
  assetIdA: string;
  assetIdB: string;
  relationshipKind: string;
}): Result<string, Error> {
  const canonicalPair = canonicalizeLedgerLinkingAssetIdentityPair(input.assetIdA, input.assetIdB);
  if (canonicalPair.isErr()) {
    return err(canonicalPair.error);
  }

  const assertion = LedgerLinkingAssetIdentityAssertionSchema.safeParse({
    assetIdA: canonicalPair.value.assetIdA,
    assetIdB: canonicalPair.value.assetIdB,
    evidenceKind: 'manual',
    relationshipKind: input.relationshipKind,
  });
  if (!assertion.success) {
    return err(new Error(`Invalid ledger-linking asset identity revoke override: ${assertion.error.message}`));
  }

  return ok(buildAssertionOverrideKey(assertion.data));
}

function compareAssertions(
  left: LedgerLinkingAssetIdentityAssertion,
  right: LedgerLinkingAssetIdentityAssertion
): number {
  return (
    left.relationshipKind.localeCompare(right.relationshipKind) ||
    left.assetIdA.localeCompare(right.assetIdA) ||
    left.assetIdB.localeCompare(right.assetIdB)
  );
}
