// Tier 1 handler for accounts view command

import type { DataContext } from '@exitbook/data';
import { AccountService, type AccountListResult, type ViewAccountsParams } from '@exitbook/ingestion';
import type { Result } from 'neverthrow';

export type { AccountListResult, ViewAccountsParams };

/**
 * Tier 1 handler for `accounts view`.
 * Wraps AccountService; testable with a mock database.
 */
export class AccountsViewHandler {
  private readonly accountService: AccountService;

  constructor(database: DataContext) {
    this.accountService = new AccountService(database);
  }

  execute(params: ViewAccountsParams): Promise<Result<AccountListResult, Error>> {
    return this.accountService.viewAccounts(params);
  }
}
