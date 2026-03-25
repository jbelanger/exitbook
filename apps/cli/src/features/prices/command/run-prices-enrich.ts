import { type PricesEnrichOptions, type PricesEnrichResult } from '@exitbook/accounting';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import { adaptResultCleanup, type CommandRuntime } from '../../../runtime/command-runtime.js';
import {
  createCliPriceEnrichmentRuntime,
  type CliPriceEnrichmentRuntime,
} from '../../../runtime/price-enrichment-runtime.js';
import { loadAccountingExclusionPolicy } from '../../shared/accounting-exclusion-policy.js';

const logger = getLogger('PricesEnrichRunner');

export interface ExecutePricesEnrichRuntimeOptions<TSuccess = PricesEnrichResult> {
  afterSuccess?:
    | ((result: PricesEnrichResult, runtime: CliPriceEnrichmentRuntime) => Promise<Result<TSuccess, Error>>)
    | undefined;
  params: PricesEnrichOptions;
}

interface WithPricesEnrichRuntimeOptions {
  accountingExclusionPolicy?: import('@exitbook/accounting').AccountingExclusionPolicy | undefined;
  database: Awaited<ReturnType<CommandRuntime['database']>>;
  isJsonMode: boolean;
  onAbortRegistered?: ((abort: () => void) => void) | undefined;
  onAbortReleased?: (() => void) | undefined;
  scope: CommandRuntime;
}

export async function executePricesEnrichRuntime<TSuccess = PricesEnrichResult>(
  runtime: CliPriceEnrichmentRuntime,
  options: ExecutePricesEnrichRuntimeOptions<TSuccess>
): Promise<Result<TSuccess, Error>> {
  try {
    if (runtime.controller) {
      await runtime.controller.start();
    }

    const result = await runtime.pipeline.execute(options.params, runtime.priceRuntime);

    if (result.isErr()) {
      if (runtime.controller) {
        runtime.controller.fail(result.error.message);
        await runtime.controller.stop();
      }
      return err(result.error);
    }

    const successResult = options.afterSuccess
      ? await options.afterSuccess(result.value, runtime)
      : ok(result.value as TSuccess);
    if (successResult.isErr()) {
      if (runtime.controller) {
        runtime.controller.fail(successResult.error.message);
        await runtime.controller.stop();
      }
      return err(successResult.error);
    }

    if (runtime.controller) {
      runtime.controller.complete();
      await runtime.controller.stop();
    }

    return ok(successResult.value);
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

export async function withPricesEnrichRuntime<T>(
  options: WithPricesEnrichRuntimeOptions,
  operation: (runtime: CliPriceEnrichmentRuntime) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  const runtimeResult = await createCliPriceEnrichmentRuntime({
    accountingExclusionPolicy: options.accountingExclusionPolicy,
    database: options.database,
    isJsonMode: options.isJsonMode,
    registerCleanup: false,
    scope: options.scope,
  });
  if (runtimeResult.isErr()) {
    return err(runtimeResult.error);
  }

  const runtime = runtimeResult.value;
  const cleanupPriceRuntime = adaptResultCleanup(runtime.priceRuntime.cleanup);

  options.onAbortRegistered?.(() => abortPricesEnrichRuntime(runtime));

  try {
    return await operation(runtime);
  } finally {
    options.onAbortReleased?.();
    await cleanupPriceRuntime().catch((cleanupError) => {
      logger.warn({ cleanupError }, 'Failed to clean up price runtime after price enrichment operation');
    });
  }
}

export async function runPricesEnrich(
  ctx: CommandRuntime,
  options: { isJsonMode: boolean },
  params: PricesEnrichOptions
): Promise<Result<PricesEnrichResult, Error>> {
  try {
    const database = await ctx.database();
    const accountingExclusionPolicyResult = await loadAccountingExclusionPolicy(ctx.dataDir);
    if (accountingExclusionPolicyResult.isErr()) {
      return err(accountingExclusionPolicyResult.error);
    }
    return withPricesEnrichRuntime(
      {
        accountingExclusionPolicy: accountingExclusionPolicyResult.value,
        database,
        isJsonMode: options.isJsonMode,
        onAbortRegistered: (abort) => ctx.onAbort(abort),
        scope: ctx,
      },
      (runtime) =>
        executePricesEnrichRuntime(runtime, {
          params,
        })
    );
  } catch (error) {
    return wrapError(error, 'Failed to run prices enrich');
  }
}
