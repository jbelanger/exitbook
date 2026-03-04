import type { Result } from 'neverthrow';

import type { PipelineContext } from '../pipeline/pipeline-context.js';
import type { DirtyCheckResult, PipelineStep, StepResult } from '../pipeline/pipeline-step.js';

/**
 * Dirty when: transactions exist with missing or tentative prices.
 *
 * Delegates to PriceEnrichmentPipeline (derive → normalize → fetch → re-derive)
 * with a PricingStore adapter.
 */
export class PriceEnrichStep implements PipelineStep {
  readonly name = 'price-enrich';
  readonly dependsOn = ['link'];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async isDirty(context: PipelineContext): Promise<Result<DirtyCheckResult, Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async execute(context: PipelineContext): Promise<Result<StepResult, Error>> {
    throw new Error('Not implemented');
  }
}
