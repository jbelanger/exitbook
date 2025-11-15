import type { BalanceService } from '@exitbook/ingestion';
import type { BalanceVerificationResult } from '@exitbook/ingestion';
import type { Result } from 'neverthrow';
import { err } from 'neverthrow';

import type { BalanceHandlerParams } from './balance-utils.js';
import { getExchangeCredentialsFromEnv, validateBalanceParams } from './balance-utils.js';

/**
 * Balance handler - thin wrapper around BalanceService.
 * Handles credential resolution from environment and delegates to service.
 * Reusable by both CLI command and other contexts.
 */
export class BalanceHandler {
  constructor(private balanceService: BalanceService) {}

  /**
   * Execute the balance verification operation.
   */
  async execute(params: BalanceHandlerParams): Promise<Result<BalanceVerificationResult, Error>> {
    try {
      // Validate parameters
      const validation = validateBalanceParams(params);
      if (validation.isErr()) {
        return err(validation.error);
      }

      // For exchange balance, try to get credentials from env if not provided
      let credentials = params.credentials;
      if (params.sourceType === 'exchange' && !credentials) {
        const envCredentials = getExchangeCredentialsFromEnv(params.sourceName);
        if (envCredentials.isErr()) {
          return err(
            new Error(
              `No credentials provided. Either use --api-key and --api-secret flags, or set ${params.sourceName.toUpperCase()}_API_KEY and ${params.sourceName.toUpperCase()}_SECRET in .env`
            )
          );
        }
        credentials = envCredentials.value;
      }

      // Delegate to service
      return this.balanceService.verifyBalance({
        sourceName: params.sourceName,
        sourceType: params.sourceType,
        address: params.address,
        credentials,
        providerName: params.providerName,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    // No resources to cleanup in handler
  }
}
