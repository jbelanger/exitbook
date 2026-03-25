import { type AccountingExclusionPolicy, checkTransactionPriceCoverage } from '@exitbook/accounting';
import { buildPriceCoverageDataPorts } from '@exitbook/data/accounting';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { CommandRuntime } from '../../runtime/command-runtime.js';
import { executePricesEnrichRuntime, withPricesEnrichRuntime } from '../prices/command/run-prices-enrich.js';

import type { PrereqExecutionOptions } from './projection-readiness.js';

const logger = getLogger('price-readiness');

export interface PricePrereqConfig {
  startDate: Date;
  endDate: Date;
}

type PriceReadinessTarget = 'cost-basis' | 'portfolio';

export async function ensureTransactionPricesReady(
  scope: CommandRuntime,
  options: PrereqExecutionOptions,
  config: PricePrereqConfig,
  target: PriceReadinessTarget,
  accountingExclusionPolicy?: AccountingExclusionPolicy
): Promise<Result<void, Error>> {
  const db = await scope.database();
  const { isJsonMode, setAbort } = options;

  const data = buildPriceCoverageDataPorts(db);
  const coverageResult = await checkTransactionPriceCoverage(data, config, accountingExclusionPolicy);
  if (coverageResult.isErr()) return err(coverageResult.error);

  if (coverageResult.value.complete) {
    logger.info('All prices present for date range, skipping enrichment');
    return ok(undefined);
  }

  logger.info({ reason: coverageResult.value.reason }, 'Price coverage incomplete, running enrichment');

  if (!isJsonMode) {
    console.log('\nPrices missing for requested date range, running enrichment...\n');
  }

  return withPricesEnrichRuntime(
    {
      accountingExclusionPolicy,
      database: db,
      isJsonMode,
      onAbortRegistered: (abort) => setAbort?.(abort),
      onAbortReleased: () => setAbort?.(undefined),
      scope,
    },
    (runtime) =>
      executePricesEnrichRuntime(runtime, {
        params: {},
        afterSuccess: async () => {
          const postCoverageResult = await verifyTransactionPriceCoverage(
            data,
            config,
            target,
            accountingExclusionPolicy
          );
          if (postCoverageResult.isErr()) {
            return err(postCoverageResult.error);
          }

          if (isJsonMode) {
            logger.info('Price enrichment completed (JSON mode)');
          }

          return ok(undefined);
        },
      })
  );
}

async function verifyTransactionPriceCoverage(
  data: ReturnType<typeof buildPriceCoverageDataPorts>,
  config: PricePrereqConfig,
  target: PriceReadinessTarget,
  accountingExclusionPolicy?: AccountingExclusionPolicy
): Promise<Result<void, Error>> {
  const coverageResult = await checkTransactionPriceCoverage(data, config, accountingExclusionPolicy);
  if (coverageResult.isErr()) return err(coverageResult.error);

  if (!coverageResult.value.complete) {
    if (target === 'portfolio') {
      logger.warn(
        { reason: coverageResult.value.reason },
        'Price coverage remains incomplete after enrichment; allowing portfolio to continue with exclusions'
      );
      return ok(undefined);
    }

    return err(
      new Error(
        `Price coverage remains incomplete after enrichment: ${coverageResult.value.reason ?? 'unknown reason'}`
      )
    );
  }

  return ok(undefined);
}
