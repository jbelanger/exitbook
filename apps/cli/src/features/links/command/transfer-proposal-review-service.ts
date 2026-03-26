import { buildCostBasisScopedTransactions, validateTransferProposalConfirmability } from '@exitbook/accounting';
import type { TransactionLink } from '@exitbook/core';
import type { OverrideStore } from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import type { Result } from '@exitbook/foundation';
import { err, ok, wrapError } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import { resolveTransferProposal } from '../transfer-proposals.js';

import { writeLinkOverrideEvent, writeUnlinkOverrideEvent } from './links-override-utils.js';
import { getDefaultReviewer } from './links-utils.js';

const logger = getLogger('TransferProposalReviewService');

interface TransferProposalReviewResult {
  affectedLinkCount: number;
  affectedLinkIds: number[];
  asset?: string | undefined;
  confidence?: string | undefined;
  linkId: number;
  newStatus: 'confirmed' | 'rejected';
  reviewedAt: Date;
  reviewedBy: string;
  sourceAmount?: string | undefined;
  platformKey?: string | undefined;
  targetAmount?: string | undefined;
  targetName?: string | undefined;
  transferProposalKey?: string | undefined;
}

export class TransferProposalReviewService {
  constructor(
    private readonly db: DataSession,
    private readonly profileId: number,
    private readonly profileKey: string,
    private readonly overrideStore?: OverrideStore | undefined
  ) {}

  async confirm(linkId: number): Promise<Result<TransferProposalReviewResult, Error>> {
    return this.execute(linkId, 'confirmed');
  }

  async reject(linkId: number): Promise<Result<TransferProposalReviewResult, Error>> {
    return this.execute(linkId, 'rejected');
  }

  private async execute(
    linkId: number,
    targetStatus: 'confirmed' | 'rejected'
  ): Promise<Result<TransferProposalReviewResult, Error>> {
    try {
      const selectedLinkResult = await this.db.transactionLinks.findById(linkId, this.profileId);
      if (selectedLinkResult.isErr()) {
        return err(selectedLinkResult.error);
      }

      const selectedLink = selectedLinkResult.value;
      if (!selectedLink) {
        return err(new Error(`Link with ID ${linkId} not found`));
      }

      const reviewedBy = getDefaultReviewer();

      const allLinksResult = await this.db.transactionLinks.findAll({ profileId: this.profileId });
      if (allLinksResult.isErr()) {
        return err(allLinksResult.error);
      }

      const allLinks = allLinksResult.value;
      const transferProposal = resolveTransferProposal(selectedLink, allLinks);
      const actionableLinks = transferProposal.links.filter((candidate) =>
        targetStatus === 'confirmed' ? candidate.status === 'suggested' : candidate.status !== 'rejected'
      );
      const actionableIds = actionableLinks.map((candidate) => candidate.id);

      if (targetStatus === 'confirmed') {
        const rejectedLinks = transferProposal.links.filter((candidate) => candidate.status === 'rejected');
        if (rejectedLinks.length > 0) {
          return err(
            new Error(
              `Link ${selectedLink.id} cannot be confirmed: transfer proposal contains rejected links (${rejectedLinks.map((candidate) => candidate.id).join(', ')})`
            )
          );
        }

        if (actionableLinks.length === 0) {
          logger.warn({ linkId, targetStatus }, 'Transfer proposal review action is already satisfied');
          return ok({
            affectedLinkCount: 1,
            affectedLinkIds: [selectedLink.id],
            linkId: selectedLink.id,
            newStatus: targetStatus,
            reviewedBy: selectedLink.reviewedBy ?? reviewedBy,
            reviewedAt: selectedLink.reviewedAt ?? new Date(),
            transferProposalKey: transferProposal.transferProposalKey,
          });
        }

        const confirmabilityResult = await this.validateProposalConfirmability(transferProposal.links, allLinks);
        if (confirmabilityResult.isErr()) {
          return err(new Error(`Link ${selectedLink.id} cannot be confirmed: ${confirmabilityResult.error.message}`));
        }
      } else if (actionableLinks.some((candidate) => candidate.status === 'confirmed')) {
        logger.info({ linkId }, 'Rejecting previously confirmed transfer proposal');
      } else if (actionableLinks.length === 0) {
        logger.warn({ linkId, targetStatus }, 'Transfer proposal review action is already satisfied');
        return ok({
          affectedLinkCount: 1,
          affectedLinkIds: [selectedLink.id],
          linkId: selectedLink.id,
          newStatus: targetStatus,
          reviewedBy: selectedLink.reviewedBy ?? reviewedBy,
          reviewedAt: selectedLink.reviewedAt ?? new Date(),
          transferProposalKey: transferProposal.transferProposalKey,
        });
      }

      const updateResult = await this.db.executeInTransaction(async (tx) => {
        const updatedRowsResult = await tx.transactionLinks.updateStatuses(actionableIds, targetStatus, reviewedBy);
        if (updatedRowsResult.isErr()) {
          return err(updatedRowsResult.error);
        }

        if (updatedRowsResult.value !== actionableIds.length) {
          return err(
            new Error(
              `Failed to update transfer proposal for link ${linkId}: expected ${actionableIds.length} rows, updated ${updatedRowsResult.value}`
            )
          );
        }

        return ok(undefined);
      });
      if (updateResult.isErr()) {
        return err(updateResult.error);
      }

      logger.info(
        {
          affectedLinkIds: actionableIds,
          linkId,
          targetStatus,
          transferProposalKey: transferProposal.transferProposalKey,
        },
        'Transfer proposal reviewed successfully'
      );

      await this.writeOverrideEvents(actionableLinks, targetStatus);

      const transactionDetailResult = await this.loadTransactionDetails(selectedLink);
      if (transactionDetailResult.isErr()) {
        return err(transactionDetailResult.error);
      }

      return ok({
        affectedLinkCount: actionableLinks.length,
        affectedLinkIds: actionableIds,
        linkId,
        newStatus: targetStatus,
        reviewedBy,
        reviewedAt: new Date(),
        transferProposalKey: transferProposal.transferProposalKey,
        ...transactionDetailResult.value,
      });
    } catch (error) {
      logger.error({ error, linkId, targetStatus }, 'Failed to review transfer proposal');
      return wrapError(error, 'Failed to review transfer proposal');
    }
  }

  private async validateProposalConfirmability(
    proposalLinks: TransactionLink[],
    allLinks: TransactionLink[]
  ): Promise<Result<void, Error>> {
    const transactionsResult = await this.db.transactions.findAll({ profileId: this.profileId });
    if (transactionsResult.isErr()) {
      return err(transactionsResult.error);
    }

    const scopedResult = buildCostBasisScopedTransactions(transactionsResult.value, logger);
    if (scopedResult.isErr()) {
      return err(scopedResult.error);
    }

    const proposalLinkIds = new Set(proposalLinks.map((candidate) => candidate.id));
    const existingConfirmedLinks = allLinks.filter(
      (candidate) => candidate.status === 'confirmed' && !proposalLinkIds.has(candidate.id)
    );

    return validateTransferProposalConfirmability(
      scopedResult.value.transactions,
      existingConfirmedLinks,
      proposalLinks
    );
  }

  private async writeOverrideEvents(
    proposalLinks: TransactionLink[],
    targetStatus: 'confirmed' | 'rejected'
  ): Promise<void> {
    if (!this.overrideStore) {
      return;
    }

    for (const proposalLink of proposalLinks) {
      const scopedTransactions = {
        findById: (transactionId: number) => this.db.transactions.findById(transactionId, this.profileId),
      };
      if (targetStatus === 'confirmed') {
        await writeLinkOverrideEvent(scopedTransactions, this.overrideStore, this.profileKey, proposalLink);
      } else {
        await writeUnlinkOverrideEvent(scopedTransactions, this.overrideStore, this.profileKey, proposalLink);
      }
    }
  }

  private async loadTransactionDetails(selectedLink: TransactionLink): Promise<
    Result<
      {
        asset: string;
        confidence: string;
        platformKey: string;
        sourceAmount: string;
        targetAmount: string;
        targetName: string;
      },
      Error
    >
  > {
    const sourceTxResult = await this.db.transactions.findById(selectedLink.sourceTransactionId, this.profileId);
    if (sourceTxResult.isErr()) {
      return err(sourceTxResult.error);
    }

    const targetTxResult = await this.db.transactions.findById(selectedLink.targetTransactionId, this.profileId);
    if (targetTxResult.isErr()) {
      return err(targetTxResult.error);
    }

    if (!sourceTxResult.value) {
      logger.warn(
        { linkId: selectedLink.id, sourceTransactionId: selectedLink.sourceTransactionId },
        'Source transaction not found for confirmed/rejected link'
      );
    }
    if (!targetTxResult.value) {
      logger.warn(
        { linkId: selectedLink.id, targetTransactionId: selectedLink.targetTransactionId },
        'Target transaction not found for confirmed/rejected link'
      );
    }

    return ok({
      asset: selectedLink.assetSymbol,
      confidence: `${(selectedLink.confidenceScore.toNumber() * 100).toFixed(1)}%`,
      sourceAmount: selectedLink.sourceAmount.toFixed(),
      platformKey: sourceTxResult.value?.source ?? 'unknown',
      targetAmount: selectedLink.targetAmount.toFixed(),
      targetName: targetTxResult.value?.source ?? 'unknown',
    });
  }
}
