import type { AccountingExclusionPolicy } from '@exitbook/accounting';
import { err, ok, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../runtime/command-runtime.js';

import { ensureTransactionPricesReady, type PricePrereqConfig } from './price-readiness.js';
import {
  ensureAssetReviewReady,
  ensureLinksReady,
  ensureProcessedTransactionsReady,
  type PrereqExecutionOptions,
} from './projection-readiness.js';

type ConsumerTarget = 'links-run' | 'cost-basis' | 'portfolio';

interface EnsureConsumerInputsReadyOptions extends PrereqExecutionOptions {
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  priceConfig?: PricePrereqConfig | undefined;
}

export async function ensureConsumerInputsReady(
  scope: CommandRuntime,
  target: ConsumerTarget,
  options: EnsureConsumerInputsReadyOptions
): Promise<Result<void, Error>> {
  const processedTransactionsResult = await ensureProcessedTransactionsReady(scope, options);
  if (processedTransactionsResult.isErr()) {
    return err(processedTransactionsResult.error);
  }

  if (target === 'links-run') {
    return ok(undefined);
  }

  const assetReviewResult = await ensureAssetReviewReady(scope);
  if (assetReviewResult.isErr()) {
    return err(assetReviewResult.error);
  }

  const linksResult = await ensureLinksReady(scope, options);
  if (linksResult.isErr()) {
    return err(linksResult.error);
  }

  if ((target === 'cost-basis' || target === 'portfolio') && options.priceConfig) {
    const pricesResult = await ensureTransactionPricesReady(
      scope,
      options,
      options.priceConfig,
      target,
      options.accountingExclusionPolicy
    );
    if (pricesResult.isErr()) {
      return err(pricesResult.error);
    }
  }

  return ok(undefined);
}
