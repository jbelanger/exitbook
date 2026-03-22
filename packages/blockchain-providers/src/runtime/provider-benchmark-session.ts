import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import type { RateLimitConfig } from '@exitbook/http';
import { getLogger } from '@exitbook/logger';

import type { BlockchainExplorersConfig } from '../catalog/load-explorer-config.js';
import { createProviderRegistry } from '../initialize.js';

import { BlockchainProviderManager } from './manager/provider-manager.js';

export interface BenchmarkableBlockchainProvider {
  blockchain: string;
  createUnboundedHealthCheck(): {
    checkHealth: () => Promise<Result<boolean, Error>>;
    destroy: () => Promise<void>;
  };
  name: string;
  rateLimit: RateLimitConfig;
}

export interface BlockchainProviderBenchmarkSession {
  provider: BenchmarkableBlockchainProvider;
  providerInfo: {
    blockchain: string;
    name: string;
    rateLimit: RateLimitConfig;
  };
  cleanup(): Promise<void>;
}

export interface OpenBlockchainProviderBenchmarkSessionOptions {
  blockchain: string;
  explorerConfig?: BlockchainExplorersConfig | undefined;
  providerName: string;
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

function isBenchmarkableProvider(provider: unknown): provider is BenchmarkableBlockchainProvider {
  if (!provider || typeof provider !== 'object') {
    return false;
  }

  const candidate = provider as Partial<BenchmarkableBlockchainProvider>;
  return (
    typeof candidate.blockchain === 'string' &&
    typeof candidate.createUnboundedHealthCheck === 'function' &&
    typeof candidate.name === 'string' &&
    'rateLimit' in candidate
  );
}

export async function openBlockchainProviderBenchmarkSession(
  options: OpenBlockchainProviderBenchmarkSessionOptions
): Promise<Result<BlockchainProviderBenchmarkSession, Error>> {
  const registry = createProviderRegistry();
  const allProviders = registry.getAllProviders();
  const blockchainProviders = allProviders.filter((provider) => provider.blockchain === options.blockchain);

  if (blockchainProviders.length === 0) {
    const availableBlockchains = [...new Set(allProviders.map((provider) => provider.blockchain))].join(', ');
    return err(
      new Error(
        `No providers registered for blockchain '${options.blockchain}'. Available blockchains: ${availableBlockchains}`
      )
    );
  }

  const requestedProvider = blockchainProviders.find((provider) => provider.name === options.providerName);
  if (!requestedProvider) {
    const availableNames = blockchainProviders.map((provider) => provider.name).join(', ');
    return err(
      new Error(
        `Provider '${options.providerName}' not found for blockchain '${options.blockchain}'. Available providers: ${availableNames}`
      )
    );
  }

  const providerManager = new BlockchainProviderManager(registry, { explorerConfig: options.explorerConfig });

  try {
    const providers = providerManager.getProviders(options.blockchain, {
      preferredProvider: options.providerName,
    });
    if (providers.length === 0) {
      await providerManager.destroy();
      return err(
        new Error(`Provider '${options.providerName}' could not be initialized for blockchain '${options.blockchain}'.`)
      );
    }

    const provider = providers[0]!;
    if (!isBenchmarkableProvider(provider)) {
      await providerManager.destroy();
      return err(
        new Error(
          `Provider '${getProviderName(provider)}' does not support benchmarking (missing createUnboundedHealthCheck)`
        )
      );
    }

    return ok({
      provider,
      providerInfo: {
        name: provider.name,
        blockchain: provider.blockchain,
        rateLimit: provider.rateLimit,
      },
      async cleanup() {
        await providerManager.destroy();
      },
    });
  } catch (error) {
    await providerManager.destroy().catch((destroyErr: unknown) => {
      getLogger('BenchmarkSession').warn({ err: destroyErr }, 'Failed to destroy provider manager during cleanup');
    });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
