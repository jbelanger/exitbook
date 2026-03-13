import type { Result } from '@exitbook/core';

import type { AccountQueryPorts } from '../query/account-query-ports.js';
import { AccountQuery, type AccountListResult, type AccountQueryParams } from '../query/account-query.js';

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
