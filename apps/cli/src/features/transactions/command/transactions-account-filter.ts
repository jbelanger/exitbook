import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';
import { loadBalanceScopeMemberAccounts } from '@exitbook/ingestion/ports';

import {
  buildAccountSelectorFilters,
  resolveOwnedOptionalAccountSelector,
  type ResolvedAccountSelector,
} from '../../accounts/account-selector.js';
import { createCliAccountLifecycleService } from '../../accounts/account-service.js';

export interface ResolvedTransactionsAccountFilter {
  accountIds: number[];
  selector: ResolvedAccountSelector;
}

export async function resolveTransactionsAccountFilter(
  database: DataSession,
  profileId: number,
  accountSelector: string | undefined
): Promise<Result<ResolvedTransactionsAccountFilter | undefined, Error>> {
  const selectorResult = await resolveOwnedOptionalAccountSelector(
    createCliAccountLifecycleService(database),
    profileId,
    accountSelector
  );
  if (selectorResult.isErr()) {
    return err(selectorResult.error);
  }

  const selector = selectorResult.value;
  if (!selector) {
    return ok(undefined);
  }

  const memberAccountsResult = await loadBalanceScopeMemberAccounts(selector.account, {
    findChildAccounts: async (parentAccountId: number) => {
      const childAccountsResult = await database.accounts.findAll({
        parentAccountId,
        profileId,
      });
      if (childAccountsResult.isErr()) {
        return err(childAccountsResult.error);
      }

      return ok(childAccountsResult.value);
    },
  });
  if (memberAccountsResult.isErr()) {
    return err(
      new Error(
        `Failed to load descendant accounts for account #${selector.account.id}: ${memberAccountsResult.error.message}`
      )
    );
  }

  return ok({
    accountIds: memberAccountsResult.value.map((account) => account.id),
    selector,
  });
}

export function buildTransactionsAccountFilters(
  accountFilter: Pick<ResolvedTransactionsAccountFilter, 'selector'> | undefined
): { account?: string | undefined } {
  return buildAccountSelectorFilters(accountFilter?.selector);
}

export function buildAccountPathSegment(
  accountFilter: Pick<ResolvedTransactionsAccountFilter, 'selector'> | undefined
): string | undefined {
  return sanitizePathSegment(accountFilter?.selector.value);
}

function sanitizePathSegment(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return sanitized.length > 0 ? sanitized : undefined;
}
