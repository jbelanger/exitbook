import { isPartialMatchLinkMetadata, type TransactionLink } from '@exitbook/accounting';

export interface LinkReviewScope {
  links: TransactionLink[];
  reviewGroupKey?: string | undefined;
}

export function resolveLinkReviewScope(
  selectedLink: TransactionLink,
  candidateLinks: TransactionLink[]
): LinkReviewScope {
  const reviewGroupKey = selectedLink.metadata?.reviewGroupKey;
  if (typeof reviewGroupKey === 'string' && reviewGroupKey.length > 0) {
    return {
      reviewGroupKey,
      links: dedupeLinks(candidateLinks.filter((candidate) => candidate.metadata?.reviewGroupKey === reviewGroupKey)),
    };
  }

  if (!isPartialMatchLinkMetadata(selectedLink.metadata)) {
    return {
      links: [selectedLink],
    };
  }

  const selectedIds = new Set<number>([selectedLink.id]);
  const sourceFingerprints = new Set<string>([selectedLink.sourceMovementFingerprint]);
  const targetFingerprints = new Set<string>([selectedLink.targetMovementFingerprint]);

  let changed = true;
  while (changed) {
    changed = false;

    for (const candidate of candidateLinks) {
      if (!isPartialMatchLinkMetadata(candidate.metadata)) {
        continue;
      }

      if (selectedIds.has(candidate.id)) {
        continue;
      }

      const sharesMovement =
        sourceFingerprints.has(candidate.sourceMovementFingerprint) ||
        targetFingerprints.has(candidate.targetMovementFingerprint);

      if (!sharesMovement) {
        continue;
      }

      selectedIds.add(candidate.id);
      sourceFingerprints.add(candidate.sourceMovementFingerprint);
      targetFingerprints.add(candidate.targetMovementFingerprint);
      changed = true;
    }
  }

  return {
    links: dedupeLinks(candidateLinks.filter((candidate) => selectedIds.has(candidate.id))),
  };
}

function dedupeLinks(links: TransactionLink[]): TransactionLink[] {
  const byId = new Map<number, TransactionLink>();

  for (const link of links) {
    byId.set(link.id, link);
  }

  return [...byId.values()].sort((left, right) => left.id - right.id);
}
