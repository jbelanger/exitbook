import type { CircuitState } from '@exitbook/resilience/circuit-breaker';
import { selectProviders } from '@exitbook/resilience/provider-selection';

import type {
  IBlockchainProvider,
  ProviderCapabilities,
  ProviderHealth,
  ProviderOperation,
  ProviderOperationType,
} from '../../contracts/index.js';

/**
 * Check if provider supports the requested operation.
 */
export function supportsOperation(capabilities: ProviderCapabilities, operation: ProviderOperation): boolean {
  if (!capabilities.supportedOperations.includes(operation.type as ProviderOperationType)) {
    return false;
  }

  // For getAddressTransactions, check supportedTransactionTypes (defaults to 'normal')
  if (operation.type === 'getAddressTransactions') {
    const streamType = operation.streamType || 'normal';
    if (!capabilities.supportedTransactionTypes) {
      // If provider doesn't declare supported types, assume it only supports 'normal'
      return streamType === 'normal';
    }
    return capabilities.supportedTransactionTypes.includes(streamType);
  }

  return true;
}

/**
 * Select and order providers based on scores and capabilities.
 * Pure function with deterministic ordering.
 */
export interface ProviderSelectionQuery {
  operation: ProviderOperation;
  now: number;
}

export interface SelectedBlockchainProvider {
  health: ProviderHealth;
  provider: IBlockchainProvider;
  score: number;
}

export function selectProvidersForOperation(
  providers: IBlockchainProvider[],
  healthMap: ReadonlyMap<string, ProviderHealth>,
  circuitMap: ReadonlyMap<string, CircuitState>,
  query: ProviderSelectionQuery
): SelectedBlockchainProvider[] {
  return selectProviders(providers, healthMap, circuitMap, query.now, {
    filter: (provider) => supportsOperation(provider.capabilities, query.operation),
    bonusScore: (provider) => {
      const rps = provider.rateLimit.requestsPerSecond;
      if (rps <= 0.5) return -40;
      if (rps <= 1.0) return -20;
      if (rps >= 3.0) return 10;
      return 0;
    },
  });
}
