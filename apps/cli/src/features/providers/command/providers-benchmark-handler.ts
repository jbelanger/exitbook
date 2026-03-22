import { loadBlockchainExplorerConfig } from '@exitbook/blockchain-providers';
import {
  openBlockchainProviderBenchmarkSession,
  type BenchmarkableBlockchainProvider,
  type BlockchainProviderBenchmarkSession,
} from '@exitbook/blockchain-providers/benchmark';
import { err, ok, wrapError, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type { BenchmarkProgressEvent, BenchmarkResult } from './benchmark-tool.js';
import { benchmarkRateLimit } from './benchmark-tool.js';
import type { BenchmarkParams } from './providers-benchmark-utils.js';
import { buildBenchmarkParams } from './providers-benchmark-utils.js';

interface SetupResult {
  params: BenchmarkParams;
  session: BlockchainProviderBenchmarkSession;
  providerInfo: {
    blockchain: string;
    name: string;
    rateLimit: unknown;
  };
}

/**
 * Handler for providers-benchmark command.
 * Manages blockchain provider runtime lifecycle and orchestrates benchmark execution.
 */
export class ProviderBenchmarkHandler {
  private benchmarkSession: BlockchainProviderBenchmarkSession | undefined;

  /**
   * Setup phase: validate parameters and initialize provider.
   * Returns setup result for TUI mode.
   */
  async prepareSession(options: Parameters<typeof buildBenchmarkParams>[0]): Promise<Result<SetupResult, Error>> {
    // Validate and build parameters
    const paramsResult = buildBenchmarkParams(options);
    if (paramsResult.isErr()) {
      return err(paramsResult.error);
    }

    const params = paramsResult.value;

    const explorerConfigResult = loadBlockchainExplorerConfig();
    if (explorerConfigResult.isErr()) {
      return err(explorerConfigResult.error);
    }

    const sessionResult = await openBlockchainProviderBenchmarkSession({
      blockchain: params.blockchain,
      explorerConfig: explorerConfigResult.value,
      providerName: params.provider,
    });
    if (sessionResult.isErr()) {
      return err(sessionResult.error);
    }

    this.benchmarkSession = sessionResult.value;

    return ok({
      params,
      session: this.benchmarkSession,
      providerInfo: this.benchmarkSession.providerInfo,
    });
  }

  /**
   * Run benchmark on an already-initialized provider.
   * Used by both JSON and TUI modes.
   */
  async runBenchmark(
    provider: BenchmarkableBlockchainProvider,
    params: BenchmarkParams,
    onProgress?: (event: BenchmarkProgressEvent) => void
  ): Promise<BenchmarkResult> {
    const { checkHealth, destroy } = provider.createUnboundedHealthCheck();

    try {
      return await benchmarkRateLimit({
        checkHealth,
        customRates: params.customRates,
        logger: getLogger(`${provider.name}-benchmark`),
        maxRequestsPerSecond: params.maxRate,
        numRequestsPerTest: params.numRequests,
        onProgress,
        providerDisplayName: provider.name,
        testBurstLimits: !params.skipBurst,
      });
    } finally {
      await destroy();
    }
  }

  /**
   * Execute providers-benchmark command (JSON mode).
   */
  async execute(
    options: Parameters<typeof buildBenchmarkParams>[0]
  ): Promise<
    Result<{ params: BenchmarkParams; provider: { name: string; rateLimit: unknown }; result: BenchmarkResult }, Error>
  > {
    const setupResult = await this.prepareSession(options);
    if (setupResult.isErr()) {
      return err(setupResult.error);
    }

    const { params, session, providerInfo } = setupResult.value;

    try {
      const result = await this.runBenchmark(session.provider, params);

      return ok({
        params,
        provider: {
          name: providerInfo.name,
          rateLimit: providerInfo.rateLimit,
        },
        result,
      });
    } catch (error) {
      return wrapError(error, 'Benchmark request failed');
    }
  }

  /**
   * Cleanup resources.
   *
   * Idempotent: safe to call multiple times.
   */
  async destroy(): Promise<void> {
    if (this.benchmarkSession) {
      await this.benchmarkSession.cleanup();
      this.benchmarkSession = undefined;
    }
  }
}

/**
 * Create a ProviderBenchmarkHandler and register cleanup with ctx.
 * Factory owns cleanup -- command files NEVER call ctx.onCleanup().
 *
 * Returns Result for consistency with other Tier 2 factories.
 * Creation itself is infallible; err() is unreachable in practice.
 */
export function createProviderBenchmarkHandler(
  ctx: import('../../shared/command-runtime.js').CommandContext
): Result<ProviderBenchmarkHandler, Error> {
  const handler = new ProviderBenchmarkHandler();
  ctx.onCleanup(async () => handler.destroy());
  return ok(handler);
}
