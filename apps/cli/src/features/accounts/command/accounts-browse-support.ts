import type { DataSession } from '@exitbook/data/session';
import { resultDoAsync, type Result } from '@exitbook/foundation';

import { cliErr, ExitCodes, toCliResult, type CliFailure } from '../../../cli/command.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import type { ViewCommandResult } from '../../shared/view-utils.js';
import { buildDefinedFilters, buildViewMeta } from '../../shared/view-utils.js';
import {
  buildAccountSelectorFilters,
  formatResolvedAccountSelectorInput,
  getAccountSelectorErrorExitCode,
  resolveOwnedAccountSelector,
  resolveOwnedBrowseAccountSelector,
  type ResolvedAccountSelector,
} from '../account-selector.js';
import { createCliAccountLifecycleService } from '../account-service.js';
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
        `${selection.requestedLabel ?? `Account '${selectedAccountId}'`} is not visible in the explorer`,
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
      ...buildAccountSelectorFilters(selection.selector),
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
  requestedLabel?: string | undefined;
  selector?: ResolvedAccountSelector | undefined;
}

async function resolveSelectedAccount(
  database: DataSession,
  profileId: number,
  params: AccountsBrowseParams
): Promise<Result<ResolvedSelectedAccount, CliFailure>> {
  return resultDoAsync(async function* () {
    const accountService = createCliAccountLifecycleService(database);

    if (params.accountSelector) {
      const selectorResult = await resolveOwnedBrowseAccountSelector(accountService, profileId, params.accountSelector);
      if (selectorResult.isErr()) {
        return yield* cliErr(selectorResult.error, getAccountSelectorErrorExitCode(selectorResult.error));
      }

      const selector = selectorResult.value;
      return {
        accountId: selector.account.id,
        requestedLabel: formatResolvedAccountSelectorInput(selector),
        selector,
      };
    }

    if (!params.accountRef) {
      return {};
    }

    const selectorResult = await resolveOwnedAccountSelector(accountService, profileId, {
      accountRef: params.accountRef,
    });
    if (selectorResult.isErr()) {
      return yield* cliErr(selectorResult.error, getAccountSelectorErrorExitCode(selectorResult.error));
    }
    if (!selectorResult.value) {
      return yield* cliErr(`Account ref '${params.accountRef}' not found`, ExitCodes.NOT_FOUND);
    }
    const selector = selectorResult.value;

    return {
      accountId: selector.account.id,
      requestedLabel: formatResolvedAccountSelectorInput(selector),
      selector,
    };
  });
}

export function hasNavigableAccounts(state: AccountsViewState): boolean {
  return state.accounts.length > 0;
}
