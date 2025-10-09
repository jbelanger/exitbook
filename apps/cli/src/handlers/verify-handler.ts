import type { BalanceVerificationResult } from '@exitbook/balance';
import { BalanceRepository, BalanceService, BalanceVerifier } from '@exitbook/balance';
import type { KyselyDB } from '@exitbook/data';
import { getLogger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

import { validateVerifyParams, type VerifyHandlerParams } from '../lib/verify-utils.js';

// Re-export for convenience
export type { VerifyHandlerParams };

const logger = getLogger('VerifyHandler');

/**
 * Result of the verify operation.
 */
export interface VerifyResult {
  /** Verification results */
  results: BalanceVerificationResult[];

  /** Generated report markdown (if generateReport is true) */
  report?: string | undefined;
}

/**
 * Verify handler - encapsulates all verify business logic.
 * Reusable by both CLI command and other contexts.
 */
export class VerifyHandler {
  private balanceService: BalanceService;
  private verifier: BalanceVerifier;

  constructor(private database: KyselyDB) {
    // Initialize services
    const balanceRepository = new BalanceRepository(this.database);
    this.balanceService = new BalanceService(balanceRepository);
    this.verifier = new BalanceVerifier(this.balanceService);
  }

  /**
   * Execute the verify operation.
   */
  async execute(params: VerifyHandlerParams): Promise<Result<VerifyResult, Error>> {
    try {
      // Validate parameters
      const validation = validateVerifyParams(params);
      if (validation.isErr()) {
        return err(validation.error);
      }

      logger.info(`Starting balance verification for ${params.sourceName}`);

      // Verify balances
      const results = await this.verifier.verifyBalancesForSource(params.sourceName);

      logger.info(`Balance verification completed for ${params.sourceName}`);

      // Generate report if requested
      let report: string | undefined;
      if (params.generateReport) {
        report = this.verifier.generateReport(results);
        logger.info('Verification report generated');
      }

      return ok({
        results,
        report,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Cleanup resources (none needed for VerifyHandler, but included for consistency).
   */
  destroy(): void {
    // No resources to cleanup
  }
}
