import type { RateLimitConfig } from '@exitbook/platform-http';

import type { IBlockchainProvider, ProviderCapabilities } from './provider.ts';

/**
 * Configuration passed to provider constructor
 * Built from metadata + runtime overrides
 */
export interface ProviderConfig {
  baseUrl: string;
  blockchain: string;
  displayName: string;
  enabled?: boolean | undefined;
  name: string;
  priority?: number | undefined;
  rateLimit: RateLimitConfig;
  requiresApiKey?: boolean | undefined;
  retries: number;
  timeout: number;
}

/**
 * Provider metadata that's embedded in the provider class
 */
export interface ProviderMetadata {
  name: string;
  displayName: string;
  blockchain: string; // Primary blockchain (for backward compatibility)
  baseUrl: string; // Default base URL (used if no chain-specific override)
  requiresApiKey?: boolean | undefined;
  apiKeyEnvVar?: string | undefined; // Environment variable name for API key
  capabilities: ProviderCapabilities;
  defaultConfig: {
    rateLimit: RateLimitConfig;
    retries: number;
    timeout: number;
  };
  /**
   * Supported blockchains for multi-chain providers
   * - String array: ['ethereum', 'avalanche'] - uses baseUrl for all chains
   * - Object: { ethereum: { baseUrl: '...' }, avalanche: { baseUrl: '...' } } - per-chain config
   */
  supportedChains?: string[] | Record<string, { baseUrl: string }> | undefined;
  description?: string | undefined;
}

/**
 * Factory function to create provider instances
 */
export interface ProviderFactory {
  metadata: ProviderMetadata;
  create: (config: ProviderConfig) => IBlockchainProvider;
}

/**
 * Information about an available provider
 */
export interface ProviderInfo {
  name: string;
  displayName: string;
  blockchain: string;
  description?: string | undefined;
  requiresApiKey: boolean;
  capabilities: ProviderCapabilities;
  defaultConfig: ProviderMetadata['defaultConfig'];
}
