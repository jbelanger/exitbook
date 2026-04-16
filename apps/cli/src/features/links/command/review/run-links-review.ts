import { resultDoAsync, type Result } from '@exitbook/foundation';

import type { LinksReviewCommandScope } from './links-review-command-scope.js';
import type { LinksReviewAction, LinksReviewActionResult, LinksReviewParams } from './links-review-handler.js';

export async function runLinksReview<TAction extends LinksReviewAction>(
  scope: LinksReviewCommandScope,
  params: LinksReviewParams,
  action: TAction
): Promise<Result<LinksReviewActionResult<TAction>, Error>> {
  return resultDoAsync(async function* () {
    const result = yield* await scope.handler.executeTyped(params, action);
    yield* await scope.refreshProfileIssues();
    return result;
  });
}
