import type { DataContext } from '@exitbook/data';

export interface PipelineConfig {
  /** Run all steps regardless of dirty state */
  force?: boolean | undefined;
}

export interface EventSink {
  emit(event: unknown): void;
}

export interface PipelineContext {
  readonly db: DataContext;
  readonly config: PipelineConfig;
  readonly events: EventSink;
  readonly signal?: AbortSignal | undefined;
}
