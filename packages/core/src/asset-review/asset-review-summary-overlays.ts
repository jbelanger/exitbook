import { sha256Hex } from '@exitbook/foundation';

import type { AssetReviewEvidence, AssetReviewSummary } from './asset-review.js';

export function applyAssetExclusionsToReviewSummary(
  summary: AssetReviewSummary,
  excludedAssetIds: ReadonlySet<string>
): AssetReviewSummary {
  if (excludedAssetIds.size === 0 || !summary.evidence.some((item) => item.kind === 'same-symbol-ambiguity')) {
    return summary;
  }

  const evidence = summary.evidence.flatMap((item) =>
    sanitizeAmbiguityEvidence(summary.assetId, item, excludedAssetIds)
  );
  const evidenceFingerprint = computeEvidenceFingerprint(summary.assetId, evidence, summary.referenceStatus);
  const confirmationIsStale =
    evidence.length > 0 &&
    summary.confirmedEvidenceFingerprint !== undefined &&
    summary.confirmedEvidenceFingerprint !== evidenceFingerprint;
  const reviewStatus = deriveReviewStatus(evidence, summary.confirmedEvidenceFingerprint, evidenceFingerprint);

  return {
    ...summary,
    reviewStatus,
    evidenceFingerprint,
    confirmationIsStale,
    accountingBlocked: deriveAccountingBlocked(evidence, reviewStatus),
    warningSummary: evidence.length > 0 ? evidence.map((item) => item.message).join('; ') : undefined,
    evidence,
  };
}

function sanitizeAmbiguityEvidence(
  assetId: string,
  evidence: AssetReviewEvidence,
  excludedAssetIds: ReadonlySet<string>
): AssetReviewEvidence[] {
  if (evidence.kind !== 'same-symbol-ambiguity') {
    return [evidence];
  }

  const conflictingAssetIds = evidence.metadata?.['conflictingAssetIds'];
  if (!Array.isArray(conflictingAssetIds) || conflictingAssetIds.some((item) => typeof item !== 'string')) {
    return [evidence];
  }

  const remainingConflictingAssetIds = conflictingAssetIds.filter(
    (conflictingAssetId): conflictingAssetId is string =>
      typeof conflictingAssetId === 'string' && !excludedAssetIds.has(conflictingAssetId)
  );

  if (!remainingConflictingAssetIds.some((conflictingAssetId) => conflictingAssetId !== assetId)) {
    return [];
  }

  return [
    {
      ...evidence,
      metadata: {
        ...evidence.metadata,
        conflictingAssetIds: remainingConflictingAssetIds,
      },
    },
  ];
}

function deriveReviewStatus(
  evidence: readonly AssetReviewEvidence[],
  confirmedEvidenceFingerprint: string | undefined,
  evidenceFingerprint: string
): AssetReviewSummary['reviewStatus'] {
  if (evidence.length === 0) {
    return 'clear';
  }

  if (confirmedEvidenceFingerprint !== undefined && confirmedEvidenceFingerprint === evidenceFingerprint) {
    return 'reviewed';
  }

  return 'needs-review';
}

function deriveAccountingBlocked(
  evidence: readonly AssetReviewEvidence[],
  reviewStatus: AssetReviewSummary['reviewStatus']
): boolean {
  if (evidence.some((item) => item.kind === 'same-symbol-ambiguity')) {
    return true;
  }

  if (reviewStatus !== 'needs-review') {
    return false;
  }

  return evidence.some((item) => item.severity === 'error');
}

function computeEvidenceFingerprint(
  assetId: string,
  evidence: readonly AssetReviewEvidence[],
  referenceStatus: AssetReviewSummary['referenceStatus']
): string {
  const canonicalJson = JSON.stringify(
    sortJsonValue({
      assetId,
      evidence: evidence.map((item) => ({
        kind: item.kind,
        metadata: item.metadata,
        message: item.message,
        severity: item.severity,
      })),
      referenceStatus,
    })
  );

  return `asset-review:v1:${sha256Hex(canonicalJson)}`;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortJsonValue(entryValue)])
    );
  }

  return value;
}
