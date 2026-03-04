import type { Account } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import type { Result } from 'neverthrow';

export interface AccountQueryParams {
  sourceType?: string | undefined;
  source?: string | undefined;
}

export interface AccountView {
  account: Account;
  sessionCount?: number | undefined;
  children?: AccountView[] | undefined;
}

export interface AccountListResult {
  accounts: AccountView[];
  total: number;
}

/**
 * Read model for account views.
 *
 * Builds account hierarchy (parent/child for xpub), attaches session summaries,
 * scopes to default user.
 */
export class AccountQuery {
  constructor(private readonly db: DataContext) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async list(params?: AccountQueryParams): Promise<Result<AccountListResult, Error>> {
    throw new Error('Not implemented');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async findById(id: number): Promise<Result<AccountView | undefined, Error>> {
    throw new Error('Not implemented');
  }
}
