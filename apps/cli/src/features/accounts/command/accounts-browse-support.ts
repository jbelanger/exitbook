import type { DataSession } from '@exitbook/data/session';
import { resultDoAsync, type Result } from '@exitbook/foundation';

import { cliErr, ExitCodes, toCliResult, type CliFailure } from '../../../cli/command.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
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
): Promise<Result<AccountsBrowsePresentation, CliFailure>> {
  return resultDoAsync(async function* () {
    const database = await ctx.database();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const selectedAccountId =
      (yield* await resolveAccountIdByName(database, profile.id, params.accountName)) ?? params.accountId;
    const shouldPreselectAccount = params.preselectInExplorer === true && selectedAccountId !== undefined;

    const accountQuery = new AccountQuery(buildAccountQueryPorts(database));
    const result = yield* toCliResult(
      await accountQuery.list({
        profileId: profile.id,
        accountId: shouldPreselectAccount ? undefined : selectedAccountId,
        accountType: params.accountType,
        platformKey: params.platformKey,
        showSessions: params.showSessions,
      }),
      ExitCodes.GENERAL_ERROR
    );

    const { accounts, count, sessions } = result;
    const viewItems = accounts.map((account) => toAccountViewItem(account, sessions));
    const selectedIndex =
      selectedAccountId !== undefined ? viewItems.findIndex((account) => account.id === selectedAccountId) : 0;

    if (shouldPreselectAccount && viewItems.length > 0 && selectedIndex < 0) {
      return yield* cliErr(
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
  });
}

async function resolveAccountIdByName(
  database: DataSession,
  profileId: number,
  accountName?: string
): Promise<Result<number | undefined, CliFailure>> {
  return resultDoAsync(async function* () {
    if (!accountName) {
      return undefined;
    }

    const account = yield* toCliResult(
      await buildCliAccountLifecycleService(database).getByName(profileId, accountName),
      ExitCodes.GENERAL_ERROR
    );

    if (!account) {
      return yield* cliErr(`Account '${accountName.trim().toLowerCase()}' not found`, ExitCodes.NOT_FOUND);
    }

    return account.id;
  });
}

export function hasNavigableAccounts(state: AccountsViewState): boolean {
  return state.accounts.length > 0;
}
