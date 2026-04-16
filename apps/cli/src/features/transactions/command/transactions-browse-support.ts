import type { DataSession } from '@exitbook/data/session';
import { resultDoAsync, type Result } from '@exitbook/foundation';

import { cliErr, ExitCodes, toCliResult, type CliFailure } from '../../../cli/command.js';
import type { ViewCommandResult } from '../../shared/view-utils.js';
import { buildDefinedFilters, buildViewMeta } from '../../shared/view-utils.js';
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

import type { TransactionsBrowseFilters } from './transactions-browse-utils.js';
import {
  buildTransactionsJsonFilters,
  buildTransactionsViewFilters,
  parseSinceToUnixSeconds,
  validateUntilDate,
} from './transactions-browse-utils.js';
import type { TransactionsCommandScope } from './transactions-command-scope.js';
import { readTransactionsForCommand } from './transactions-read-support.js';

export interface TransactionsBrowseParams extends TransactionsBrowseFilters {
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

    if (selector) {
      return buildDetailPresentation(selector, trackedIdentifiers);
    }

    const since = yield* toCliResult(parseSinceToUnixSeconds(params.since), ExitCodes.INVALID_ARGS);
    yield* toCliResult(validateUntilDate(params.until), ExitCodes.INVALID_ARGS);

    const transactions = yield* toCliResult(
      await readTransactionsForCommand({
        db: scope.database,
        profileId: scope.profile.id,
        platformKey: params.platform,
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
      params
    );
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

function buildDetailPresentation(
  selector: ResolvedTransactionSelector,
  trackedIdentifiers: ReadonlySet<string>
): TransactionsBrowsePresentation {
  const selectedTransaction = toTransactionViewItem(selector.transaction, trackedIdentifiers);
  const jsonFilters = buildDefinedFilters(buildTransactionSelectorFilters(selector));

  return {
    initialState: createTransactionsViewState([selectedTransaction], {}, 1),
    selectedTransaction,
    listJsonResult: {
      data: [selectedTransaction],
      meta: buildViewMeta(1, 0, 1, 1, jsonFilters),
    },
    detailJsonResult: {
      data: selectedTransaction,
      meta: buildViewMeta(1, 0, 1, 1, jsonFilters),
    },
  };
}

function buildListPresentation(
  transactions: TransactionViewItem[],
  params: TransactionsBrowseParams
): TransactionsBrowsePresentation {
  const filters = buildTransactionsViewFilters(params);
  const totalCount = transactions.length;

  return {
    initialState: createTransactionsViewState(transactions, filters, totalCount),
    listJsonResult: {
      data: transactions,
      meta: buildViewMeta(totalCount, 0, totalCount, totalCount, buildTransactionsJsonFilters(params)),
    },
  };
}
