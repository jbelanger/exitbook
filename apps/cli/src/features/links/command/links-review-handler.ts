import type { OverrideStore } from '@exitbook/data/overrides';
import { DataSession } from '@exitbook/data/session';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';

import { TransferProposalReviewService } from './transfer-proposal-review-service.js';

export type LinksReviewAction = 'confirm' | 'reject';

export interface LinksReviewParams {
  linkId: number;
}

export interface LinksReviewResult {
  linkId: number;
  affectedLinkIds: number[];
  affectedLinkCount: number;
  newStatus: 'confirmed' | 'rejected';
  reviewedBy: string;
  reviewedAt: Date;
  asset?: string | undefined;
  sourceAmount?: string | undefined;
  targetAmount?: string | undefined;
  platformKey?: string | undefined;
  targetName?: string | undefined;
  confidence?: string | undefined;
  transferProposalKey?: string | undefined;
}

export type LinksReviewActionResult<TAction extends LinksReviewAction> = LinksReviewResult & {
  newStatus: (typeof ACTION_STATUS)[TAction];
};

const ACTION_STATUS = {
  confirm: 'confirmed',
  reject: 'rejected',
} as const;

export class LinksReviewHandler {
  private readonly reviewService: TransferProposalReviewService;

  constructor(db: DataSession, overrideStore?: OverrideStore) {
    this.reviewService = new TransferProposalReviewService(db, overrideStore);
  }

  async execute(params: LinksReviewParams, action: LinksReviewAction): Promise<Result<LinksReviewResult, Error>> {
    return this.executeTyped(params, action);
  }

  async executeTyped<TAction extends LinksReviewAction>(
    params: LinksReviewParams,
    action: TAction
  ): Promise<Result<LinksReviewActionResult<TAction>, Error>> {
    const result =
      action === 'confirm'
        ? await this.reviewService.confirm(params.linkId)
        : await this.reviewService.reject(params.linkId);
    if (result.isErr()) {
      return err(result.error);
    }

    return ok({
      ...result.value,
      newStatus: ACTION_STATUS[action],
    } as LinksReviewActionResult<TAction>);
  }
}
