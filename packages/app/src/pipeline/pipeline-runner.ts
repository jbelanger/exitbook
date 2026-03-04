import type { Result } from 'neverthrow';

import type { PipelineContext } from './pipeline-context.js';
import type { PipelineStep, StepResult } from './pipeline-step.js';

export interface PipelineRunResult {
  steps: Map<string, StepResult>;
}

export class PipelineRunner {
  private readonly steps: PipelineStep[] = [];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- will be there when implemented
  register(step: PipelineStep): void {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async run(context: PipelineContext): Promise<Result<PipelineRunResult, Error>> {
    throw new Error('Not implemented');
  }
}
