import { type PricesEnrichOptions, type PricesEnrichResult } from '@exitbook/accounting';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { CommandScope } from '../../../runtime/command-scope.js';
import {
  createCliPriceEnrichmentRuntime,
  type CliPriceEnrichmentRuntime,
} from '../../../runtime/price-enrichment-runtime.js';
import { loadAccountingExclusionPolicy } from '../../shared/accounting-exclusion-policy.js';
import type { InfrastructureHandler } from '../../shared/handler-contracts.js';

const logger = getLogger('PricesEnrichHandler');

/**
 * Tier 2 handler for `prices enrich`.
 * Factory owns cleanup; command file never calls ctx.onCleanup().
 */
export class PricesEnrichHandler implements InfrastructureHandler<PricesEnrichOptions, PricesEnrichResult> {
  constructor(private readonly runtime: CliPriceEnrichmentRuntime) {}

  async execute(params: PricesEnrichOptions): Promise<Result<PricesEnrichResult, Error>> {
    try {
      if (this.runtime.controller) {
        await this.runtime.controller.start();
      }

      const result = await this.runtime.pipeline.execute(params, this.runtime.priceRuntime);

      if (result.isErr()) {
        if (this.runtime.controller) {
          this.runtime.controller.fail(result.error.message);
          await this.runtime.controller.stop();
        }
        return err(result.error);
      }

      if (this.runtime.controller) {
        this.runtime.controller.complete();
        await this.runtime.controller.stop();
      }

      return ok(result.value);
    } catch (error) {
      if (this.runtime.controller) {
        const message = error instanceof Error ? error.message : String(error);
        this.runtime.controller.fail(message);
        await this.runtime.controller.stop().catch((e) => {
          logger.warn({ e }, 'Failed to stop controller after exception');
        });
      }
      return wrapError(error, 'Price enrichment failed');
    }
  }

  abort(): void {
    if (this.runtime.controller) {
      this.runtime.controller.abort();
      void this.runtime.controller.stop().catch((e) => {
        logger.warn({ e }, 'Failed to stop controller on abort');
      });
    }
  }
}

/**
 * Create a PricesEnrichHandler with appropriate infrastructure.
 * Factory registers ctx.onCleanup() -- command files NEVER do.
 */
export async function createPricesEnrichHandler(
  ctx: CommandScope,
  options: { isJsonMode: boolean }
): Promise<Result<PricesEnrichHandler, Error>> {
  try {
    const database = await ctx.database();
    const accountingExclusionPolicyResult = await loadAccountingExclusionPolicy(ctx.dataDir);
    if (accountingExclusionPolicyResult.isErr()) {
      return err(accountingExclusionPolicyResult.error);
    }
    const accountingExclusionPolicy = accountingExclusionPolicyResult.value;
    const runtimeResult = await createCliPriceEnrichmentRuntime({
      accountingExclusionPolicy,
      database,
      isJsonMode: options.isJsonMode,
      scope: ctx,
    });
    if (runtimeResult.isErr()) {
      return err(runtimeResult.error);
    }

    return ok(new PricesEnrichHandler(runtimeResult.value));
  } catch (error) {
    return wrapError(error, 'Failed to create prices enrich handler');
  }
}
