// Tier 1 handler for accounts view command

import { AccountQuery, type AccountListResult, type AccountQueryParams } from '@exitbook/app';
import type { Result } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';

export type { AccountListResult };

export type ViewAccountsParams = AccountQueryParams;

/**
 * Tier 1 handler for `accounts view`.
 * Wraps AccountQuery; testable with a mock database.
 */
export class AccountsViewHandler {
  private readonly accountQuery: AccountQuery;

  constructor(database: DataContext) {
    this.accountQuery = new AccountQuery(database);
  }

  execute(params: ViewAccountsParams): Promise<Result<AccountListResult, Error>> {
    return this.accountQuery.list(params);
  }
}
