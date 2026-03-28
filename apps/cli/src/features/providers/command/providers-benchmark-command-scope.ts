import { wrapError, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';

import { ProviderBenchmarkHandler } from './providers-benchmark-handler.js';

export interface ProviderBenchmarkCommandScope {
  handler: ProviderBenchmarkHandler;
}

export function withProviderBenchmarkCommandScope<T>(
  runtime: CommandRuntime,
  operation: (scope: ProviderBenchmarkCommandScope) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  try {
    const handler = new ProviderBenchmarkHandler(runtime.requireAppRuntime().blockchainExplorersConfig);
    runtime.onCleanup(async () => handler.destroy());
    return operation({ handler });
  } catch (error) {
    return Promise.resolve(wrapError(error, 'Failed to prepare provider benchmark command scope'));
  }
}
