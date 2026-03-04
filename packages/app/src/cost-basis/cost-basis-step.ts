import type { Result } from 'neverthrow';

import type { PipelineContext } from '../pipeline/pipeline-context.js';
import type { DirtyCheckResult, PipelineStep, StepResult } from '../pipeline/pipeline-step.js';

/**
 * Always runs — stateless pure computation from current data.
 *
 * Delegates to cost-basis-pipeline with a CostBasisStore adapter.
 */
export class CostBasisStep implements PipelineStep {
  readonly name = 'cost-basis';
  readonly dependsOn = ['price-enrich'];
  // eslint-disable-next-line @typescript-eslint/require-await -- will be there when implemented
  async isDirty(_context: PipelineContext): Promise<Result<DirtyCheckResult, Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async execute(context: PipelineContext): Promise<Result<StepResult, Error>> {
    throw new Error('Not implemented');
  }
}
