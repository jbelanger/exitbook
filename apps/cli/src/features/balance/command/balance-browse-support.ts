import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';

import {
  getAccountSelectorErrorExitCode,
  resolveOwnedOptionalAccountSelector,
  type ResolvedAccountSelector,
} from '../../accounts/account-selector.js';
import {
  createBalanceStoredSnapshotAssetState,
  createBalanceStoredSnapshotState,
  type BalanceStoredSnapshotAssetState,
  type BalanceStoredSnapshotState,
} from '../view/balance-view-state.js';
import { buildStoredSnapshotAccountItem, sortStoredSnapshotAssets } from '../view/balance-view-utils.js';

import type { BalanceCommandScope } from './balance-command-scope.js';
import type { StoredSnapshotAccountResult, StoredSnapshotBalanceResult } from './balance-handler-types.js';
import { runBalanceView } from './run-balance.js';

export interface BalanceBrowseParams {
  accountSelector?: string | undefined;
}

export interface BalanceBrowseJsonResult {
  data: {
    accounts: {
      accountId: number;
      accountType: string;
      assets: {
        assetId: string;
        assetSymbol: string;
        calculatedBalance: string;
        diagnostics: unknown;
      }[];
      platformKey: string;
      requestedAccount?:
        | {
            accountType: string;
            id: number;
            platformKey: string;
          }
        | undefined;
      snapshot: {
        lastRefreshAt: string | undefined;
        statusReason: string | undefined;
        suggestion: string | undefined;
        verificationStatus: string | undefined;
      };
    }[];
  };
  metadata: {
    mode: 'view';
    selector?:
      | {
          kind: ResolvedAccountSelector['kind'];
          value: string;
        }
      | undefined;
    totalAccounts: number;
  };
}

export interface BalanceBrowsePresentation {
  detailState?: BalanceStoredSnapshotAssetState | undefined;
  initialState: BalanceStoredSnapshotState;
  jsonResult: BalanceBrowseJsonResult;
  selectedAccountResult?: StoredSnapshotAccountResult | undefined;
  selection?: ResolvedAccountSelector | undefined;
}

export async function buildBalanceBrowsePresentation(
  scope: BalanceCommandScope,
  params: BalanceBrowseParams
): Promise<Result<BalanceBrowsePresentation, Error>> {
  return resultDoAsync(async function* () {
    const selection = yield* await resolveSelection(scope, params.accountSelector);
    const result = yield* await runBalanceView(scope, {
      accountId: selection?.account.id,
    });

    const initialState = createBalanceStoredSnapshotState(
      result.accounts.map((item) => buildStoredSnapshotAccountStateItem(item))
    );
    const selectedAccountResult = selection ? result.accounts[0] : undefined;
    const detailState = selectedAccountResult ? createDetailState(selectedAccountResult) : undefined;

    return {
      detailState,
      initialState,
      jsonResult: buildBalanceBrowseJsonResult(selection, result),
      selectedAccountResult,
      selection,
    };
  });
}

export function hasNavigableBalances(state: BalanceStoredSnapshotState): boolean {
  return state.accounts.length > 0;
}

function buildBalanceBrowseJsonResult(
  selection: ResolvedAccountSelector | undefined,
  result: StoredSnapshotBalanceResult
): BalanceBrowseJsonResult {
  return {
    data: {
      accounts: result.accounts.map((item) => ({
        accountId: item.account.id,
        platformKey: item.account.platformKey,
        accountType: item.account.accountType,
        snapshot: {
          verificationStatus: item.snapshot.verificationStatus,
          statusReason: item.snapshot.statusReason,
          suggestion: item.snapshot.suggestion,
          lastRefreshAt: item.snapshot.lastRefreshAt?.toISOString(),
        },
        requestedAccount: item.requestedAccount
          ? {
              id: item.requestedAccount.id,
              platformKey: item.requestedAccount.platformKey,
              accountType: item.requestedAccount.accountType,
            }
          : undefined,
        assets: item.assets.map((asset) => ({
          assetId: asset.assetId,
          assetSymbol: asset.assetSymbol,
          calculatedBalance: asset.calculatedBalance,
          diagnostics: asset.diagnostics,
        })),
      })),
    },
    metadata: {
      totalAccounts: result.accounts.length,
      mode: 'view',
      selector: selection
        ? {
            kind: selection.kind,
            value: selection.value,
          }
        : undefined,
    },
  };
}

function buildStoredSnapshotAccountStateItem(item: StoredSnapshotAccountResult) {
  return buildStoredSnapshotAccountItem(item.account, sortStoredSnapshotAssets(item.assets), item.snapshot);
}

function createDetailState(result: StoredSnapshotAccountResult): BalanceStoredSnapshotAssetState {
  return createBalanceStoredSnapshotAssetState(
    {
      accountId: result.account.id,
      platformKey: result.account.platformKey,
      accountType: result.account.accountType,
      verificationStatus: result.snapshot.verificationStatus,
      statusReason: result.snapshot.statusReason,
      suggestion: result.snapshot.suggestion,
      lastRefreshAt: result.snapshot.lastRefreshAt?.toISOString(),
    },
    sortStoredSnapshotAssets(result.assets)
  );
}

async function resolveSelection(
  scope: BalanceCommandScope,
  accountSelector: string | undefined
): Promise<Result<ResolvedAccountSelector | undefined, Error>> {
  const selectionResult = await resolveOwnedOptionalAccountSelector(
    scope.accountService,
    scope.profile.id,
    accountSelector
  );
  if (selectionResult.isErr()) {
    return err(selectionResult.error);
  }

  return ok(selectionResult.value);
}

export { getAccountSelectorErrorExitCode };
