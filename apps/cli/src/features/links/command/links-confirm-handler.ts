import { buildCostBasisScopedTransactions, validateScopedTransferLinks } from '@exitbook/accounting';
import type { TransactionLink } from '@exitbook/accounting';
import type { Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import type { OverrideStore } from '@exitbook/data';
import { DataContext } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';

import { resolveLinkReviewScope } from '../links-review-utils.js';

import { writeLinkOverrideEvent } from './links-override-utils.js';
import { getDefaultReviewer, validateLinkStatusForConfirm } from './links-utils.js';

const logger = getLogger('LinksConfirmHandler');

/**
 * Parameters for links confirm command.
 */
export interface LinksConfirmParams {
  linkId: number;
}

/**
 * Result of links confirm operation.
 */
export interface LinksConfirmResult {
  linkId: number;
  affectedLinkIds: number[];
  affectedLinkCount: number;
  newStatus: 'confirmed';
  reviewedBy: string;
  reviewedAt: Date;
  // Additional fields for rich display
  asset?: string | undefined;
  sourceAmount?: string | undefined;
  targetAmount?: string | undefined;
  sourceName?: string | undefined;
  targetName?: string | undefined;
  confidence?: string | undefined;
}

/**
 * Handler for confirming transaction links.
 */
export class LinksConfirmHandler {
  constructor(
    private readonly db: DataContext,
    private readonly overrideStore?: OverrideStore | undefined
  ) {}

  /**
   * Execute the links confirm command.
   */
  async execute(params: LinksConfirmParams): Promise<Result<LinksConfirmResult, Error>> {
    try {
      // Fetch the link
      const linkResult = await this.db.transactionLinks.findById(params.linkId);

      if (linkResult.isErr()) {
        return err(linkResult.error);
      }

      const link = linkResult.value;

      if (!link) {
        return err(new Error(`Link with ID ${params.linkId} not found`));
      }

      // Validate if link can be confirmed
      const validationResult = validateLinkStatusForConfirm(link.status);

      if (validationResult.isErr()) {
        return err(validationResult.error);
      }

      // If already confirmed (idempotent), return success with existing data
      if (!validationResult.value) {
        logger.warn({ linkId: params.linkId }, 'Link is already confirmed');
        return ok({
          affectedLinkCount: 1,
          affectedLinkIds: [link.id],
          linkId: link.id,
          newStatus: 'confirmed',
          reviewedBy: link.reviewedBy ?? getDefaultReviewer(),
          reviewedAt: link.reviewedAt ?? new Date(),
        });
      }

      const reviewedBy = getDefaultReviewer();
      const allLinksResult = await this.db.transactionLinks.findAll();
      if (allLinksResult.isErr()) {
        return err(allLinksResult.error);
      }

      const reviewScope = resolveLinkReviewScope(link, allLinksResult.value);
      const rejectedLinks = reviewScope.links.filter((candidate) => candidate.status === 'rejected');
      if (rejectedLinks.length > 0) {
        return err(
          new Error(
            `Link ${link.id} cannot be confirmed: review group contains rejected links (${rejectedLinks.map((candidate) => candidate.id).join(', ')})`
          )
        );
      }

      const confirmabilityResult = await this.validateProspectiveConfirmedLinks(
        reviewScope.links,
        allLinksResult.value
      );
      if (confirmabilityResult.isErr()) {
        return err(confirmabilityResult.error);
      }

      const actionableLinks = reviewScope.links.filter((candidate) => candidate.status === 'suggested');
      const actionableIds = actionableLinks.map((candidate) => candidate.id);
      const updateResult = await this.db.executeInTransaction(async (tx) => {
        const updatedRowsResult = await tx.transactionLinks.updateStatuses(actionableIds, 'confirmed', reviewedBy);
        if (updatedRowsResult.isErr()) {
          return err(updatedRowsResult.error);
        }

        if (updatedRowsResult.value !== actionableIds.length) {
          return err(
            new Error(
              `Failed to update review group for link ${params.linkId}: expected ${actionableIds.length} rows, updated ${updatedRowsResult.value}`
            )
          );
        }

        return ok(undefined);
      });
      if (updateResult.isErr()) {
        return err(updateResult.error);
      }

      logger.info(
        { affectedLinkIds: reviewScope.links.map((candidate) => candidate.id), linkId: params.linkId },
        'Link review group confirmed successfully'
      );

      // Write override event for durability across reprocessing
      if (this.overrideStore) {
        for (const reviewLink of reviewScope.links) {
          await writeLinkOverrideEvent(this.db.transactions, this.overrideStore, reviewLink);
        }
      }

      // Fetch transaction details for rich display
      const sourceTxResult = await this.db.transactions.findById(link.sourceTransactionId);
      const targetTxResult = await this.db.transactions.findById(link.targetTransactionId);

      const sourceTx = sourceTxResult.isOk() ? sourceTxResult.value : undefined;
      const targetTx = targetTxResult.isOk() ? targetTxResult.value : undefined;

      return ok({
        affectedLinkCount: reviewScope.links.length,
        affectedLinkIds: reviewScope.links.map((candidate) => candidate.id),
        linkId: params.linkId,
        newStatus: 'confirmed',
        reviewedBy,
        reviewedAt: new Date(),
        asset: link.assetSymbol,
        sourceAmount: link.sourceAmount.toFixed(),
        targetAmount: link.targetAmount.toFixed(),
        sourceName: sourceTx?.source ?? 'unknown',
        targetName: targetTx?.source ?? 'unknown',
        confidence: `${(link.confidenceScore.toNumber() * 100).toFixed(1)}%`,
      });
    } catch (error) {
      logger.error({ error, linkId: params.linkId }, 'Failed to confirm link');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async validateProspectiveConfirmedLinks(
    reviewGroupLinks: TransactionLink[],
    allLinks: TransactionLink[]
  ): Promise<Result<void, Error>> {
    const transactionsResult = await this.db.transactions.findAll();
    if (transactionsResult.isErr()) {
      return err(transactionsResult.error);
    }

    const reviewGroupLinkIds = new Set(reviewGroupLinks.map((candidate) => candidate.id));
    const prospectiveConfirmedLinks = reviewGroupLinks
      .filter((candidate) => candidate.status !== 'rejected')
      .map((candidate) => ({
        ...candidate,
        status: 'confirmed' as const,
      }));
    const existingConfirmedLinks = allLinks.filter(
      (candidate) => candidate.status === 'confirmed' && !reviewGroupLinkIds.has(candidate.id)
    );

    const scopedResult = buildCostBasisScopedTransactions(transactionsResult.value, logger);
    if (scopedResult.isErr()) {
      return err(scopedResult.error);
    }

    const validatedResult = validateScopedTransferLinks(scopedResult.value.transactions, [
      ...existingConfirmedLinks,
      ...prospectiveConfirmedLinks,
    ]);
    if (validatedResult.isErr()) {
      return err(
        new Error(`Link ${reviewGroupLinks[0]?.id ?? 'unknown'} cannot be confirmed: ${validatedResult.error.message}`)
      );
    }

    return ok(undefined);
  }
}
