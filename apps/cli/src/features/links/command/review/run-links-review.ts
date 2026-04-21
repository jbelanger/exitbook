import { resultDoAsync, type Result } from '@exitbook/foundation';

import type { LinksReviewAction, LinksReviewActionResult, LinksReviewParams } from './links-review-handler.js';

export interface LinksReviewExecutionScope {
  handler: {
    executeTyped<TAction extends LinksReviewAction>(
      params: LinksReviewParams,
      action: TAction
    ): Promise<Result<LinksReviewActionResult<TAction>, Error>>;
  };
  refreshProfileIssues(): Promise<Result<void, Error>>;
}

export async function runLinksReview<TAction extends LinksReviewAction>(
  scope: LinksReviewExecutionScope,
  params: LinksReviewParams,
  action: TAction
): Promise<Result<LinksReviewActionResult<TAction>, Error>> {
  return resultDoAsync(async function* () {
    const result = yield* await scope.handler.executeTyped(params, action);
    if (!result.changed) {
      return result;
    }

    yield* await scope.refreshProfileIssues();
    return result;
  });
}
