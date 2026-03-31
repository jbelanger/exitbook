import { type PricesEnrichOptions, type PricesEnrichResult } from '@exitbook/accounting/price-enrichment';
import { resultTryAsync, type Result } from '@exitbook/foundation';

import type { CliOutputFormat } from '../../../cli/options.js';
import {
  executeCliPriceEnrichmentRuntime,
  withCliPriceEnrichmentRuntime,
} from '../../../runtime/price-enrichment-runtime.js';

import type { PricesEnrichCommandScope } from './prices-enrich-command-scope.js';

export async function runPricesEnrich(
  scope: PricesEnrichCommandScope,
  options: { format: CliOutputFormat },
  params: PricesEnrichOptions
): Promise<Result<PricesEnrichResult, Error>> {
  return resultTryAsync<PricesEnrichResult>(async function* () {
    const result = yield* await withCliPriceEnrichmentRuntime(
      {
        accountingExclusionPolicy: scope.accountingExclusionPolicy,
        database: scope.database,
        format: options.format,
        onAbortRegistered: (abort: () => void) => scope.runtime.onAbort(abort),
        profileId: scope.profile.id,
        scope: scope.runtime,
      },
      (runtime) =>
        executeCliPriceEnrichmentRuntime(runtime, {
          params,
        })
    );
    return result;
  }, 'Failed to run prices enrich');
}
