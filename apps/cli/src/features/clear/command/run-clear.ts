import type { Result } from '@exitbook/foundation';

import type { ClearCommandScope } from './clear-command-scope.js';
import type { ClearCommandOptions } from './clear-command-types.js';
import type { ClearParams, ClearResult, DeletionPreview } from './clear-service.js';

export function buildClearParams(
  scope: ClearCommandScope,
  options: ClearCommandOptions,
  selectedAccountId?: number
): ClearParams {
  return {
    profileId: scope.profile.id,
    accountId: selectedAccountId,
    platformKey: options.platform,
    includeRaw: options.includeRaw ?? false,
  };
}

export async function previewClear(
  scope: ClearCommandScope,
  params: ClearParams
): Promise<Result<DeletionPreview, Error>> {
  return scope.clearService.preview(params);
}

export async function runClear(scope: ClearCommandScope, params: ClearParams): Promise<Result<ClearResult, Error>> {
  return scope.clearService.execute(params);
}
