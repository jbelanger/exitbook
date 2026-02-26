import type { BlockchainProviderManager, ProviderRegistry } from '@exitbook/blockchain-providers';
import { loadExplorerConfig } from '@exitbook/blockchain-providers';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { BenchmarkProgressEvent, BenchmarkResult } from './benchmark-tool.js';
import { benchmarkRateLimit } from './benchmark-tool.js';
import type { BenchmarkParams } from './providers-benchmark-utils.js';
import { buildBenchmarkParams } from './providers-benchmark-utils.js';

interface BenchmarkableProvider {
  blockchain: string;
  createUnboundedHealthCheck(): {
    checkHealth: () => Promise<Result<boolean, Error>>;
    destroy: () => Promise<void>;
  };
  name: string;
  rateLimit: unknown;
}

interface SetupResult {
  params: BenchmarkParams;
  provider: BenchmarkableProvider;
  providerInfo: {
    blockchain: string;
    name: string;
    rateLimit: unknown;
  };
}

function getProviderName(provider: unknown): string {
  if (!provider || typeof provider !== 'object') {
    return 'unknown';
  }

  const candidate = provider as { name?: unknown };
  if (typeof candidate.name !== 'string') {
    return 'unknown';
  }

  return candidate.name;
}

function isBenchmarkableProvider(provider: unknown): provider is BenchmarkableProvider {
  if (!provider || typeof provider !== 'object') {
    return false;
  }

  const candidate = provider as Partial<BenchmarkableProvider>;
  return (
    typeof candidate.blockchain === 'string' &&
    typeof candidate.createUnboundedHealthCheck === 'function' &&
    typeof candidate.name === 'string' &&
    'rateLimit' in candidate
  );
}

/**
 * Handler for providers-benchmark command.
 * Manages BlockchainProviderManager lifecycle and orchestrates benchmark execution.
 */
export class ProvidersBenchmarkHandler {
  private providerManager: BlockchainProviderManager | undefined;

  /**
   * Setup phase: validate parameters and initialize provider.
   * Returns setup result for TUI mode.
   */
  setup(
    options: Parameters<typeof buildBenchmarkParams>[0],
    registry: ProviderRegistry,
    ProviderManagerConstructor: new (
      registry: ProviderRegistry,
      config: ReturnType<typeof loadExplorerConfig>
    ) => BlockchainProviderManager
  ): Result<SetupResult, Error> {
    // Validate and build parameters
    const paramsResult = buildBenchmarkParams(options);
    if (paramsResult.isErr()) {
      return err(paramsResult.error);
    }

    const params = paramsResult.value;

    // Load configuration and initialize provider manager
    const explorerConfig = loadExplorerConfig();
    this.providerManager = new ProviderManagerConstructor(registry, explorerConfig);

    // Auto-register provider
    const providers = this.providerManager.autoRegisterFromConfig(params.blockchain, params.provider);

    if (providers.length === 0) {
      // Provider not found - gather helpful information
      const allProviders = registry.getAllProviders();
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

    if (!isBenchmarkableProvider(provider)) {
      return err(
        new Error(
          `Provider '${getProviderName(provider)}' does not support benchmarking (missing createUnboundedHealthCheck)`
        )
      );
    }

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
    provider: BenchmarkableProvider,
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
    options: Parameters<typeof buildBenchmarkParams>[0],
    registry: ProviderRegistry,
    ProviderManagerConstructor: new (
      registry: ProviderRegistry,
      config: ReturnType<typeof loadExplorerConfig>
    ) => BlockchainProviderManager
  ): Promise<
    Result<{ params: BenchmarkParams; provider: { name: string; rateLimit: unknown }; result: BenchmarkResult }, Error>
  > {
    const setupResult = this.setup(options, registry, ProviderManagerConstructor);
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
