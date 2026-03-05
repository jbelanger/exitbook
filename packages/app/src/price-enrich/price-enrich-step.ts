import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { PipelineContext } from '../pipeline/pipeline-context.js';
import type { DirtyCheckResult, PipelineStep, StepResult } from '../pipeline/pipeline-step.js';

import { PricingStoreAdapter } from './pricing-store-adapter.js';

const logger = getLogger('PriceEnrichStep');

/**
 * Pipeline step for price enrichment.
 * Dirty when: transactions exist with missing or tentative prices.
 *
 * Delegates to PriceEnrichOperation via PricingStoreAdapter.
 */
export class PriceEnrichStep implements PipelineStep {
  readonly name = 'price-enrich';
  readonly dependsOn = ['link'];

  async isDirty(context: PipelineContext): Promise<Result<DirtyCheckResult, Error>> {
    try {
      const store = new PricingStoreAdapter(context.db);

      const txResult = await store.findTransactionsNeedingPrices();
      if (txResult.isErr()) return err(txResult.error);

      if (txResult.value.length === 0) {
        return ok({ isDirty: false, reason: 'No transactions need prices' });
      }

      return ok({ isDirty: true, reason: `${txResult.value.length} transactions need prices` });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // PipelineContext doesn't currently carry priceManager — this will be wired
  // when the pipeline runner is fully implemented (Phase 4).
  // eslint-disable-next-line @typescript-eslint/require-await -- waiting implementation
  async execute(_context: PipelineContext): Promise<Result<StepResult, Error>> {
    logger.warn('PriceEnrichStep.execute() requires PriceProviderManager in PipelineContext — not yet available');
    return ok({ skipped: true, summary: 'Price enrichment requires provider manager in pipeline context' });
  }
}
