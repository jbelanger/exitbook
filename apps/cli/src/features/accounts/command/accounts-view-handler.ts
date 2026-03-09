// Tier 1 handler for accounts view command

import { AccountQuery, type AccountListResult, type AccountQueryParams } from '@exitbook/accounts';
import type { AccountQueryPorts } from '@exitbook/accounts/ports';
import type { Result } from '@exitbook/core';

export type { AccountListResult };

export type ViewAccountsParams = AccountQueryParams;

/**
 * Tier 1 handler for `accounts view`.
 * Wraps AccountQuery; testable with mock ports.
 */
export class AccountsViewHandler {
  private readonly accountQuery: AccountQuery;

  constructor(ports: AccountQueryPorts) {
    this.accountQuery = new AccountQuery(ports);
  }

  execute(params: ViewAccountsParams): Promise<Result<AccountListResult, Error>> {
    return this.accountQuery.list(params);
  }
}
