/**
 * Legacy/stateful CLI execution contracts.
 *
 * The preferred end-state CLI wiring model is:
 *
 * - one immutable app runtime
 * - one per-command scope
 * - command files that parse/render only
 * - feature runner functions that execute against the scope
 *
 * Plain functions are preferred by default.
 *
 * This interface remains useful only for commands that genuinely need a
 * stateful abortable execution object during the migration to the simpler
 * command-scope model.
 */
import type { Result } from '@exitbook/foundation';

/** Shape for stateful abortable executions that still need an object. */
export interface InfrastructureHandler<TParams, TResult> {
  execute(params: TParams): Promise<Result<TResult, Error>>;
  abort(): void;
}
