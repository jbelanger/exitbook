import {
  buildCostBasisScopedTransactions,
  validateTransferProposalConfirmability,
} from '@exitbook/accounting/cost-basis';
import {
  computeResolvedLinkFingerprint,
  type NewTransactionLink,
  resolveTransactionLinkProvenance,
  type Transaction,
  type TransactionLink,
  type TransactionLinkMetadata,
} from '@exitbook/core';
import { err, resultDo, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

const logger = getLogger('ManualLinkCommandShared');

export interface ExistingExactLinkMatch {
  link: TransactionLink;
}

export function buildReviewedLinkMetadata(
  link: TransactionLink,
  overrideId: string,
  extraMetadata?: TransactionLinkMetadata  
): TransactionLinkMetadata {
  return {
    ...(link.metadata ?? {}),
    ...(extraMetadata ?? {}),
    overrideId,
    overrideLinkType: 'transfer',
    linkProvenance: resolveTransactionLinkProvenance(link) === 'manual' ? 'manual' : 'user',
  };
}

export function findExistingExactLinkMatch(
  allLinks: TransactionLink[],
  candidateLink: NewTransactionLink
): Result<ExistingExactLinkMatch | undefined, Error> {
  return resultDo(function* () {
    const candidateFingerprint = yield* computeResolvedLinkFingerprint({
      sourceAssetId: candidateLink.sourceAssetId,
      targetAssetId: candidateLink.targetAssetId,
      sourceMovementFingerprint: candidateLink.sourceMovementFingerprint,
      targetMovementFingerprint: candidateLink.targetMovementFingerprint,
    });

    const matches: ExistingExactLinkMatch[] = [];
    for (const link of allLinks) {
      const fingerprintResult = computeResolvedLinkFingerprint({
        sourceAssetId: link.sourceAssetId,
        targetAssetId: link.targetAssetId,
        sourceMovementFingerprint: link.sourceMovementFingerprint,
        targetMovementFingerprint: link.targetMovementFingerprint,
      });
      if (fingerprintResult.isErr()) {
        return yield* err(fingerprintResult.error);
      }

      if (fingerprintResult.value === candidateFingerprint) {
        matches.push({ link });
      }
    }

    if (matches.length > 1) {
      return yield* err(
        new Error(
          `Multiple existing links already share the same exact movement identity (${matches.map((match) => match.link.id).join(', ')})`
        )
      );
    }

    return matches[0];
  });
}

export function validateConfirmedManualLinkSet(
  transactions: Transaction[],
  allLinks: TransactionLink[],
  candidateLinks: (TransactionLink | NewTransactionLink)[],
  excludedExistingLinkIds: number[] = []
): Result<void, Error> {
  const scopedTransactions = buildCostBasisScopedTransactions(transactions, logger);
  if (scopedTransactions.isErr()) {
    return err(scopedTransactions.error);
  }

  const excludedIds = new Set(excludedExistingLinkIds);
  const existingConfirmedLinks = allLinks.filter((link) => link.status === 'confirmed' && !excludedIds.has(link.id));

  return validateTransferProposalConfirmability(
    scopedTransactions.value.transactions,
    existingConfirmedLinks,
    candidateLinks
  );
}
