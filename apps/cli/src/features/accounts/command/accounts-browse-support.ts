import type { DataSession } from '@exitbook/data/session';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';

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
  type ResolvedAccountSelector,
} from '../account-selector.js';
import { createCliAccountLifecycleService } from '../account-service.js';
import { toAccountViewItem } from '../account-view-projection.js';
import type { AccountDetailViewItem, AccountViewItem } from '../accounts-view-model.js';
import { AccountQuery, type AccountQueryParams } from '../query/account-query.js';
import { buildAccountQueryPorts } from '../query/build-account-query-ports.js';
import { createAccountsViewState, type AccountsListViewState } from '../view/accounts-view-state.js';

import { buildAccountDetailViewItem } from './accounts-detail-support.js';

export interface AccountsBrowseParams extends Omit<AccountQueryParams, 'profileId' | 'accountId'> {
  accountSelector?: string | undefined;
  includeExplorerDetails?: boolean | undefined;
  preselectInExplorer?: boolean | undefined;
}

export type AccountsBrowseJsonListResult = ViewCommandResult<AccountViewItem[]>;
export type AccountsBrowseJsonDetailResult = ViewCommandResult<AccountDetailViewItem>;

export interface AccountsBrowsePresentation {
  initialState: AccountsListViewState;
  selectedAccount?: AccountDetailViewItem | undefined;
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
    const accountService = createCliAccountLifecycleService(database);
    const selection = yield* await resolveSelectedAccount(accountService, profile.id, params);
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

    const selectedAccountSummary = selectedIndex >= 0 ? viewItems[selectedIndex] : undefined;
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
    const accountDetailsById =
      params.includeExplorerDetails === true
        ? yield* toCliResult(
            await buildExplorerAccountDetails({
              accountService,
              database,
              profileId: profile.id,
              summaries: viewItems,
            }),
            ExitCodes.GENERAL_ERROR
          )
        : undefined;

    const selectedAccount =
      selectedAccountId !== undefined && shouldPreselectAccount !== true && selectedAccountSummary !== undefined
        ? yield* toCliResult(
            await buildAccountDetailViewItem({
              accountId: selectedAccountId,
              accountService,
              database,
              profileId: profile.id,
              summary: selectedAccountSummary,
            }),
            ExitCodes.GENERAL_ERROR
          )
        : undefined;

    return {
      initialState: createAccountsViewState(
        viewItems,
        filters,
        count,
        undefined,
        selectedIndex >= 0 ? selectedIndex : undefined,
        accountDetailsById
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

interface BuildExplorerAccountDetailsParams {
  accountService: ReturnType<typeof createCliAccountLifecycleService>;
  database: DataSession;
  profileId: number;
  summaries: AccountViewItem[];
}

async function buildExplorerAccountDetails(
  params: BuildExplorerAccountDetailsParams
): Promise<Result<Record<number, AccountDetailViewItem>, Error>> {
  const detailResults = await Promise.all(
    params.summaries.map((summary) =>
      buildAccountDetailViewItem({
        accountId: summary.id,
        accountService: params.accountService,
        database: params.database,
        profileId: params.profileId,
        summary,
      })
    )
  );

  const detailsById: Record<number, AccountDetailViewItem> = {};
  for (const detailResult of detailResults) {
    if (detailResult.isErr()) {
      return err(detailResult.error);
    }

    const detail = detailResult.value;
    detailsById[detail.id] = detail;
  }

  return ok(detailsById);
}

interface ResolvedSelectedAccount {
  accountId?: number | undefined;
  requestedLabel?: string | undefined;
  selector?: ResolvedAccountSelector | undefined;
}

async function resolveSelectedAccount(
  accountService: ReturnType<typeof createCliAccountLifecycleService>,
  profileId: number,
  params: AccountsBrowseParams
): Promise<Result<ResolvedSelectedAccount, CliFailure>> {
  return resultDoAsync(async function* () {
    const requestedSelector = params.accountSelector;
    if (!requestedSelector) {
      return {};
    }

    const selectorResult = await resolveOwnedAccountSelector(accountService, profileId, requestedSelector);
    if (selectorResult.isErr()) {
      return yield* cliErr(selectorResult.error, getAccountSelectorErrorExitCode(selectorResult.error));
    }
    const selector = selectorResult.value;

    return {
      accountId: selector.account.id,
      requestedLabel: formatResolvedAccountSelectorInput(selector),
      selector,
    };
  });
}

export function hasNavigableAccounts(state: AccountsListViewState): boolean {
  return state.accounts.length > 0;
}
