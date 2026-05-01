import { err, ok, type Result } from '@exitbook/foundation';
import { z } from 'zod';

export const LedgerLinkingAssetIdentityEvidenceKindSchema = z.enum([
  'manual',
  'seeded',
  'exact_hash_observed',
  'amount_time_observed',
]);

export const LedgerLinkingAssetIdentityRelationshipKindSchema = z.enum([
  'internal_transfer',
  'same_hash_carryover',
  'external_transfer',
]);

export const LedgerLinkingAssetIdentityAssertionSchema = z.object({
  assetIdA: z.string().min(1, 'Asset id A must not be empty'),
  assetIdB: z.string().min(1, 'Asset id B must not be empty'),
  evidenceKind: LedgerLinkingAssetIdentityEvidenceKindSchema,
  relationshipKind: LedgerLinkingAssetIdentityRelationshipKindSchema,
});

export type LedgerLinkingAssetIdentityAssertion = z.infer<typeof LedgerLinkingAssetIdentityAssertionSchema>;
export type LedgerLinkingAssetIdentityEvidenceKind = z.infer<typeof LedgerLinkingAssetIdentityEvidenceKindSchema>;
export type LedgerLinkingAssetIdentityRelationshipKind = z.infer<
  typeof LedgerLinkingAssetIdentityRelationshipKindSchema
>;

export type LedgerLinkingAssetIdentityResolution =
  | {
      reason: 'same_asset_id';
      status: 'accepted';
    }
  | {
      assertion: LedgerLinkingAssetIdentityAssertion;
      reason: 'accepted_assertion';
      status: 'accepted';
    }
  | {
      reason: 'missing_assertion';
      status: 'blocked';
    };

export interface LedgerLinkingAssetIdentityResolver {
  resolve(params: LedgerLinkingAssetIdentityResolutionParams): LedgerLinkingAssetIdentityResolution;
}

export interface LedgerLinkingAssetIdentityAssertionReplacementResult {
  previousCount: number;
  savedCount: number;
}

export interface LedgerLinkingAssetIdentityAssertionSaveResult {
  action: 'created' | 'updated' | 'unchanged';
  assertion: LedgerLinkingAssetIdentityAssertion;
}

export interface ILedgerLinkingAssetIdentityAssertionReader {
  loadLedgerLinkingAssetIdentityAssertions(
    profileId: number
  ): Promise<Result<LedgerLinkingAssetIdentityAssertion[], Error>>;
}

export interface ILedgerLinkingAssetIdentityAssertionStore {
  saveLedgerLinkingAssetIdentityAssertion(
    profileId: number,
    assertion: LedgerLinkingAssetIdentityAssertion
  ): Promise<Result<LedgerLinkingAssetIdentityAssertionSaveResult, Error>>;

  replaceLedgerLinkingAssetIdentityAssertions(
    profileId: number,
    assertions: readonly LedgerLinkingAssetIdentityAssertion[]
  ): Promise<Result<LedgerLinkingAssetIdentityAssertionReplacementResult, Error>>;
}

export interface LedgerLinkingAssetIdentityResolutionParams {
  relationshipKind: LedgerLinkingAssetIdentityAssertion['relationshipKind'];
  sourceAssetId: string;
  targetAssetId: string;
}

export interface LedgerLinkingAssetIdentityPair {
  assetIdA: string;
  assetIdB: string;
}

class AssertionBackedLedgerLinkingAssetIdentityResolver implements LedgerLinkingAssetIdentityResolver {
  private readonly assertionsByKey: ReadonlyMap<string, LedgerLinkingAssetIdentityAssertion>;

  constructor(assertions: readonly LedgerLinkingAssetIdentityAssertion[]) {
    this.assertionsByKey = new Map(
      assertions.map((assertion) => [buildAssertionLookupKey(assertion.relationshipKind, assertion), assertion])
    );
  }

  resolve(params: LedgerLinkingAssetIdentityResolutionParams): LedgerLinkingAssetIdentityResolution {
    if (params.sourceAssetId === params.targetAssetId) {
      return {
        reason: 'same_asset_id',
        status: 'accepted',
      };
    }

    const pair = canonicalizeLedgerLinkingAssetIdentityPair(params.sourceAssetId, params.targetAssetId);
    if (pair.isErr()) {
      return {
        reason: 'missing_assertion',
        status: 'blocked',
      };
    }

    const assertion = this.assertionsByKey.get(buildAssertionLookupKey(params.relationshipKind, pair.value));
    if (assertion === undefined) {
      return {
        reason: 'missing_assertion',
        status: 'blocked',
      };
    }

    return {
      assertion,
      reason: 'accepted_assertion',
      status: 'accepted',
    };
  }
}

export function buildLedgerLinkingAssetIdentityResolver(
  assertions: readonly LedgerLinkingAssetIdentityAssertion[] = []
): Result<LedgerLinkingAssetIdentityResolver, Error> {
  const canonicalAssertions: LedgerLinkingAssetIdentityAssertion[] = [];
  const seenKeys = new Set<string>();

  for (const assertion of assertions) {
    const validation = LedgerLinkingAssetIdentityAssertionSchema.safeParse(assertion);
    if (!validation.success) {
      return err(new Error(`Invalid ledger-linking asset identity assertion: ${validation.error.message}`));
    }

    const canonicalPair = canonicalizeLedgerLinkingAssetIdentityPair(
      validation.data.assetIdA,
      validation.data.assetIdB
    );
    if (canonicalPair.isErr()) {
      return err(canonicalPair.error);
    }

    const canonicalAssertion: LedgerLinkingAssetIdentityAssertion = {
      ...validation.data,
      ...canonicalPair.value,
    };
    const assertionKey = buildAssertionLookupKey(canonicalAssertion.relationshipKind, canonicalAssertion);
    if (seenKeys.has(assertionKey)) {
      return err(
        new Error(
          `Duplicate ledger-linking asset identity assertion for ${canonicalAssertion.relationshipKind}: ${canonicalAssertion.assetIdA} <-> ${canonicalAssertion.assetIdB}`
        )
      );
    }

    seenKeys.add(assertionKey);
    canonicalAssertions.push(canonicalAssertion);
  }

  return ok(new AssertionBackedLedgerLinkingAssetIdentityResolver(canonicalAssertions));
}

export function canonicalizeLedgerLinkingAssetIdentityPair(
  leftAssetId: string,
  rightAssetId: string
): Result<LedgerLinkingAssetIdentityPair, Error> {
  const left = leftAssetId.trim();
  const right = rightAssetId.trim();

  if (left.length === 0 || right.length === 0) {
    return err(new Error('Ledger-linking asset identity assertion asset ids must not be empty'));
  }

  if (left === right) {
    return err(new Error(`Ledger-linking asset identity assertion is unnecessary for identical asset id ${left}`));
  }

  const sortedAssetIds = [left, right].sort();
  const assetIdA = sortedAssetIds[0];
  const assetIdB = sortedAssetIds[1];
  if (assetIdA === undefined || assetIdB === undefined) {
    return err(new Error('Ledger-linking asset identity assertion requires exactly two asset ids'));
  }

  return ok({ assetIdA, assetIdB });
}

function buildAssertionLookupKey(
  relationshipKind: LedgerLinkingAssetIdentityAssertion['relationshipKind'],
  pair: LedgerLinkingAssetIdentityPair
): string {
  return [relationshipKind, pair.assetIdA, pair.assetIdB].join('\0');
}
