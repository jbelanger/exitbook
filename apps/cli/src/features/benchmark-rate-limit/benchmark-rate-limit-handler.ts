import type {
  BlockchainProviderManager,
  BenchmarkProgressEvent,
  IBlockchainProvider,
} from '@exitbook/blockchain-providers';
import { loadExplorerConfig, ProviderRegistry } from '@exitbook/blockchain-providers';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { BenchmarkParams } from './benchmark-rate-limit-utils.js';
import { buildBenchmarkParams } from './benchmark-rate-limit-utils.js';

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

interface SetupResult {
  params: BenchmarkParams;
  provider: IBlockchainProvider;
  providerInfo: {
    blockchain: string;
    name: string;
    rateLimit: unknown;
  };
}

/**
 * Handler for benchmark-rate-limit command.
 * Manages BlockchainProviderManager lifecycle and orchestrates benchmark execution.
 */
export class BenchmarkRateLimitHandler {
  private providerManager: BlockchainProviderManager | undefined;

  /**
   * Setup phase: validate parameters and initialize provider.
   * Returns setup result for TUI mode.
   */
  setup(
    options: Parameters<typeof buildBenchmarkParams>[0],
    ProviderManagerConstructor: new (config: ReturnType<typeof loadExplorerConfig>) => BlockchainProviderManager
  ): Result<SetupResult, Error> {
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

    return ok({
      params,
      provider,
      providerInfo: {
        name: provider.name,
        blockchain: provider.blockchain,
        rateLimit: provider.rateLimit,
      },
    });
  }

  /**
   * Run benchmark on an already-initialized provider.
   * Used by both JSON and TUI modes.
   */
  async runBenchmark(
    provider: IBlockchainProvider,
    params: BenchmarkParams,
    onProgress?: (event: BenchmarkProgressEvent) => void
  ): Promise<BenchmarkResult> {
    const result = await provider.benchmarkRateLimit(
      params.maxRate,
      params.numRequests,
      !params.skipBurst,
      params.customRates,
      onProgress
    );

    return result;
  }

  /**
   * Execute benchmark-rate-limit command (JSON mode, backward compat).
   */
  async execute(
    options: Parameters<typeof buildBenchmarkParams>[0],
    ProviderManagerConstructor: new (config: ReturnType<typeof loadExplorerConfig>) => BlockchainProviderManager
  ): Promise<
    Result<{ params: BenchmarkParams; provider: { name: string; rateLimit: unknown }; result: BenchmarkResult }, Error>
  > {
    const setupResult = this.setup(options, ProviderManagerConstructor);
    if (setupResult.isErr()) {
      return err(setupResult.error);
    }

    const { params, provider, providerInfo } = setupResult.value;

    try {
      const result = await this.runBenchmark(provider, params);

      return ok({
        params,
        provider: {
          name: providerInfo.name,
          rateLimit: providerInfo.rateLimit,
        },
        result,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Cleanup resources.
   *
   * Idempotent: safe to call multiple times.
   */
  async destroy(): Promise<void> {
    if (this.providerManager) {
      await this.providerManager.destroy();
      this.providerManager = undefined;
    }
  }
}
