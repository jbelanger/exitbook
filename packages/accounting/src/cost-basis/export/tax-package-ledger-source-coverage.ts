import { err, ok, type Result } from '@exitbook/foundation';

import type {
  CostBasisLedgerContext,
  CostBasisLedgerJournal,
  CostBasisLedgerPosting,
  CostBasisLedgerRelationship,
  CostBasisLedgerSourceActivity,
} from '../../ports/cost-basis-ledger-persistence.js';

export interface TaxPackageLedgerSourceActivityCoverageRef {
  ownerAccountId: number;
  reference: string;
  sourceActivityFingerprint: string;
}

export interface TaxPackageLedgerJournalCoverageRef {
  journalFingerprint: string;
  reference: string;
  sourceActivityFingerprint: string;
}

export interface TaxPackageLedgerPostingCoverageRef {
  journalFingerprint: string;
  postingFingerprint: string;
  reference: string;
}

export interface TaxPackageLedgerRelationshipCoverageRef {
  reference: string;
  relationshipStableKey: string;
}

export interface TaxPackageLedgerSourceCoverageRequest {
  journalRefs: TaxPackageLedgerJournalCoverageRef[];
  postingRefs: TaxPackageLedgerPostingCoverageRef[];
  relationshipRefs: TaxPackageLedgerRelationshipCoverageRef[];
  sourceActivityRefs: TaxPackageLedgerSourceActivityCoverageRef[];
}

interface IndexedLedgerSourceContext {
  journalsByFingerprint: ReadonlyMap<string, CostBasisLedgerJournal>;
  postingsByFingerprint: ReadonlyMap<string, CostBasisLedgerPosting>;
  relationshipsByStableKey: ReadonlyMap<string, CostBasisLedgerRelationship>;
  sourceActivitiesByFingerprint: ReadonlyMap<string, CostBasisLedgerSourceActivity>;
  accountIds: ReadonlySet<number>;
}

export function validateTaxPackageLedgerSourceCoverage(
  ledgerContext: CostBasisLedgerContext,
  request: TaxPackageLedgerSourceCoverageRequest
): Result<void, Error> {
  const indexedContextResult = buildIndexedLedgerSourceContext(ledgerContext);
  if (indexedContextResult.isErr()) {
    return err(indexedContextResult.error);
  }

  const indexedContext = indexedContextResult.value;
  for (const sourceActivityRef of request.sourceActivityRefs) {
    const sourceActivityResult = validateLedgerSourceActivityRef(indexedContext, {
      expectedOwnerAccountId: sourceActivityRef.ownerAccountId,
      reference: sourceActivityRef.reference,
      sourceActivityFingerprint: sourceActivityRef.sourceActivityFingerprint,
    });
    if (sourceActivityResult.isErr()) {
      return err(sourceActivityResult.error);
    }
  }

  for (const journalRef of request.journalRefs) {
    const journal = indexedContext.journalsByFingerprint.get(journalRef.journalFingerprint);
    if (!journal) {
      return err(new Error(`Missing ledger journal ${journalRef.journalFingerprint} for ${journalRef.reference}`));
    }
    if (journal.sourceActivityFingerprint !== journalRef.sourceActivityFingerprint) {
      return err(
        new Error(
          `Ledger journal ${journalRef.journalFingerprint} source activity ${journal.sourceActivityFingerprint} ` +
            `does not match expected source activity ${journalRef.sourceActivityFingerprint} for ${journalRef.reference}`
        )
      );
    }

    const sourceActivityResult = validateLedgerSourceActivityRef(indexedContext, {
      reference: journalRef.reference,
      sourceActivityFingerprint: journalRef.sourceActivityFingerprint,
    });
    if (sourceActivityResult.isErr()) {
      return err(sourceActivityResult.error);
    }
  }

  for (const postingRef of request.postingRefs) {
    const posting = indexedContext.postingsByFingerprint.get(postingRef.postingFingerprint);
    if (!posting) {
      return err(new Error(`Missing ledger posting ${postingRef.postingFingerprint} for ${postingRef.reference}`));
    }
    if (!indexedContext.journalsByFingerprint.has(postingRef.journalFingerprint)) {
      return err(
        new Error(
          `Missing ledger journal ${postingRef.journalFingerprint} for ledger posting ` +
            `${postingRef.postingFingerprint} referenced by ${postingRef.reference}`
        )
      );
    }
    if (posting.journalFingerprint !== postingRef.journalFingerprint) {
      return err(
        new Error(
          `Ledger posting ${postingRef.postingFingerprint} journal ${posting.journalFingerprint} ` +
            `does not match expected journal ${postingRef.journalFingerprint} for ${postingRef.reference}`
        )
      );
    }
  }

  for (const relationshipRef of request.relationshipRefs) {
    if (!indexedContext.relationshipsByStableKey.has(relationshipRef.relationshipStableKey)) {
      return err(
        new Error(
          `Missing ledger relationship ${relationshipRef.relationshipStableKey} for ${relationshipRef.reference}`
        )
      );
    }
  }

  return ok(undefined);
}

function validateLedgerSourceActivityRef(
  indexedContext: IndexedLedgerSourceContext,
  params: {
    expectedOwnerAccountId?: number | undefined;
    reference: string;
    sourceActivityFingerprint: string;
  }
): Result<void, Error> {
  const sourceActivity = indexedContext.sourceActivitiesByFingerprint.get(params.sourceActivityFingerprint);
  if (!sourceActivity) {
    return err(new Error(`Missing ledger source activity ${params.sourceActivityFingerprint} for ${params.reference}`));
  }
  if (params.expectedOwnerAccountId !== undefined && sourceActivity.ownerAccountId !== params.expectedOwnerAccountId) {
    return err(
      new Error(
        `Ledger source activity ${params.sourceActivityFingerprint} owner account ` +
          `${sourceActivity.ownerAccountId} does not match expected owner account ` +
          `${params.expectedOwnerAccountId} for ${params.reference}`
      )
    );
  }
  if (!indexedContext.accountIds.has(sourceActivity.ownerAccountId)) {
    return err(
      new Error(
        `Missing account ${sourceActivity.ownerAccountId} for ledger source activity ` +
          `${params.sourceActivityFingerprint} referenced by ${params.reference}`
      )
    );
  }

  return ok(undefined);
}

function buildIndexedLedgerSourceContext(
  ledgerContext: CostBasisLedgerContext
): Result<IndexedLedgerSourceContext, Error> {
  const sourceActivitiesByFingerprintResult = buildUniqueStringMap(
    ledgerContext.sourceActivities,
    (sourceActivity) => sourceActivity.sourceActivityFingerprint,
    'ledger source activity fingerprint'
  );
  if (sourceActivitiesByFingerprintResult.isErr()) {
    return err(sourceActivitiesByFingerprintResult.error);
  }

  const journalsByFingerprintResult = buildUniqueStringMap(
    ledgerContext.journals,
    (journal) => journal.journalFingerprint,
    'ledger journal fingerprint'
  );
  if (journalsByFingerprintResult.isErr()) {
    return err(journalsByFingerprintResult.error);
  }

  const postingsByFingerprintResult = buildUniqueStringMap(
    ledgerContext.postings,
    (posting) => posting.postingFingerprint,
    'ledger posting fingerprint'
  );
  if (postingsByFingerprintResult.isErr()) {
    return err(postingsByFingerprintResult.error);
  }

  const relationshipsByStableKeyResult = buildUniqueStringMap(
    ledgerContext.relationships,
    (relationship) => relationship.relationshipStableKey,
    'ledger relationship stable key'
  );
  if (relationshipsByStableKeyResult.isErr()) {
    return err(relationshipsByStableKeyResult.error);
  }

  return ok({
    sourceActivitiesByFingerprint: sourceActivitiesByFingerprintResult.value,
    journalsByFingerprint: journalsByFingerprintResult.value,
    postingsByFingerprint: postingsByFingerprintResult.value,
    relationshipsByStableKey: relationshipsByStableKeyResult.value,
    accountIds: new Set(ledgerContext.accounts.map((account) => account.id)),
  });
}

function buildUniqueStringMap<T>(
  values: readonly T[],
  getKey: (value: T) => string,
  label: string
): Result<ReadonlyMap<string, T>, Error> {
  const map = new Map<string, T>();
  for (const value of [...values].sort((left, right) => getKey(left).localeCompare(getKey(right)))) {
    const key = getKey(value);
    if (map.has(key)) {
      return err(new Error(`Duplicate ${label} ${key} in tax-package ledger source context`));
    }
    map.set(key, value);
  }

  return ok(map);
}
