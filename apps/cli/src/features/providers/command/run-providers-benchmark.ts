import type { BenchmarkResult } from './benchmark-tool.js';
import type { ProviderBenchmarkCommandScope } from './providers-benchmark-command-scope.js';

export async function prepareProviderBenchmarkSession(
  scope: ProviderBenchmarkCommandScope,
  options: Parameters<ProviderBenchmarkCommandScope['handler']['prepareSession']>[0]
): Promise<ReturnType<ProviderBenchmarkCommandScope['handler']['prepareSession']>> {
  return scope.handler.prepareSession(options);
}

export async function runProviderBenchmark(
  scope: ProviderBenchmarkCommandScope,
  provider: Parameters<ProviderBenchmarkCommandScope['handler']['runBenchmark']>[0],
  params: Parameters<ProviderBenchmarkCommandScope['handler']['runBenchmark']>[1],
  onProgress?: Parameters<ProviderBenchmarkCommandScope['handler']['runBenchmark']>[2]
): Promise<BenchmarkResult> {
  return scope.handler.runBenchmark(provider, params, onProgress);
}
