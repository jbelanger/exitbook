import { buildProfileLinkGapSourceReader } from '@exitbook/data/accounting';
import type { DataSession } from '@exitbook/data/session';
import { resultDoAsync, type Result } from '@exitbook/foundation';

import { cliErr, ExitCodes, toCliResult, type CliFailure } from '../../../cli/command.js';
import { getAccountSelectorErrorExitCode } from '../../accounts/account-selector.js';
import type { ViewCommandResult } from '../../shared/view-utils.js';
import { buildDefinedFilters, buildViewMeta } from '../../shared/view-utils.js';
import { buildTransactionRelatedContext } from '../transaction-investigation-context.js';
import {
  buildTransactionSelectorFilters,
  getTransactionSelectorErrorExitCode,
  resolveOwnedTransactionSelector,
  type ResolvedTransactionSelector,
} from '../transaction-selector.js';
import { loadTrackedTransactionIdentifiers } from '../transaction-tracked-identifiers.js';
import { toTransactionViewItem } from '../transaction-view-projection.js';
import type { TransactionViewItem } from '../transactions-view-model.js';
import { createTransactionsViewState, type TransactionsViewState } from '../view/index.js';

import {
  resolveTransactionsAccountFilter,
  type ResolvedTransactionsAccountFilter,
} from './transactions-account-filter.js';
import type { TransactionsBrowseFilters } from './transactions-browse-utils.js';
import {
  buildTransactionsJsonFiltersWithResolvedAccount,
  buildTransactionsViewFilters,
  parseSinceToUnixSeconds,
  validateUntilDate,
} from './transactions-browse-utils.js';
import type { TransactionsCommandScope } from './transactions-command-scope.js';
import { readTransactionsForCommand } from './transactions-read-support.js';

export interface TransactionsBrowseParams extends TransactionsBrowseFilters {
  providerData?: boolean | undefined;
  transactionSelector?: string | undefined;
}

export type TransactionsBrowseJsonListResult = ViewCommandResult<TransactionViewItem[]>;
export type TransactionsBrowseJsonDetailResult = ViewCommandResult<TransactionViewItem>;

export interface TransactionsBrowsePresentation {
  initialState: TransactionsViewState;
  listJsonResult: TransactionsBrowseJsonListResult;
  detailJsonResult?: TransactionsBrowseJsonDetailResult | undefined;
  selectedTransaction?: TransactionViewItem | undefined;
}

export async function buildTransactionsBrowsePresentation(
  scope: TransactionsCommandScope,
  params: TransactionsBrowseParams
): Promise<Result<TransactionsBrowsePresentation, CliFailure>> {
  return resultDoAsync(async function* () {
    const trackedIdentifiers = yield* toCliResult(
      await loadTrackedTransactionIdentifiers(scope.database, scope.profile.id),
      ExitCodes.GENERAL_ERROR
    );
    const selector = yield* await resolveSelectedTransaction(
      scope.database,
      scope.profile.id,
      params.transactionSelector
    );
    const accountFilter = yield* await resolveSelectedAccountFilter(scope.database, scope.profile.id, params.account);

    if (selector) {
      return yield* await buildDetailPresentation(scope, selector, trackedIdentifiers, {
        providerData: params.providerData,
      });
    }

    const since = yield* toCliResult(parseSinceToUnixSeconds(params.since), ExitCodes.INVALID_ARGS);
    yield* toCliResult(validateUntilDate(params.until), ExitCodes.INVALID_ARGS);

    const transactions = yield* toCliResult(
      await readTransactionsForCommand({
        db: scope.database,
        profileId: scope.profile.id,
        accountIds: accountFilter?.accountIds,
        platformKey: params.platform,
        address: params.address,
        from: params.from,
        to: params.to,
        since,
        until: params.until,
        assetId: params.assetId,
        assetSymbol: params.assetSymbol,
        operationType: params.operationType,
        noPrice: params.noPrice,
      }),
      ExitCodes.GENERAL_ERROR
    );

    return buildListPresentation(
      transactions.map((transaction) => toTransactionViewItem(transaction, trackedIdentifiers)),
      params,
      accountFilter
    );
  });
}

async function resolveSelectedAccountFilter(
  database: DataSession,
  profileId: number,
  accountSelector: string | undefined
): Promise<Result<ResolvedTransactionsAccountFilter | undefined, CliFailure>> {
  return resultDoAsync(async function* () {
    const accountFilterResult = await resolveTransactionsAccountFilter(database, profileId, accountSelector);
    if (accountFilterResult.isErr()) {
      return yield* cliErr(accountFilterResult.error, getAccountSelectorErrorExitCode(accountFilterResult.error));
    }

    return accountFilterResult.value;
  });
}

async function resolveSelectedTransaction(
  database: DataSession,
  profileId: number,
  transactionSelector: string | undefined
): Promise<Result<ResolvedTransactionSelector | undefined, CliFailure>> {
  return resultDoAsync(async function* () {
    if (!transactionSelector) {
      return undefined;
    }

    const selectorResult = await resolveOwnedTransactionSelector(
      {
        getByFingerprintRef: (ownerProfileId, fingerprintRef) =>
          database.transactions.findByFingerprintRef(ownerProfileId, fingerprintRef),
      },
      profileId,
      transactionSelector
    );

    if (selectorResult.isErr()) {
      return yield* cliErr(selectorResult.error, getTransactionSelectorErrorExitCode(selectorResult.error));
    }

    return selectorResult.value;
  });
}

async function buildDetailPresentation(
  scope: TransactionsCommandScope,
  selector: ResolvedTransactionSelector,
  trackedIdentifiers: ReadonlySet<string>,
  options: {
    providerData?: boolean | undefined;
  }
): Promise<Result<TransactionsBrowsePresentation, CliFailure>> {
  return resultDoAsync(async function* () {
    const rawSources =
      options.providerData === true
        ? yield* toCliResult(
            await scope.database.transactions.findRawTransactionsByTransactionId(
              selector.transaction.id,
              scope.profile.id
            ),
            ExitCodes.GENERAL_ERROR
          )
        : undefined;
    const profileLinkGapSourceReader = buildProfileLinkGapSourceReader(scope.database, scope.dataDir, {
      profileId: scope.profile.id,
      profileKey: scope.profile.profileKey,
    });
    const profileLinkGapSource = yield* toCliResult(
      await profileLinkGapSourceReader.loadProfileLinkGapSourceData(),
      ExitCodes.GENERAL_ERROR
    );
    const selectedTransaction = {
      ...toTransactionViewItem(selector.transaction, trackedIdentifiers),
      relatedContext: buildTransactionRelatedContext(profileLinkGapSource, selector.transaction),
      ...(rawSources !== undefined ? { rawSources } : {}),
    };
    const jsonFilters = buildDefinedFilters(buildTransactionSelectorFilters(selector));

    return {
      initialState: createTransactionsViewState([selectedTransaction], {}, 1),
      selectedTransaction,
      listJsonResult: {
        data: [selectedTransaction],
        meta: buildViewMeta(
          1,
          0,
          1,
          1,
          options.providerData === true ? { ...jsonFilters, providerData: true } : jsonFilters
        ),
      },
      detailJsonResult: {
        data: selectedTransaction,
        meta: buildViewMeta(
          1,
          0,
          1,
          1,
          options.providerData === true ? { ...jsonFilters, providerData: true } : jsonFilters
        ),
      },
    };
  });
}

function buildListPresentation(
  transactions: TransactionViewItem[],
  params: TransactionsBrowseParams,
  accountFilter: ResolvedTransactionsAccountFilter | undefined
): TransactionsBrowsePresentation {
  const filters = buildTransactionsViewFilters({
    ...params,
    account: accountFilter?.selector.value ?? params.account,
  });
  const totalCount = transactions.length;

  return {
    initialState: createTransactionsViewState(transactions, filters, totalCount),
    listJsonResult: {
      data: transactions,
      meta: buildViewMeta(
        totalCount,
        0,
        totalCount,
        totalCount,
        buildTransactionsJsonFiltersWithResolvedAccount(params, accountFilter)
      ),
    },
  };
}
