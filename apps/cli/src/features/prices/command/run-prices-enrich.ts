import { type PricesEnrichOptions, type PricesEnrichResult } from '@exitbook/accounting/price-enrichment';
import { err, wrapError, type Result } from '@exitbook/foundation';

import { loadAccountingExclusionPolicy } from '../../../runtime/accounting-exclusion-policy.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import {
  executeCliPriceEnrichmentRuntime,
  withCliPriceEnrichmentRuntime,
} from '../../../runtime/price-enrichment-runtime.js';
import type { CliOutputFormat } from '../../shared/command-options.js';

export async function runPricesEnrich(
  ctx: CommandRuntime,
  options: { format: CliOutputFormat; profileId: number; profileKey: string },
  params: PricesEnrichOptions
): Promise<Result<PricesEnrichResult, Error>> {
  try {
    const database = await ctx.database();
    const accountingExclusionPolicyResult = await loadAccountingExclusionPolicy(ctx.dataDir, options.profileKey);
    if (accountingExclusionPolicyResult.isErr()) {
      return err(accountingExclusionPolicyResult.error);
    }
    return withCliPriceEnrichmentRuntime(
      {
        accountingExclusionPolicy: accountingExclusionPolicyResult.value,
        database,
        format: options.format,
        onAbortRegistered: (abort: () => void) => ctx.onAbort(abort),
        profileId: options.profileId,
        scope: ctx,
      },
      (runtime) =>
        executeCliPriceEnrichmentRuntime(runtime, {
          params,
        })
    );
  } catch (error) {
    return wrapError(error, 'Failed to run prices enrich');
  }
}
