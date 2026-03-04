import type { Result } from 'neverthrow';

import type { PipelineContext } from '../pipeline/pipeline-context.js';
import type { DirtyCheckResult, PipelineStep, StepResult } from '../pipeline/pipeline-step.js';

/**
 * Dirty when: derived data exists that needs resetting before reprocessing.
 * Delegates to ClearOperation when implemented.
 */
export class ClearStep implements PipelineStep {
  readonly name = 'clear';
  readonly dependsOn: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async isDirty(context: PipelineContext): Promise<Result<DirtyCheckResult, Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async execute(context: PipelineContext): Promise<Result<StepResult, Error>> {
    throw new Error('Not implemented');
  }
}
