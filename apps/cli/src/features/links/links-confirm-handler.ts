// Handler for links confirm command

import type { TransactionLinkRepository } from '@exitbook/accounting';
import type { TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

const logger = getLogger('LinksConfirmHandler');

/**
 * Parameters for links confirm command.
 */
export interface LinksConfirmParams {
  linkId: string;
}

/**
 * Result of links confirm operation.
 */
export interface LinksConfirmResult {
  linkId: string;
  newStatus: 'confirmed';
  reviewedBy: string;
  reviewedAt: Date;
}

/**
 * Handler for confirming transaction links.
 */
export class LinksConfirmHandler {
  constructor(
    private readonly linkRepo: TransactionLinkRepository,
    private readonly txRepo: TransactionRepository
  ) {}

  /**
   * Execute the links confirm command.
   */
  async execute(params: LinksConfirmParams): Promise<Result<LinksConfirmResult, Error>> {
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

      // Check current status
      if (link.status === 'confirmed') {
        logger.warn({ linkId: params.linkId }, 'Link is already confirmed');
        // Return success anyway with existing data
        return ok({
          linkId: link.id,
          newStatus: 'confirmed',
          reviewedBy: link.reviewedBy ?? 'cli-user',
          reviewedAt: link.reviewedAt ?? new Date(),
        });
      }

      if (link.status === 'rejected') {
        return err(new Error(`Link ${params.linkId} was previously rejected. Create a new link instead.`));
      }

      // Update link status to confirmed
      const reviewedBy = 'cli-user'; // TODO: Get actual user from auth context when available
      const updateResult = await this.linkRepo.updateStatus(params.linkId, 'confirmed', reviewedBy);

      if (updateResult.isErr()) {
        return err(updateResult.error);
      }

      if (!updateResult.value) {
        return err(new Error(`Failed to update link ${params.linkId}`));
      }

      logger.info({ linkId: params.linkId }, 'Link confirmed successfully');

      return ok({
        linkId: params.linkId,
        newStatus: 'confirmed',
        reviewedBy,
        reviewedAt: new Date(),
      });
    } catch (error) {
      logger.error({ error, linkId: params.linkId }, 'Failed to confirm link');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  destroy(): void {
    // No cleanup needed
  }
}
