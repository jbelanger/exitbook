import type { Result } from 'neverthrow';

import type { OutputManager } from './output.js';
import { handleCancellation, promptConfirm } from './prompts.js';

/**
 * Command handler interface.
 */
export interface CommandHandler<TParams, TResult> {
  execute(params: TParams): Promise<Result<TResult, Error>>;
  destroy(): void;
}

/**
 * Convert Result to value or throw error.
 */
export function unwrapResult<T>(result: Result<T, Error>): T {
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
}

/**
 * Resolve command parameters (interactive mode vs flag mode).
 */
export async function resolveCommandParams<TParams>(config: {
  buildFromFlags: () => TParams;
  cancelMessage: string;
  commandName: string;
  confirmMessage: string;
  isInteractive: boolean;
  output: OutputManager;
  promptFn: () => Promise<TParams>;
}): Promise<TParams> {
  if (config.isInteractive) {
    config.output.intro(`exitbook ${config.commandName}`);
    const params = await config.promptFn();
    const shouldProceed = await promptConfirm(config.confirmMessage, true);
    if (!shouldProceed) {
      handleCancellation(config.cancelMessage);
    }
    return params;
  }
  return config.buildFromFlags();
}
