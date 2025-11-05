import type { BlockchainProviderManager } from '@exitbook/providers';
import { loadExplorerConfig, ProviderRegistry } from '@exitbook/providers';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { BenchmarkParams } from './benchmark-rate-limit-utils.ts';
import { buildBenchmarkParams } from './benchmark-rate-limit-utils.ts';

interface BenchmarkTestResult {
  rate: number;
  success: boolean;
  responseTimeMs?: number | undefined;
}

interface BurstLimitResult {
  limit: number;
  success: boolean;
}

interface BenchmarkResult {
  testResults: BenchmarkTestResult[];
  burstLimits?: BurstLimitResult[] | undefined;
  maxSafeRate: number;
  recommended: {
    burstLimit?: number | undefined;
    requestsPerSecond: number;
  };
}

/**
 * Handler for benchmark-rate-limit command.
 * Manages BlockchainProviderManager lifecycle and orchestrates benchmark execution.
 */
export class BenchmarkRateLimitHandler {
  private providerManager: BlockchainProviderManager | undefined;

  /**
   * Execute benchmark-rate-limit command.
   */
  async execute(
    options: Parameters<typeof buildBenchmarkParams>[0],
    ProviderManagerConstructor: new (config: ReturnType<typeof loadExplorerConfig>) => BlockchainProviderManager
  ): Promise<
    Result<{ params: BenchmarkParams; provider: { name: string; rateLimit: unknown }; result: BenchmarkResult }, Error>
  > {
    // Validate and build parameters
    const paramsResult = buildBenchmarkParams(options);
    if (paramsResult.isErr()) {
      return err(paramsResult.error);
    }

    const params = paramsResult.value;

    // Load configuration and initialize provider manager
    const explorerConfig = loadExplorerConfig();
    this.providerManager = new ProviderManagerConstructor(explorerConfig);

    // Auto-register provider
    const providers = this.providerManager.autoRegisterFromConfig(params.blockchain, params.provider);

    if (providers.length === 0) {
      // Provider not found - gather helpful information
      const allProviders = ProviderRegistry.getAllProviders();
      const blockchainProviders = allProviders.filter((p) => p.blockchain === params.blockchain);

      if (blockchainProviders.length > 0) {
        const availableNames = blockchainProviders.map((p) => p.name).join(', ');
        return err(
          new Error(
            `Provider '${params.provider}' not found for blockchain '${params.blockchain}'. Available providers: ${availableNames}`
          )
        );
      } else {
        const blockchains = [...new Set(allProviders.map((p) => p.blockchain))];
        const availableBlockchains = blockchains.join(', ');
        return err(
          new Error(
            `No providers registered for blockchain '${params.blockchain}'. Available blockchains: ${availableBlockchains}`
          )
        );
      }
    }

    const provider = providers[0]!;

    // Run benchmark
    try {
      const result = await provider.benchmarkRateLimit(
        params.maxRate,
        params.numRequests,
        !params.skipBurst,
        params.customRates
      );

      return ok({
        params,
        provider: {
          name: provider.name,
          rateLimit: provider.rateLimit,
        },
        result,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    if (this.providerManager) {
      this.providerManager.destroy();
      this.providerManager = undefined;
    }
  }
}
