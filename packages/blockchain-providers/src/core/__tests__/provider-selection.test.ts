/**
 * Pure function tests for provider selection and failover logic
 * These tests use functional programming style with zero mocking
 */

import { createInitialCircuitState, recordFailure, shouldCircuitBlock, type CircuitState } from '@exitbook/http';
import { describe, expect, it } from 'vitest';

import type { OneShotOperation, ProviderCapabilities } from '../types/index.js';

// Pure types for provider info
interface ProviderInfo {
  capabilities: ProviderCapabilities;
  circuitBreakerMaxFailures?: number;
  circuitBreakerRecoveryTimeMs?: number;
  name: string;
  priority: number;
}

// Select capable providers for operation
export const selectCapableProviders = (providers: ProviderInfo[], operation: OneShotOperation): ProviderInfo[] => {
  return providers.filter((provider) => {
    const { supportedOperations } = provider.capabilities;
    return supportedOperations.includes(operation.type);
  });
};

// Filter out providers with open circuits
export const filterByCircuitState = <T extends { name: string }>(
  providers: T[],
  circuitStates: Map<string, CircuitState>,
  currentTime: number
): T[] => {
  return providers.filter((provider) => {
    const state = circuitStates.get(provider.name);
    if (!state) return true; // No circuit state = allowed

    return !shouldCircuitBlock(state, currentTime);
  });
};

// Sort providers by priority
export const sortByPriority = <T extends { priority: number }>(providers: T[]): T[] => {
  return [...providers].sort((a, b) => a.priority - b.priority);
};

// Get failover sequence
export const getFailoverSequence = (
  providers: ProviderInfo[],
  operation: OneShotOperation,
  circuitStates: Map<string, CircuitState>,
  currentTime: number
): ProviderInfo[] => {
  const capable = selectCapableProviders(providers, operation);
  const available = filterByCircuitState(capable, circuitStates, currentTime);
  return sortByPriority(available);
};

// Generate cache key
export const generateCacheKey = (blockchain: string, operation: OneShotOperation): string | undefined => {
  if (!operation.getCacheKey) {
    return;
  }
  return `${blockchain}:${operation.getCacheKey(operation)}`;
};

describe('Provider Selection (Pure Functions)', () => {
  const providers: ProviderInfo[] = [
    {
      capabilities: { supportedOperations: ['getAddressBalances', 'getAddressTransactions'] },
      name: 'provider-a',
      priority: 1,
    },
    {
      capabilities: { supportedOperations: ['getAddressBalances'] },
      name: 'provider-b',
      priority: 2,
    },
    {
      capabilities: { supportedOperations: ['getAddressTokenBalances', 'getAddressTokenTransactions'] },
      name: 'provider-c',
      priority: 3,
    },
  ];

  describe('selectCapableProviders', () => {
    it('returns only providers that support the operation', () => {
      const operation: OneShotOperation = {
        address: '0x123',
        type: 'getAddressBalances',
      };

      const capable = selectCapableProviders(providers, operation);

      expect(capable).toHaveLength(2);
      expect(capable.map((p) => p.name)).toEqual(['provider-a', 'provider-b']);
    });

    it('returns empty array when no providers support operation', () => {
      const operation = {
        type: 'custom',
      };

      const capable = selectCapableProviders(providers, operation as OneShotOperation);

      expect(capable).toHaveLength(0);
    });

    it('handles token-specific operations', () => {
      const operation: OneShotOperation = {
        address: '0x123',
        contractAddresses: ['0xabc'],
        type: 'getAddressTokenBalances',
      };

      const capable = selectCapableProviders(providers, operation);

      expect(capable).toHaveLength(1);
      expect(capable[0]?.name).toBe('provider-c');
    });
  });

  describe('filterByCircuitState', () => {
    it('includes providers with closed circuits', () => {
      const circuitStates = new Map([
        ['provider-a', createInitialCircuitState(3, 60000)],
        ['provider-b', createInitialCircuitState(3, 60000)],
      ]);

      const filtered = filterByCircuitState(providers, circuitStates, 1000);

      expect(filtered).toHaveLength(3); // All included
    });

    it('excludes providers with open circuits', () => {
      const circuitStates = new Map([
        [
          'provider-a',
          recordFailure(recordFailure(recordFailure(createInitialCircuitState(2, 60000), 1000), 1500), 2000),
        ], // Open
        ['provider-b', createInitialCircuitState(3, 60000)], // Closed
      ]);

      const filtered = filterByCircuitState(providers, circuitStates, 3000);

      expect(filtered.map((p) => p.name)).not.toContain('provider-a');
      expect(filtered.map((p) => p.name)).toContain('provider-b');
    });

    it('includes providers without circuit state', () => {
      const circuitStates = new Map<string, CircuitState>();

      const filtered = filterByCircuitState(providers, circuitStates, 1000);

      expect(filtered).toHaveLength(3);
    });
  });

  describe('sortByPriority', () => {
    it('sorts providers by priority ascending', () => {
      const unsorted = [providers[2]!, providers[0]!, providers[1]!]; // C, A, B

      const sorted = sortByPriority(unsorted);

      expect(sorted.map((p) => p.name)).toEqual(['provider-a', 'provider-b', 'provider-c']);
    });

    it('does not mutate original array', () => {
      const original = [...providers];
      sortByPriority(original);

      expect(original).toEqual(providers); // Unchanged
    });
  });

  describe('getFailoverSequence', () => {
    it('returns capable providers sorted by priority with closed circuits', () => {
      const operation: OneShotOperation = {
        address: '0x123',
        type: 'getAddressBalances',
      };

      const circuitStates = new Map([
        ['provider-a', createInitialCircuitState(3, 60000)],
        ['provider-b', createInitialCircuitState(3, 60000)],
      ]);

      const sequence = getFailoverSequence(providers, operation, circuitStates, 1000);

      expect(sequence.map((p) => p.name)).toEqual(['provider-a', 'provider-b']);
    });

    it('excludes providers with open circuits from sequence', () => {
      const operation: OneShotOperation = {
        address: '0x123',
        type: 'getAddressBalances',
      };

      const openCircuit = recordFailure(
        recordFailure(recordFailure(createInitialCircuitState(2, 60000), 1000), 1500),
        2000
      );

      const circuitStates = new Map([
        ['provider-a', openCircuit], // Open
        ['provider-b', createInitialCircuitState(3, 60000)], // Closed
      ]);

      const sequence = getFailoverSequence(providers, operation, circuitStates, 3000);

      expect(sequence.map((p) => p.name)).toEqual(['provider-b']);
    });

    it('returns empty sequence when no capable providers available', () => {
      const operation = {
        type: 'custom',
      };

      const circuitStates = new Map<string, CircuitState>();
      const sequence = getFailoverSequence(providers, operation as OneShotOperation, circuitStates, 1000);

      expect(sequence).toHaveLength(0);
    });
  });

  describe('generateCacheKey', () => {
    it('generates cache key when getCacheKey is provided', () => {
      const operation: OneShotOperation = {
        address: '0x123',
        getCacheKey: (op) => `balance-${op.type === 'getAddressBalances' ? op.address : 'unknown'}`,
        type: 'getAddressBalances',
      };

      const key = generateCacheKey('ethereum', operation);

      expect(key).toBe('ethereum:balance-0x123');
    });

    it('returns undefined when getCacheKey not provided', () => {
      const operation: OneShotOperation = {
        address: '0x123',
        type: 'getAddressBalances',
      };

      const key = generateCacheKey('ethereum', operation);

      expect(key).toBeUndefined();
    });

    it('includes blockchain in cache key', () => {
      const operation: OneShotOperation = {
        address: 'bc1xyz',
        getCacheKey: (op) => `${op.type}-${String((op as { address?: string }).address)}`,
        type: 'getAddressBalances',
      };

      const ethKey = generateCacheKey('ethereum', operation);
      const btcKey = generateCacheKey('bitcoin', operation);

      expect(ethKey).not.toBe(btcKey);
      expect(ethKey).toContain('ethereum');
      expect(btcKey).toContain('bitcoin');
    });
  });
});
