import { err, ok, type Result } from '@exitbook/foundation';

import type { FlatAccountRemovePreview } from './account-removal-service.js';
import { flattenAccountRemovePreview } from './account-removal-service.js';
import type { AccountsRemoveCommandScope } from './accounts-remove-command-scope.js';
import { AccountRemovalTargetNotFoundError } from './accounts-remove-errors.js';

export interface AccountRemovalPreparation {
  accountIds: number[];
  accountName: string;
  preview: FlatAccountRemovePreview;
}

export async function prepareAccountRemoval(
  scope: AccountsRemoveCommandScope,
  accountName: string
): Promise<Result<AccountRemovalPreparation, Error>> {
  const accountResult = await scope.accountService.getByName(scope.profile.id, accountName);
  if (accountResult.isErr()) {
    return err(accountResult.error);
  }
  if (!accountResult.value) {
    return err(new AccountRemovalTargetNotFoundError(accountName));
  }

  const hierarchyResult = await scope.accountService.collectHierarchy(scope.profile.id, accountResult.value.id);
  if (hierarchyResult.isErr()) {
    return err(hierarchyResult.error);
  }

  const accountIds = hierarchyResult.value.map((account) => account.id);
  const previewResult = await scope.accountRemovalService.preview(accountIds);
  if (previewResult.isErr()) {
    return err(previewResult.error);
  }

  return ok({
    accountIds,
    accountName: accountResult.value.name ?? accountName.trim().toLowerCase(),
    preview: flattenAccountRemovePreview(previewResult.value),
  });
}

export async function runAccountRemoval(
  scope: AccountsRemoveCommandScope,
  accountIds: number[]
): Promise<ReturnType<AccountsRemoveCommandScope['accountRemovalService']['execute']>> {
  return scope.accountRemovalService.execute(accountIds);
}
