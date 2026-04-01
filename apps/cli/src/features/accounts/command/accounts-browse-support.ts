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

export interface AccountsBrowseParams extends Omit<AccountQueryParams, 'profileId' | 'accountId'> {
  accountRef?: string | undefined;
  accountSelector?: string | undefined;
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
    const selection = yield* await resolveSelectedAccount(database, profile.id, params);
    const selectedAccountId = selection.accountId;
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
        `Account '${params.accountSelector ?? params.accountRef ?? selectedAccountId}' is not visible in the explorer`,
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
      accountName: selection.accountName,
      accountRef: selection.accountRef,
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

interface ResolvedSelectedAccount {
  accountId?: number | undefined;
  accountName?: string | undefined;
  accountRef?: string | undefined;
}

async function resolveSelectedAccount(
  database: DataSession,
  profileId: number,
  params: AccountsBrowseParams
): Promise<Result<ResolvedSelectedAccount, CliFailure>> {
  return resultDoAsync(async function* () {
    const accountService = buildCliAccountLifecycleService(database);

    if (params.accountSelector) {
      const accountByName = yield* toCliResult(
        await accountService.getByName(profileId, params.accountSelector),
        ExitCodes.GENERAL_ERROR
      );
      if (accountByName) {
        return {
          accountId: accountByName.id,
          accountName: accountByName.name ?? params.accountSelector.trim().toLowerCase(),
        };
      }

      const accountByRef = yield* toCliResult(
        await accountService.getByFingerprintRef(profileId, params.accountSelector),
        ExitCodes.INVALID_ARGS
      );
      if (accountByRef) {
        return {
          accountId: accountByRef.id,
          accountRef: params.accountSelector.trim().toLowerCase(),
        };
      }

      return yield* cliErr(
        `Account selector '${params.accountSelector.trim().toLowerCase()}' not found`,
        ExitCodes.NOT_FOUND
      );
    }

    if (!params.accountRef) {
      return {};
    }

    const account = yield* toCliResult(
      await accountService.getByFingerprintRef(profileId, params.accountRef),
      ExitCodes.INVALID_ARGS
    );
    if (!account) {
      return yield* cliErr(`Account ref '${params.accountRef}' not found`, ExitCodes.NOT_FOUND);
    }

    return {
      accountId: account.id,
      accountRef: params.accountRef,
    };
  });
}

export function hasNavigableAccounts(state: AccountsViewState): boolean {
  return state.accounts.length > 0;
}
