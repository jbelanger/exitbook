import { err, resultTryAsync, type Result } from '@exitbook/foundation';

import { loadCliBlockchainExplorersConfig } from '../../../runtime/app-runtime.js';
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
    const explorerConfigResult = loadCliBlockchainExplorersConfig(runtime.requireAppRuntime());
    if (explorerConfigResult.isErr()) {
      return yield* err(explorerConfigResult.error);
    }

    const handler = new ProviderBenchmarkHandler(explorerConfigResult.value);
    runtime.onCleanup(async () => handler.destroy());
    const value = yield* await operation({ handler });
    return value;
  }, 'Failed to prepare provider benchmark command scope');
}
