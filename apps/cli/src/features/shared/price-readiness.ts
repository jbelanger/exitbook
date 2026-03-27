import { checkTransactionPriceCoverage, type AccountingExclusionPolicy } from '@exitbook/accounting/cost-basis';
import { buildPriceCoverageDataPorts } from '@exitbook/data/accounting';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { CommandRuntime } from '../../runtime/command-runtime.js';
import {
  executeCliPriceEnrichmentRuntime,
  withCliPriceEnrichmentRuntime,
} from '../../runtime/price-enrichment-runtime.js';

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
  if (options.profileId === undefined) {
    return err(new Error('Price readiness requires a resolved profile scope'));
  }

  const data = buildPriceCoverageDataPorts(db, options.profileId);
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

  return withCliPriceEnrichmentRuntime(
    {
      accountingExclusionPolicy,
      database: db,
      isJsonMode,
      onAbortRegistered: (abort) => setAbort?.(abort),
      onAbortReleased: () => setAbort?.(undefined),
      profileId: options.profileId,
      scope,
    },
    (runtime) =>
      executeCliPriceEnrichmentRuntime(runtime, {
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
