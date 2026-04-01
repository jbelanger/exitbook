import { err, ok, type Result } from '@exitbook/foundation';

import { formatAccountSelectorLabel, resolveRequiredOwnedAccountSelector } from '../account-selector.js';

import type { AccountRemovalImpactCounts } from './account-removal-service.js';
import { flattenAccountRemovePreview } from './account-removal-service.js';
import type { AccountsRemoveCommandScope } from './accounts-remove-command-scope.js';

export interface AccountRemovalPreparation {
  accountLabel: string;
  accountIds: number[];
  preview: AccountRemovalImpactCounts;
}

export async function prepareAccountRemoval(
  scope: AccountsRemoveCommandScope,
  selector: string
): Promise<Result<AccountRemovalPreparation, Error>> {
  const selection = await resolveRequiredOwnedAccountSelector(
    scope.accountService,
    scope.profile.id,
    selector,
    'Account removal requires an account selector'
  );
  if (selection.isErr()) {
    return err(selection.error);
  }

  const hierarchyResult = await scope.accountService.collectHierarchy(scope.profile.id, selection.value.account.id);
  if (hierarchyResult.isErr()) {
    return err(hierarchyResult.error);
  }

  const accountIds = hierarchyResult.value.map((account) => account.id);
  const previewResult = await scope.accountRemovalService.preview(accountIds);
  if (previewResult.isErr()) {
    return err(previewResult.error);
  }

  return ok({
    accountLabel: formatAccountSelectorLabel(selection.value.account),
    accountIds,
    preview: flattenAccountRemovePreview(previewResult.value),
  });
}

export async function runAccountRemoval(
  scope: AccountsRemoveCommandScope,
  accountIds: number[]
): Promise<ReturnType<AccountsRemoveCommandScope['accountRemovalService']['execute']>> {
  return scope.accountRemovalService.execute(accountIds);
}
