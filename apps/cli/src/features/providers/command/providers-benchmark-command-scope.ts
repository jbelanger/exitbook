import { resultTryAsync, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';

import { ProviderBenchmarkHandler } from './providers-benchmark-handler.js';

export interface ProviderBenchmarkCommandScope {
  handler: ProviderBenchmarkHandler;
}

export async function withProviderBenchmarkCommandScope<T>(
  runtime: CommandRuntime,
  operation: (scope: ProviderBenchmarkCommandScope) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  return resultTryAsync<T>(async function* () {
    const handler = new ProviderBenchmarkHandler(runtime.requireAppRuntime().blockchainExplorersConfig);
    runtime.onCleanup(async () => handler.destroy());
    const value = yield* await operation({ handler });
    return value;
  }, 'Failed to prepare provider benchmark command scope');
}
