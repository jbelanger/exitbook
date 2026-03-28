import { err, ok, type Result } from '@exitbook/foundation';

import type { AccountsRemoveCommandScope } from './accounts-remove-command-scope.js';
import type { FlatAccountRemovePreview } from './accounts-remove-handler.js';
import { flattenAccountRemovePreview } from './accounts-remove-handler.js';

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
    return err(new Error(`Account '${accountName.trim().toLowerCase()}' not found`));
  }

  const hierarchyResult = await scope.accountService.collectHierarchy(scope.profile.id, accountResult.value.id);
  if (hierarchyResult.isErr()) {
    return err(hierarchyResult.error);
  }

  const accountIds = hierarchyResult.value.map((account) => account.id);
  const previewResult = await scope.handler.preview(accountIds);
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
): Promise<ReturnType<AccountsRemoveCommandScope['handler']['execute']>> {
  return scope.handler.execute(accountIds);
}
