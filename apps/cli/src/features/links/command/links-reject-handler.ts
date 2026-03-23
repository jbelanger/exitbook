import { DataContext, type OverrideStore } from '@exitbook/data';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';

import { TransferProposalReviewService } from './transfer-proposal-review-service.js';

/**
 * Parameters for links reject command.
 */
export interface LinksRejectParams {
  linkId: number;
}

/**
 * Result of links reject operation.
 */
interface LinksRejectResult {
  linkId: number;
  affectedLinkIds: number[];
  affectedLinkCount: number;
  newStatus: 'rejected';
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
 * Handler for rejecting transaction links.
 */
export class LinksRejectHandler {
  private readonly reviewService: TransferProposalReviewService;

  constructor(db: DataContext, overrideStore?: OverrideStore) {
    this.reviewService = new TransferProposalReviewService(db, overrideStore);
  }

  /**
   * Execute the links reject command.
   */
  async execute(params: LinksRejectParams): Promise<Result<LinksRejectResult, Error>> {
    const result = await this.reviewService.reject(params.linkId);
    if (result.isErr()) {
      return err(result.error);
    }

    return ok({
      ...result.value,
      newStatus: 'rejected',
    });
  }
}
