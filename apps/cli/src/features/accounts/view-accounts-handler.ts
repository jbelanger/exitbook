import type { AccountService } from '@exitbook/ingestion';
import type { Result } from 'neverthrow';

import type { ViewAccountsParams, ViewAccountsResult } from './view-accounts-utils.js';

/**
 * Handler for viewing accounts - thin wrapper around AccountService.
 * Converts CLI params to service params and delegates all logic.
 */
export class ViewAccountsHandler {
  constructor(private readonly accountService: AccountService) {}

  /**
   * Execute the view accounts command.
   */
  async execute(params: ViewAccountsParams): Promise<Result<ViewAccountsResult, Error>> {
    // Delegate to service
    const result = await this.accountService.viewAccounts({
      accountId: params.accountId,
      accountType: params.accountType,
      source: params.source,
      showSessions: params.showSessions,
    });

    if (result.isErr()) {
      return result;
    }

    // Map service result to handler result (types are compatible)
    return result as Result<ViewAccountsResult, Error>;
  }
}
