import { type PricesEnrichOptions, type PricesEnrichResult } from '@exitbook/accounting/price-enrichment';
import { wrapError, type Result } from '@exitbook/foundation';

import {
  executeCliPriceEnrichmentRuntime,
  withCliPriceEnrichmentRuntime,
} from '../../../runtime/price-enrichment-runtime.js';
import type { CliOutputFormat } from '../../shared/command-options.js';

import type { PricesEnrichCommandScope } from './prices-enrich-command-scope.js';

export async function runPricesEnrich(
  scope: PricesEnrichCommandScope,
  options: { format: CliOutputFormat },
  params: PricesEnrichOptions
): Promise<Result<PricesEnrichResult, Error>> {
  try {
    return withCliPriceEnrichmentRuntime(
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
  } catch (error) {
    return wrapError(error, 'Failed to run prices enrich');
  }
}
