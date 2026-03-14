import type { Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import type { OverrideStore } from '@exitbook/data';
import { DataContext } from '@exitbook/data';

import { TransferProposalReviewService } from './transfer-proposal-review-service.js';

/**
 * Parameters for links confirm command.
 */
export interface LinksConfirmParams {
  linkId: number;
}

/**
 * Result of links confirm operation.
 */
interface LinksConfirmResult {
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
  transferProposalKey?: string | undefined;
}

/**
 * Handler for confirming transaction links.
 */
export class LinksConfirmHandler {
  private readonly reviewService: TransferProposalReviewService;

  constructor(db: DataContext, overrideStore?: OverrideStore) {
    this.reviewService = new TransferProposalReviewService(db, overrideStore);
  }

  /**
   * Execute the links confirm command.
   */
  async execute(params: LinksConfirmParams): Promise<Result<LinksConfirmResult, Error>> {
    const result = await this.reviewService.confirm(params.linkId);
    if (result.isErr()) {
      return err(result.error);
    }

    return ok({
      ...result.value,
      newStatus: 'confirmed',
    });
  }
}
