import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { CliCommandError } from '../../shared/cli-command-error.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import type { ViewCommandResult } from '../../shared/view-utils.js';
import { buildDefinedFilters, buildViewMeta } from '../../shared/view-utils.js';
import { buildCliAccountLifecycleService } from '../account-service.js';
import { toAccountViewItem } from '../account-view-projection.js';
import type { AccountViewItem } from '../accounts-view-model.js';
import { AccountQuery, type AccountQueryParams } from '../query/account-query.js';
import { buildAccountQueryPorts } from '../query/build-account-query-ports.js';
import { computeTypeCounts, createAccountsViewState, type AccountsViewState } from '../view/accounts-view-state.js';

export interface AccountsBrowseParams extends Omit<AccountQueryParams, 'profileId'> {
  accountName?: string | undefined;
  preselectInExplorer?: boolean | undefined;
}

export type AccountsBrowseJsonListResult = ViewCommandResult<AccountViewItem[]>;
export type AccountsBrowseJsonDetailResult = ViewCommandResult<AccountViewItem>;

export interface AccountsBrowsePresentation {
  initialState: AccountsViewState;
  selectedAccount?: AccountViewItem | undefined;
  listJsonResult: AccountsBrowseJsonListResult;
  detailJsonResult?: AccountsBrowseJsonDetailResult | undefined;
}

export async function buildAccountsBrowsePresentation(
  ctx: CommandRuntime,
  params: AccountsBrowseParams
): Promise<AccountsBrowsePresentation> {
  const database = await ctx.database();
  const profileResult = await resolveCommandProfile(ctx, database);
  if (profileResult.isErr()) {
    throw new CliCommandError(profileResult.error.message, ExitCodes.GENERAL_ERROR, { cause: profileResult.error });
  }

  const accountIdResult = await resolveAccountIdByName(database, profileResult.value.id, params.accountName);
  if (accountIdResult.isErr()) {
    throw new CliCommandError(accountIdResult.error.message, ExitCodes.NOT_FOUND, { cause: accountIdResult.error });
  }

  const selectedAccountId = accountIdResult.value ?? params.accountId;
  const shouldPreselectAccount = params.preselectInExplorer === true && selectedAccountId !== undefined;

  const accountQuery = new AccountQuery(buildAccountQueryPorts(database));
  const result = await accountQuery.list({
    profileId: profileResult.value.id,
    accountId: shouldPreselectAccount ? undefined : selectedAccountId,
    accountType: params.accountType,
    platformKey: params.platformKey,
    showSessions: params.showSessions,
  });
  if (result.isErr()) {
    throw new CliCommandError(result.error.message, ExitCodes.GENERAL_ERROR, { cause: result.error });
  }

  const { accounts, count, sessions } = result.value;
  const viewItems = accounts.map((account) => toAccountViewItem(account, sessions));
  const selectedIndex =
    selectedAccountId !== undefined ? viewItems.findIndex((account) => account.id === selectedAccountId) : 0;

  if (shouldPreselectAccount && viewItems.length > 0 && selectedIndex < 0) {
    throw new CliCommandError(
      `Account '${params.accountName ?? selectedAccountId}' is not visible in the explorer`,
      ExitCodes.NOT_FOUND
    );
  }

  const selectedAccount = selectedIndex >= 0 ? viewItems[selectedIndex] : undefined;
  const filters = {
    platformFilter: params.platformKey,
    typeFilter: params.accountType,
    showSessions: params.showSessions ?? false,
  };
  const jsonFilters = buildDefinedFilters({
    accountName: params.accountName,
    accountId: selectedAccountId,
    platform: params.platformKey,
    accountType: params.accountType,
  });

  return {
    initialState: createAccountsViewState(
      viewItems,
      filters,
      count,
      computeTypeCounts(viewItems),
      selectedIndex >= 0 ? selectedIndex : undefined
    ),
    selectedAccount,
    listJsonResult: {
      data: viewItems,
      meta: buildViewMeta(count, 0, count, count, jsonFilters),
    },
    detailJsonResult:
      selectedAccount !== undefined
        ? {
            data: selectedAccount,
            meta: buildViewMeta(1, 0, 1, 1, jsonFilters),
          }
        : undefined,
  };
}

async function resolveAccountIdByName(
  database: DataSession,
  profileId: number,
  accountName?: string
): Promise<Result<number | undefined, Error>> {
  if (!accountName) {
    return ok(undefined);
  }

  const accountResult = await buildCliAccountLifecycleService(database).getByName(profileId, accountName);
  if (accountResult.isErr()) {
    return err(accountResult.error);
  }

  if (!accountResult.value) {
    return err(new Error(`Account '${accountName.trim().toLowerCase()}' not found`));
  }

  return ok(accountResult.value.id);
}

export function hasNavigableAccounts(state: AccountsViewState): boolean {
  return state.accounts.length > 0;
}
