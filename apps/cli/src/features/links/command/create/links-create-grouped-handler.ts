import {
  buildManualLinkOverrideMetadata,
  prepareGroupedManualLinksFromTransactions,
  type PreparedGroupedManualLinks,
  type PreparedManualLink,
} from '@exitbook/accounting/linking';
import {
  getExplainedTargetResidualFromMetadata,
  type LinkStatus,
  type NewTransactionLink,
  type NonPrincipalMovementRole,
  type OverrideEvent,
  type TransactionLink,
} from '@exitbook/core';
import type { OverrideStore } from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, parseDecimal, resultDoAsync, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import {
  formatTransactionFingerprintRef,
  resolveOwnedTransactionSelector,
  type ResolvedTransactionSelector,
} from '../../../transactions/transaction-selector.js';
import {
  buildReviewedLinkMetadata,
  findExistingExactLinkMatch,
  type ExistingExactLinkMatch,
  validateConfirmedManualLinkSet,
} from '../link-confirmation-shared.js';
import { getDefaultReviewer } from '../review/link-review-policy.js';
import { appendLinkOverrideEvents } from '../review/links-override-append.js';

const logger = getLogger('ManualGroupedLinkCreateHandler');

type LinksCreateGroupedDatabase = Pick<DataSession, 'executeInTransaction'> & {
  transactionAnnotations: Pick<DataSession['transactionAnnotations'], 'readAnnotations'>;
  transactionLinks: Pick<DataSession['transactionLinks'], 'create' | 'findAll' | 'updateStatuses'>;
  transactions: Pick<DataSession['transactions'], 'findAll' | 'findByFingerprintRef' | 'findById'>;
};

export interface LinksCreateGroupedParams {
  assetSymbol: NewTransactionLink['assetSymbol'];
  explainedTargetResidual?:
    | {
        amount: string;
        role: NonPrincipalMovementRole;
      }
    | undefined;
  reason?: string | undefined;
  sourceSelectors: string[];
  targetSelectors: string[];
}

type GroupedEntryAction = 'already-confirmed' | 'confirmed-existing' | 'created';

interface PlannedGroupedLinkEntry {
  action: GroupedEntryAction;
  existingMatch?: ExistingExactLinkMatch | undefined;
  preparedLink: PreparedManualLink;
}

interface ChangedGroupedLinkEntry {
  entry: PlannedGroupedLinkEntry;
  plannedIndex: number;
}

export interface LinksCreateGroupedEntryResult {
  action: GroupedEntryAction;
  existingStatusBefore?: LinkStatus | undefined;
  linkId: number;
  linkType: NewTransactionLink['linkType'];
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

export interface LinksCreateGroupedResult {
  action: 'already-confirmed' | 'confirmed-existing' | 'created' | 'mixed';
  changed: boolean;
  assetSymbol: string;
  confirmedExistingCount: number;
  createdCount: number;
  explainedTargetResidualAmount?: string | undefined;
  explainedTargetResidualRole?: NonPrincipalMovementRole | undefined;
  groupShape: PreparedGroupedManualLinks['shape'];
  links: LinksCreateGroupedEntryResult[];
  reason?: string | undefined;
  sourceCount: number;
  targetCount: number;
  unchangedCount: number;
}

export class ManualGroupedLinkCreateHandler {
  constructor(
    private readonly db: LinksCreateGroupedDatabase,
    private readonly profileId: number,
    private readonly profileKey: string,
    private readonly overrideStore: OverrideStore
  ) {}

  async create(params: LinksCreateGroupedParams): Promise<Result<LinksCreateGroupedResult, Error>> {
    return resultDoAsync(async function* (self) {
      const reviewedBy = getDefaultReviewer();
      const reviewedAt = new Date();
      const resolvedSources = yield* await self.resolveTransactions(params.sourceSelectors);
      const resolvedTargets = yield* await self.resolveTransactions(params.targetSelectors);
      const transactions = yield* await self.db.transactions.findAll({ profileId: self.profileId });
      const transactionAnnotations =
        transactions.length === 0
          ? []
          : yield* await self.db.transactionAnnotations.readAnnotations({
              kinds: ['asset_migration_participant'],
              tiers: ['asserted', 'heuristic'],
              transactionIds: transactions.map((transaction) => transaction.id),
            });
      const preparedGroup = yield* prepareGroupedManualLinksFromTransactions(
        {
          transactions,
          sourceTransactionIds: resolvedSources.map((selection) => selection.transaction.id),
          targetTransactionIds: resolvedTargets.map((selection) => selection.transaction.id),
          assetSymbol: params.assetSymbol,
          explainedTargetResidual: params.explainedTargetResidual
            ? {
                amount: parseDecimal(params.explainedTargetResidual.amount),
                role: params.explainedTargetResidual.role,
              }
            : undefined,
          reviewedAt,
          reviewedBy,
          transactionAnnotations,
        },
        logger
      );
      const allLinks = yield* await self.db.transactionLinks.findAll({ profileId: self.profileId });
      const plannedEntries = yield* self.planEntries(allLinks, preparedGroup.entries);
      const excludedExistingLinkIds = plannedEntries
        .map((entry) => entry.existingMatch?.link.id)
        .filter((linkId): linkId is number => linkId !== undefined);
      const validationCandidates = plannedEntries.map((entry) =>
        entry.existingMatch === undefined
          ? entry.preparedLink.link
          : ({
              ...entry.existingMatch.link,
              metadata: {
                ...(entry.existingMatch.link.metadata ?? {}),
                ...(entry.preparedLink.link.metadata ?? {}),
              },
              status: 'confirmed',
              reviewedAt,
              reviewedBy,
            } satisfies TransactionLink)
      );
      yield* validateConfirmedManualLinkSet(transactions, allLinks, validationCandidates, excludedExistingLinkIds);

      const changedEntries = plannedEntries.flatMap((entry, plannedIndex) =>
        entry.action === 'already-confirmed' ? [] : [{ entry, plannedIndex }]
      );
      const persistedLinkIds = new Map<number, number>();

      for (const [index, entry] of plannedEntries.entries()) {
        if (entry.existingMatch) {
          persistedLinkIds.set(index, entry.existingMatch.link.id);
        }
      }

      if (changedEntries.length > 0) {
        const overrideEvents = yield* await self.appendOverrides(changedEntries, params.reason);
        const changedLinkIds = yield* await self.persistChanges(changedEntries, overrideEvents, reviewedBy);

        for (const [index, linkId] of changedLinkIds.entries()) {
          persistedLinkIds.set(index, linkId);
        }
      }

      return yield* self.buildResult(preparedGroup, plannedEntries, persistedLinkIds, params.reason);
    }, this);
  }

  private async resolveTransactions(selectors: string[]): Promise<Result<ResolvedTransactionSelector[], Error>> {
    const resolvedSelectors: ResolvedTransactionSelector[] = [];

    for (const selector of selectors) {
      const resolutionResult = await resolveOwnedTransactionSelector(
        {
          getByFingerprintRef: async (profileId, fingerprintRef) =>
            this.db.transactions.findByFingerprintRef(profileId, fingerprintRef),
        },
        this.profileId,
        selector
      );
      if (resolutionResult.isErr()) {
        return err(resolutionResult.error);
      }

      resolvedSelectors.push(resolutionResult.value);
    }

    return ok(resolvedSelectors);
  }

  private planEntries(
    allLinks: TransactionLink[],
    preparedLinks: PreparedManualLink[]
  ): Result<PlannedGroupedLinkEntry[], Error> {
    const plannedEntries: PlannedGroupedLinkEntry[] = [];

    for (const preparedLink of preparedLinks) {
      const existingMatchResult = findExistingExactLinkMatch(allLinks, preparedLink.link);
      if (existingMatchResult.isErr()) {
        return err(existingMatchResult.error);
      }

      const existingMatch = existingMatchResult.value;
      const action: GroupedEntryAction =
        existingMatch?.link.status === 'confirmed'
          ? 'already-confirmed'
          : existingMatch
            ? 'confirmed-existing'
            : 'created';

      plannedEntries.push({
        action,
        existingMatch,
        preparedLink,
      });
    }

    return ok(plannedEntries);
  }

  private async appendOverrides(
    entries: ChangedGroupedLinkEntry[],
    reason?: string
  ): Promise<Result<OverrideEvent[], Error>> {
    const overrideResult = await appendLinkOverrideEvents(
      {
        findById: (transactionId: number) => this.db.transactions.findById(transactionId, this.profileId),
      },
      this.overrideStore,
      this.profileKey,
      entries.map(({ entry }) =>
        entry.existingMatch
          ? {
              ...entry.existingMatch.link,
              metadata: {
                ...(entry.existingMatch.link.metadata ?? {}),
                ...(entry.preparedLink.link.metadata ?? {}),
              },
            }
          : entry.preparedLink.link
      ),
      reason
    );
    if (overrideResult.isErr()) {
      return err(new Error(`Failed to write grouped link override events: ${overrideResult.error.message}`));
    }

    return ok(overrideResult.value);
  }

  private async persistChanges(
    entries: ChangedGroupedLinkEntry[],
    overrideEvents: OverrideEvent[],
    reviewedBy: string
  ): Promise<Result<Map<number, number>, Error>> {
    const mutationResult = await this.db.executeInTransaction((tx) =>
      resultDoAsync(async function* () {
        const persistedLinkIds = new Map<number, number>();

        for (const [offset, changedEntry] of entries.entries()) {
          const { entry, plannedIndex } = changedEntry;
          const overrideEvent = overrideEvents[offset];
          if (!overrideEvent) {
            return yield* err(new Error('Grouped link override batch returned fewer events than expected'));
          }

          if (entry.existingMatch) {
            const updatedRows = yield* await tx.transactionLinks.updateStatuses(
              [entry.existingMatch.link.id],
              'confirmed',
              reviewedBy,
              new Map([
                [
                  entry.existingMatch.link.id,
                  buildReviewedLinkMetadata(
                    entry.existingMatch.link,
                    overrideEvent.id,
                    entry.preparedLink.link.metadata
                  ),
                ],
              ])
            );
            if (updatedRows !== 1) {
              return yield* err(
                new Error(
                  `Failed to confirm grouped manual link ${entry.existingMatch.link.id}: expected 1 updated row, got ${updatedRows}`
                )
              );
            }

            persistedLinkIds.set(plannedIndex, entry.existingMatch.link.id);
            continue;
          }

          const linkToCreate: NewTransactionLink = {
            ...entry.preparedLink.link,
            metadata: {
              ...(entry.preparedLink.link.metadata ?? {}),
              ...buildManualLinkOverrideMetadata(
                overrideEvent.id,
                'transfer',
                getExplainedTargetResidualFromMetadata(entry.preparedLink.link.metadata)
              ),
            },
          };
          const createdLinkId = yield* await tx.transactionLinks.create(linkToCreate);
          persistedLinkIds.set(plannedIndex, createdLinkId);
        }

        return persistedLinkIds;
      })
    );

    if (mutationResult.isErr()) {
      return err(
        new Error(
          `${mutationResult.error.message}. The grouped overrides were written successfully; rerun "links run" to rematerialize the grouped manual links.`
        )
      );
    }

    return ok(mutationResult.value);
  }

  private buildResult(
    preparedGroup: PreparedGroupedManualLinks,
    entries: PlannedGroupedLinkEntry[],
    persistedLinkIds: Map<number, number>,
    reason?: string
  ): Result<LinksCreateGroupedResult, Error> {
    const linkResults: LinksCreateGroupedEntryResult[] = [];
    for (const [index, entry] of entries.entries()) {
      const linkId = persistedLinkIds.get(index);
      if (linkId === undefined) {
        return err(new Error(`Grouped manual link result is missing a persisted link id for entry ${index}`));
      }

      linkResults.push(this.buildEntryResult(entry, linkId));
    }

    const createdCount = linkResults.filter((entry) => entry.action === 'created').length;
    const confirmedExistingCount = linkResults.filter((entry) => entry.action === 'confirmed-existing').length;
    const unchangedCount = linkResults.filter((entry) => entry.action === 'already-confirmed').length;

    return ok({
      action: deriveGroupedAction(createdCount, confirmedExistingCount, unchangedCount),
      changed: createdCount > 0 || confirmedExistingCount > 0,
      assetSymbol: entries[0]?.preparedLink.link.assetSymbol ?? '',
      confirmedExistingCount,
      createdCount,
      explainedTargetResidualAmount: preparedGroup.entries[0]?.link.metadata?.explainedTargetResidualAmount,
      explainedTargetResidualRole: preparedGroup.entries[0]?.link.metadata?.explainedTargetResidualRole,
      groupShape: preparedGroup.shape,
      links: linkResults,
      reason,
      sourceCount: preparedGroup.shape === 'many-to-one' ? preparedGroup.entries.length : 1,
      targetCount: preparedGroup.shape === 'one-to-many' ? preparedGroup.entries.length : 1,
      unchangedCount,
    });
  }

  private buildEntryResult(entry: PlannedGroupedLinkEntry, linkId: number): LinksCreateGroupedEntryResult {
    return {
      action: entry.action,
      existingStatusBefore:
        entry.action === 'confirmed-existing' && entry.existingMatch ? entry.existingMatch.link.status : undefined,
      linkId,
      linkType: entry.preparedLink.link.linkType,
      reviewedAt:
        entry.action === 'already-confirmed' && entry.existingMatch?.link.reviewedAt
          ? entry.existingMatch.link.reviewedAt
          : (entry.preparedLink.link.reviewedAt ?? entry.preparedLink.link.createdAt),
      reviewedBy:
        entry.action === 'already-confirmed' && entry.existingMatch?.link.reviewedBy
          ? entry.existingMatch.link.reviewedBy
          : (entry.preparedLink.link.reviewedBy ?? 'auto'),
      sourceAmount: entry.preparedLink.link.sourceAmount.toFixed(),
      sourcePlatformKey: entry.preparedLink.sourceTransaction.platformKey,
      sourceTransactionId: entry.preparedLink.sourceTransaction.id,
      sourceTransactionRef: formatTransactionFingerprintRef(entry.preparedLink.sourceTransaction.txFingerprint),
      targetAmount: entry.preparedLink.link.targetAmount.toFixed(),
      targetPlatformKey: entry.preparedLink.targetTransaction.platformKey,
      targetTransactionId: entry.preparedLink.targetTransaction.id,
      targetTransactionRef: formatTransactionFingerprintRef(entry.preparedLink.targetTransaction.txFingerprint),
    };
  }
}

function deriveGroupedAction(
  createdCount: number,
  confirmedExistingCount: number,
  unchangedCount: number
): LinksCreateGroupedResult['action'] {
  const distinctActions = [createdCount > 0, confirmedExistingCount > 0, unchangedCount > 0].filter(Boolean).length;

  if (distinctActions > 1) {
    return 'mixed';
  }

  if (createdCount > 0) {
    return 'created';
  }

  if (confirmedExistingCount > 0) {
    return 'confirmed-existing';
  }

  return 'already-confirmed';
}
