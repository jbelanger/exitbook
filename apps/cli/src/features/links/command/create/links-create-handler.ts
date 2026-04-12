import {
  buildCostBasisScopedTransactions,
  validateTransferProposalConfirmability,
} from '@exitbook/accounting/cost-basis';
import {
  buildManualLinkOverrideMetadata,
  prepareManualLinkFromTransactions,
  type PreparedManualLink,
} from '@exitbook/accounting/linking';
import {
  computeResolvedLinkFingerprint,
  type LinkStatus,
  type NewTransactionLink,
  type Transaction,
  type TransactionLink,
  type TransactionLinkMetadata,
  resolveTransactionLinkProvenance,
} from '@exitbook/core';
import type { OverrideStore } from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, resultDo, resultDoAsync, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import {
  formatTransactionFingerprintRef,
  resolveOwnedTransactionSelector,
  type ResolvedTransactionSelector,
} from '../../../transactions/transaction-selector.js';
import { getDefaultReviewer } from '../review/link-review-policy.js';
import { appendLinkOverrideEvent } from '../review/links-override-append.js';

const logger = getLogger('ManualLinkCreateHandler');

type LinksCreateDatabase = Pick<DataSession, 'executeInTransaction'> & {
  transactionLinks: Pick<DataSession['transactionLinks'], 'create' | 'findAll' | 'updateStatuses'>;
  transactions: Pick<DataSession['transactions'], 'findAll' | 'findByFingerprintRef' | 'findById'>;
};

interface ExactLinkMatch {
  link: TransactionLink;
}

export interface LinksCreateParams {
  assetSymbol: NewTransactionLink['assetSymbol'];
  reason?: string | undefined;
  sourceSelector: string;
  targetSelector: string;
}

export interface LinksCreateResult {
  action: 'already-confirmed' | 'confirmed-existing' | 'created';
  changed: boolean;
  assetSymbol: string;
  existingStatusBefore?: LinkStatus | undefined;
  linkId: number;
  linkType: NewTransactionLink['linkType'];
  reason?: string | undefined;
  reviewedAt: Date;
  reviewedBy: string;
  sourceAmount: string;
  sourcePlatformKey: string;
  sourceTransactionId: number;
  sourceTransactionRef: string;
  targetAmount: string;
  targetPlatformKey: string;
  targetTransactionId: number;
  targetTransactionRef: string;
}

export class ManualLinkCreateHandler {
  constructor(
    private readonly db: LinksCreateDatabase,
    private readonly profileId: number,
    private readonly profileKey: string,
    private readonly overrideStore: OverrideStore
  ) {}

  async create(params: LinksCreateParams): Promise<Result<LinksCreateResult, Error>> {
    return resultDoAsync(async function* (self) {
      const reviewedBy = getDefaultReviewer();
      const reviewedAt = new Date();
      const sourceTransaction = yield* await self.resolveTransaction(params.sourceSelector);
      const targetTransaction = yield* await self.resolveTransaction(params.targetSelector);
      const transactions = yield* await self.db.transactions.findAll({ profileId: self.profileId });
      const preparedLink = yield* prepareManualLinkFromTransactions(
        {
          transactions,
          sourceTransactionId: sourceTransaction.transaction.id,
          targetTransactionId: targetTransaction.transaction.id,
          assetSymbol: params.assetSymbol,
          reviewedAt,
          reviewedBy,
        },
        logger
      );
      const allLinks = yield* await self.db.transactionLinks.findAll({ profileId: self.profileId });
      const existingMatch = yield* findExactLinkMatch(allLinks, preparedLink.link);

      if (existingMatch?.link.status === 'confirmed') {
        return self.buildResult(
          preparedLink,
          existingMatch.link.id,
          existingMatch.link.reviewedAt ?? reviewedAt,
          existingMatch.link.reviewedBy ?? reviewedBy,
          'already-confirmed',
          false,
          undefined,
          existingMatch.link.status
        );
      }

      const validationCandidate =
        existingMatch === undefined
          ? preparedLink.link
          : ({
              ...existingMatch.link,
              status: 'confirmed',
              reviewedAt,
              reviewedBy,
            } satisfies TransactionLink);
      yield* self.validateConfirmability(transactions, allLinks, validationCandidate, existingMatch?.link.id);

      if (existingMatch) {
        const overrideEvent = yield* await self.appendOverride(existingMatch.link, params.reason);
        yield* await self.confirmExistingLink(
          existingMatch.link.id,
          reviewedBy,
          buildReviewedLinkMetadata(existingMatch.link, overrideEvent.id)
        );

        return self.buildResult(
          preparedLink,
          existingMatch.link.id,
          reviewedAt,
          reviewedBy,
          'confirmed-existing',
          true,
          params.reason,
          existingMatch.link.status
        );
      }

      const overrideEvent = yield* await self.appendOverride(preparedLink.link, params.reason);
      const linkToCreate: NewTransactionLink = {
        ...preparedLink.link,
        metadata: {
          ...(preparedLink.link.metadata ?? {}),
          ...buildManualLinkOverrideMetadata(overrideEvent.id, 'transfer'),
        },
      };
      const linkId = yield* await self.createLink(linkToCreate);

      return self.buildResult(preparedLink, linkId, reviewedAt, reviewedBy, 'created', true, params.reason);
    }, this);
  }

  private async resolveTransaction(selector: string): Promise<Result<ResolvedTransactionSelector, Error>> {
    return resolveOwnedTransactionSelector(
      {
        getByFingerprintRef: async (profileId, fingerprintRef) =>
          this.db.transactions.findByFingerprintRef(profileId, fingerprintRef),
      },
      this.profileId,
      selector
    );
  }

  private validateConfirmability(
    transactions: Transaction[],
    allLinks: TransactionLink[],
    candidateLink: TransactionLink | NewTransactionLink,
    excludedExistingLinkId?: number
  ): Result<void, Error> {
    const scopedTransactions = buildCostBasisScopedTransactions(transactions, logger);
    if (scopedTransactions.isErr()) {
      return err(scopedTransactions.error);
    }

    const existingConfirmedLinks = allLinks.filter(
      (link) => link.status === 'confirmed' && link.id !== excludedExistingLinkId
    );

    return validateTransferProposalConfirmability(scopedTransactions.value.transactions, existingConfirmedLinks, [
      candidateLink,
    ]);
  }

  private async appendOverride(
    link: TransactionLink | NewTransactionLink,
    reason?: string
  ): Promise<Result<{ id: string }, Error>> {
    const appendResult = await appendLinkOverrideEvent(
      {
        findById: (transactionId: number) => this.db.transactions.findById(transactionId, this.profileId),
      },
      this.overrideStore,
      this.profileKey,
      link,
      reason
    );
    if (appendResult.isErr()) {
      return err(new Error(`Failed to write link override event: ${appendResult.error.message}`));
    }

    return ok({ id: appendResult.value.id });
  }

  private async confirmExistingLink(
    linkId: number,
    reviewedBy: string,
    metadata: TransactionLinkMetadata
  ): Promise<Result<void, Error>> {
    const updateResult = await this.db.executeInTransaction(async (tx) => {
      const updatedRows = await tx.transactionLinks.updateStatuses(
        [linkId],
        'confirmed',
        reviewedBy,
        new Map([[linkId, metadata]])
      );
      if (updatedRows.isErr()) {
        return err(updatedRows.error);
      }

      if (updatedRows.value !== 1) {
        return err(
          new Error(`Failed to confirm manual link ${linkId}: expected 1 updated row, got ${updatedRows.value}`)
        );
      }

      return ok(undefined);
    });
    if (updateResult.isErr()) {
      return err(updateResult.error);
    }

    return ok(undefined);
  }

  private async createLink(link: NewTransactionLink): Promise<Result<number, Error>> {
    const createResult = await this.db.executeInTransaction(async (tx) => tx.transactionLinks.create(link));
    if (createResult.isErr()) {
      return err(
        new Error(
          `${createResult.error.message}. The override was written successfully; rerun "links run" to rematerialize the manual link.`
        )
      );
    }

    return ok(createResult.value);
  }

  private buildResult(
    preparedLink: PreparedManualLink,
    linkId: number,
    reviewedAt: Date,
    reviewedBy: string,
    action: LinksCreateResult['action'],
    changed: boolean,
    reason?: string,
    existingStatusBefore?: LinkStatus
  ): LinksCreateResult {
    return {
      action,
      changed,
      assetSymbol: preparedLink.link.assetSymbol,
      existingStatusBefore,
      linkId,
      linkType: preparedLink.link.linkType,
      reason,
      reviewedAt,
      reviewedBy,
      sourceAmount: preparedLink.link.sourceAmount.toFixed(),
      sourcePlatformKey: preparedLink.sourceTransaction.platformKey,
      sourceTransactionId: preparedLink.sourceTransaction.id,
      sourceTransactionRef: formatTransactionFingerprintRef(preparedLink.sourceTransaction.txFingerprint),
      targetAmount: preparedLink.link.targetAmount.toFixed(),
      targetPlatformKey: preparedLink.targetTransaction.platformKey,
      targetTransactionId: preparedLink.targetTransaction.id,
      targetTransactionRef: formatTransactionFingerprintRef(preparedLink.targetTransaction.txFingerprint),
    };
  }
}

function buildReviewedLinkMetadata(link: TransactionLink, overrideId: string): TransactionLinkMetadata {
  return {
    ...(link.metadata ?? {}),
    overrideId,
    overrideLinkType: 'transfer',
    linkProvenance: resolveTransactionLinkProvenance(link) === 'manual' ? 'manual' : 'user',
  };
}

function findExactLinkMatch(
  allLinks: TransactionLink[],
  candidateLink: NewTransactionLink
): Result<ExactLinkMatch | undefined, Error> {
  return resultDo(function* () {
    const candidateFingerprint = yield* computeResolvedLinkFingerprint({
      sourceAssetId: candidateLink.sourceAssetId,
      targetAssetId: candidateLink.targetAssetId,
      sourceMovementFingerprint: candidateLink.sourceMovementFingerprint,
      targetMovementFingerprint: candidateLink.targetMovementFingerprint,
    });

    const matches: ExactLinkMatch[] = [];
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
