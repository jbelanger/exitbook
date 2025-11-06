// Handler for links reject command

import type { TransactionLinkRepository } from '@exitbook/accounting';
import type { TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { getDefaultReviewer, validateLinkStatusForReject } from './links-utils.js';

const logger = getLogger('LinksRejectHandler');

/**
 * Parameters for links reject command.
 */
export interface LinksRejectParams {
  linkId: string;
}

/**
 * Result of links reject operation.
 */
export interface LinksRejectResult {
  linkId: string;
  newStatus: 'rejected';
  reviewedBy: string;
  reviewedAt: Date;
}

/**
 * Handler for rejecting transaction links.
 */
export class LinksRejectHandler {
  constructor(
    private readonly linkRepo: TransactionLinkRepository,
    private readonly txRepo: TransactionRepository
  ) {}

  /**
   * Execute the links reject command.
   */
  async execute(params: LinksRejectParams): Promise<Result<LinksRejectResult, Error>> {
    try {
      // Fetch the link
      const linkResult = await this.linkRepo.findById(params.linkId);

      if (linkResult.isErr()) {
        return err(linkResult.error);
      }

      const link = linkResult.value;

      if (!link) {
        return err(new Error(`Link with ID ${params.linkId} not found`));
      }

      // Validate if link can be rejected
      const validationResult = validateLinkStatusForReject(link.status);

      if (validationResult.isErr()) {
        return err(validationResult.error);
      }

      // If already rejected (idempotent), return success with existing data
      if (!validationResult.value) {
        logger.warn({ linkId: params.linkId }, 'Link is already rejected');
        return ok({
          linkId: link.id,
          newStatus: 'rejected',
          reviewedBy: link.reviewedBy ?? getDefaultReviewer(),
          reviewedAt: link.reviewedAt ?? new Date(),
        });
      }

      // Allow rejecting confirmed links (including auto-confirmed ones)
      // Users must be able to override incorrect auto-confirmations
      if (link.status === 'confirmed') {
        logger.info({ linkId: params.linkId }, 'Rejecting previously confirmed link');
      }

      // Update link status to rejected
      const reviewedBy = getDefaultReviewer();
      const updateResult = await this.linkRepo.updateStatus(params.linkId, 'rejected', reviewedBy);

      if (updateResult.isErr()) {
        return err(updateResult.error);
      }

      if (!updateResult.value) {
        return err(new Error(`Failed to update link ${params.linkId}`));
      }

      logger.info({ linkId: params.linkId }, 'Link rejected successfully');

      return ok({
        linkId: params.linkId,
        newStatus: 'rejected',
        reviewedBy,
        reviewedAt: new Date(),
      });
    } catch (error) {
      logger.error({ error, linkId: params.linkId }, 'Failed to reject link');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  destroy(): void {
    // No cleanup needed
  }
}
