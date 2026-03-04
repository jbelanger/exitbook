import type { Result } from 'neverthrow';

import type { PipelineContext } from './pipeline-context.js';

export interface DirtyCheckResult {
  isDirty: boolean;
  reason?: string | undefined;
}

export interface StepResult {
  skipped: boolean;
  summary?: string | undefined;
}

export interface PipelineStep {
  readonly name: string;
  readonly dependsOn: string[];

  isDirty(context: PipelineContext): Promise<Result<DirtyCheckResult, Error>>;
  execute(context: PipelineContext): Promise<Result<StepResult, Error>>;
}
