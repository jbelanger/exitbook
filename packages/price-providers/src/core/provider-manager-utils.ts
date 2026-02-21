/**
 * Pure utility functions for provider management
 *
 * Functional core - all decision logic without side effects
 */

import type { CircuitState } from '@exitbook/resilience/circuit-breaker';
import { selectProviders } from '@exitbook/resilience/provider-selection';

import type { IPriceProvider, ProviderHealth, ProviderMetadata } from './types.js';

/**
 * Calculate granularity bonus for a provider based on timestamp and capabilities
 * Pure function - returns bonus score based on provider's declared granularity support
 */
export function calculateGranularityBonus(metadata: ProviderMetadata, timestamp: Date, now: number): number {
  const diffMs = now - timestamp.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  // Check if this is an intraday request (not midnight UTC)
  const isIntradayRequest =
    timestamp.getUTCHours() !== 0 || timestamp.getUTCMinutes() !== 0 || timestamp.getUTCSeconds() !== 0;

  if (!isIntradayRequest) {
    return 0; // No bonus for daily requests
  }

  // Provider must declare granularity support
  if (!metadata.capabilities.granularitySupport || metadata.capabilities.granularitySupport.length === 0) {
    // Default to assuming only daily data available
    return -10; // Penalty for not supporting intraday
  }

  // Find best available granularity for this timestamp age
  let bestGranularity: 'minute' | 'hour' | 'day' | undefined;
  let bestBonus = 0;

  for (const support of metadata.capabilities.granularitySupport) {
    // Check if this granularity is available for the requested timestamp age
    const isAvailable = support.maxHistoryDays === undefined || diffDays <= support.maxHistoryDays;

    if (isAvailable) {
      // Assign bonus based on granularity level
      let bonus = 0;
      if (support.granularity === 'minute') {
        bonus = 30; // Highest priority for minute data
      } else if (support.granularity === 'hour') {
        bonus = 20; // High priority for hourly data
      } else if (support.granularity === 'day') {
        bonus = 0; // No bonus for daily (baseline)
      }

      // Track the best (highest bonus) available granularity
      if (bonus > bestBonus) {
        bestBonus = bonus;
        bestGranularity = support.granularity;
      }
    }
  }

  // If only daily data available for intraday request, penalize
  if (bestGranularity === 'day' || bestGranularity === undefined) {
    return -10; // Penalty for not supporting intraday when needed
  }

  return bestBonus;
}

/**
 * Check if provider supports the requested operation
 */
export function supportsOperation(metadata: ProviderMetadata, operationType: string): boolean {
  return metadata.capabilities.supportedOperations.includes(operationType as 'fetchPrice' | 'fetchHistoricalRange');
}

/**
 * Check if provider supports the requested asset
 * Pure function - determines if provider can price a specific asset
 *
 * @param metadata - Provider metadata with capabilities
 * @param assetSymbol - Asset symbol to check (e.g., 'BTC', 'EUR', 'CAD')
 * @param isFiat - Whether the asset is a fiat currency
 * @returns true if provider supports this asset
 */
export function supportsAsset(metadata: ProviderMetadata, assetSymbol: string, isFiat: boolean): boolean {
  // Check asset type first (crypto vs fiat)
  const assetType = isFiat ? 'fiat' : 'crypto';
  if (!metadata.capabilities.supportedAssetTypes.includes(assetType)) {
    return false;
  }

  // If supportedAssets is undefined/empty, provider supports all assets of that type
  if (!metadata.capabilities.supportedAssets || metadata.capabilities.supportedAssets.length === 0) {
    return true;
  }

  // Otherwise, check if specific asset is in the list
  return metadata.capabilities.supportedAssets.includes(assetSymbol);
}

/**
 * Select and order providers based on scores and capabilities
 * Pure function - no side effects, deterministic ordering
 */
export function selectProvidersForOperation(
  providers: IPriceProvider[],
  healthMap: Map<string, ProviderHealth>,
  circuitMap: ReadonlyMap<string, CircuitState>,
  operationType: string,
  now: number,
  timestamp?: Date,
  assetSymbol?: string,
  isFiat?: boolean
): {
  health: ProviderHealth;
  metadata: ProviderMetadata;
  provider: IPriceProvider;
  score: number;
}[] {
  // Build a metadata cache to avoid calling getMetadata() twice per provider
  const metadataCache = new Map<string, ProviderMetadata>();
  for (const p of providers) {
    metadataCache.set(p.name, p.getMetadata());
  }

  const scored = selectProviders(providers, healthMap, circuitMap, now, {
    filter: (p) => {
      const metadata = metadataCache.get(p.name)!;
      if (!supportsOperation(metadata, operationType)) return false;
      if (assetSymbol !== undefined && isFiat !== undefined) {
        if (!supportsAsset(metadata, assetSymbol, isFiat)) return false;
      }
      return true;
    },
    bonusScore: (p) => {
      const metadata = metadataCache.get(p.name)!;
      return timestamp ? calculateGranularityBonus(metadata, timestamp, now) : 0;
    },
  });

  // Augment with metadata for callers that need it
  return scored.map((item) => ({
    ...item,
    metadata: metadataCache.get(item.provider.name)!,
  }));
}
