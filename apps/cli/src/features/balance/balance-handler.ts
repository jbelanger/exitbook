import type { BalanceService, BalanceServiceParams } from '@exitbook/ingestion';
import type { BalanceVerificationResult } from '@exitbook/ingestion';
import type { Result } from 'neverthrow';

/**
 * Balance handler - thin wrapper around BalanceService.
 * Delegates to service with account ID.
 * Reusable by both CLI command and other contexts.
 */
export class BalanceHandler {
  constructor(private balanceService: BalanceService) {}

  /**
   * Execute the balance verification operation.
   */
  async execute(params: BalanceServiceParams): Promise<Result<BalanceVerificationResult, Error>> {
    return this.balanceService.verifyBalance({
      accountId: params.accountId,
      credentials: params.credentials,
    });
  }

  /**
   * Cleanup resources (delegates to service).
   */
  destroy(): void {
    this.balanceService.destroy();
  }
}
