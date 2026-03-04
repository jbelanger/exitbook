import type { Result } from 'neverthrow';

import type { PipelineContext } from '../pipeline/pipeline-context.js';
import type { DirtyCheckResult, PipelineStep, StepResult } from '../pipeline/pipeline-step.js';

/**
 * Dirty when: max(transactions.created_at) > max(transaction_links.created_at).
 *
 * Delegates to LinkingOrchestrator with a LinkingStore adapter.
 */
export class LinkStep implements PipelineStep {
  readonly name = 'link';
  readonly dependsOn = ['process'];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async isDirty(context: PipelineContext): Promise<Result<DirtyCheckResult, Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async execute(context: PipelineContext): Promise<Result<StepResult, Error>> {
    throw new Error('Not implemented');
  }
}
