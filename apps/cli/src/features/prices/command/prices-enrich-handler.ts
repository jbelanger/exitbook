import { type PricesEnrichOptions, type PricesEnrichResult } from '@exitbook/accounting';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { CommandScope } from '../../../runtime/command-scope.js';
import {
  createCliPriceEnrichmentRuntime,
  type CliPriceEnrichmentRuntime,
} from '../../../runtime/price-enrichment-runtime.js';
import { loadAccountingExclusionPolicy } from '../../shared/accounting-exclusion-policy.js';

const logger = getLogger('PricesEnrichRunner');

export async function executePricesEnrichRuntime(
  runtime: CliPriceEnrichmentRuntime,
  params: PricesEnrichOptions
): Promise<Result<PricesEnrichResult, Error>> {
  try {
    if (runtime.controller) {
      await runtime.controller.start();
    }

    const result = await runtime.pipeline.execute(params, runtime.priceRuntime);

    if (result.isErr()) {
      if (runtime.controller) {
        runtime.controller.fail(result.error.message);
        await runtime.controller.stop();
      }
      return err(result.error);
    }

    if (runtime.controller) {
      runtime.controller.complete();
      await runtime.controller.stop();
    }

    return ok(result.value);
  } catch (error) {
    if (runtime.controller) {
      const message = error instanceof Error ? error.message : String(error);
      runtime.controller.fail(message);
      await runtime.controller.stop().catch((controllerError) => {
        logger.warn({ controllerError }, 'Failed to stop controller after exception');
      });
    }
    return wrapError(error, 'Price enrichment failed');
  }
}

export function abortPricesEnrichRuntime(runtime: CliPriceEnrichmentRuntime): void {
  if (runtime.controller) {
    runtime.controller.abort();
    void runtime.controller.stop().catch((error) => {
      logger.warn({ error }, 'Failed to stop controller on abort');
    });
  }
}

export async function runPricesEnrich(
  ctx: CommandScope,
  options: { isJsonMode: boolean },
  params: PricesEnrichOptions
): Promise<Result<PricesEnrichResult, Error>> {
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

    const runtime = runtimeResult.value;
    ctx.onAbort(() => abortPricesEnrichRuntime(runtime));
    return executePricesEnrichRuntime(runtime, params);
  } catch (error) {
    return wrapError(error, 'Failed to run prices enrich');
  }
}
