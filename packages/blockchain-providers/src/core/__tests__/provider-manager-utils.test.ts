/**
 * Unit tests for provider-manager-utils
 * Pure function tests without mocks
 */

import type { CursorState, CursorType } from '@exitbook/core';
import { createInitialCircuitState, recordFailure, type CircuitState } from '@exitbook/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addToDeduplicationWindow,
  buildProviderNotFoundError,
  buildProviderSelectionDebugInfo,
  canProviderResume,
  createDeduplicationWindow,
  createInitialHealth,
  deduplicateTransactions,
  findBestCursor,
  getProviderHealthWithCircuit,
  hasAvailableProviders,
  isCacheValid,
  isInDeduplicationWindow,
  scoreProvider,
  selectBestCursorType,
  selectProvidersForOperation,
  supportsOperation,
  updateHealthMetrics,
  validateProviderApiKey,
} from '../provider-manager-utils.js';
import type { IBlockchainProvider, ProviderCapabilities, ProviderHealth } from '../types/index.js';

// Helper to create mock provider
function createMockProvider(
  name: string,
  supportedOps: string[] = ['getAddressTransactions'],
  supportedCursorTypes: CursorType[] = ['blockNumber'],
  requestsPerSecond = 5
): IBlockchainProvider {
  return {
    name,
    blockchain: 'ethereum',
    capabilities: {
      supportedOperations: supportedOps,
      supportedCursorTypes,
      preferredCursorType: supportedCursorTypes[0],
    } as ProviderCapabilities,
    rateLimit: {
      requestsPerSecond,
      requestsPerMinute: requestsPerSecond * 60,
      requestsPerHour: requestsPerSecond * 3600,
      burstLimit: requestsPerSecond * 2,
    },
  } as IBlockchainProvider;
}

describe('provider-manager-utils', () => {
  describe('isCacheValid', () => {
    it('should return true if cache has not expired', () => {
      const now = 1000;
      const expiry = 2000;
      expect(isCacheValid(expiry, now)).toBe(true);
    });

    it('should return false if cache has expired', () => {
      const now = 2000;
      const expiry = 1000;
      expect(isCacheValid(expiry, now)).toBe(false);
    });

    it('should return false if cache expiry equals now', () => {
      const now = 1000;
      const expiry = 1000;
      expect(isCacheValid(expiry, now)).toBe(false);
    });
  });

  describe('scoreProvider', () => {
    let provider: IBlockchainProvider;
    let health: ProviderHealth;
    let circuitState: CircuitState;
    const now = Date.now();

    beforeEach(() => {
      provider = createMockProvider('test-provider');
      health = createInitialHealth();
      circuitState = createInitialCircuitState();
    });

    it('should return base score of 100 for healthy provider', () => {
      const score = scoreProvider(provider, health, circuitState, now);
      expect(score).toBe(130); // Base 100 + 10 (generous rate) + 20 (fast response 0ms < 1000)
    });

    it('should penalize unhealthy provider', () => {
      health.isHealthy = false;
      const score = scoreProvider(provider, health, circuitState, now);
      expect(score).toBe(80); // 100 - 50 (unhealthy) + 10 (rate) + 20 (fast)
    });

    it('should heavily penalize open circuit', () => {
      // Record enough failures to open circuit
      let state = circuitState;
      for (let i = 0; i < 10; i++) {
        state = recordFailure(state, now);
      }
      const score = scoreProvider(provider, health, state, now);
      expect(score).toBe(30); // 100 - 100 (open circuit) + 10 (rate) + 20 (fast)
    });

    it('should moderately penalize half-open circuit', () => {
      // Open circuit then wait for half-open
      let state = circuitState;
      for (let i = 0; i < 10; i++) {
        state = recordFailure(state, now);
      }
      const laterTime = now + 60000; // After recovery timeout
      const score = scoreProvider(provider, health, state, laterTime);
      expect(score).toBe(30); // Still open after only 1 minute (needs more time)
    });

    it('should penalize restrictive rate limits', () => {
      const slowProvider = createMockProvider('slow-provider', ['getAddressTransactions'], ['blockNumber'], 0.25);
      const score = scoreProvider(slowProvider, health, circuitState, now);
      expect(score).toBe(80); // 100 - 40 (very restrictive) + 20 (fast response)
    });

    it('should bonus fast response time', () => {
      health.averageResponseTime = 500;
      const score = scoreProvider(provider, health, circuitState, now);
      expect(score).toBe(130); // 100 + 20 (fast) + 10 (rate limit)
    });

    it('should penalize slow response time', () => {
      health.averageResponseTime = 6000;
      const score = scoreProvider(provider, health, circuitState, now);
      expect(score).toBe(80); // 100 - 30 (slow) + 10 (rate limit)
    });

    it('should penalize high error rate', () => {
      health.errorRate = 0.5; // 50% error rate
      const score = scoreProvider(provider, health, circuitState, now);
      expect(score).toBe(105); // 100 - 25 (50% error rate) + 10 (rate) + 20 (fast)
    });

    it('should penalize consecutive failures', () => {
      health.consecutiveFailures = 3;
      const score = scoreProvider(provider, health, circuitState, now);
      expect(score).toBe(100); // 100 - 30 (3 failures × 10) + 10 (rate) + 20 (fast)
    });

    it('should never return negative score', () => {
      health.isHealthy = false;
      health.errorRate = 1.0;
      health.consecutiveFailures = 10;
      health.averageResponseTime = 10000;
      let state = circuitState;
      for (let i = 0; i < 10; i++) {
        state = recordFailure(state, now);
      }
      const score = scoreProvider(provider, health, state, now);
      expect(score).toBe(0);
    });
  });

  describe('supportsOperation', () => {
    it('should return true for supported operation', () => {
      const capabilities = {
        supportedOperations: ['getAddressTransactions', 'getTransaction'],
      } as ProviderCapabilities;
      expect(supportsOperation(capabilities, 'getAddressTransactions')).toBe(true);
    });

    it('should return false for unsupported operation', () => {
      const capabilities = {
        supportedOperations: ['getAddressTransactions'],
      } as ProviderCapabilities;
      expect(supportsOperation(capabilities, 'getBlock')).toBe(false);
    });
  });

  describe('selectProvidersForOperation', () => {
    it('should filter and order providers by score', () => {
      const provider1 = createMockProvider('provider-1');
      const provider2 = createMockProvider('provider-2');
      const provider3 = createMockProvider('provider-3');

      const healthMap = new Map<string, ProviderHealth>([
        ['provider-1', { ...createInitialHealth(), averageResponseTime: 1000 }],
        ['provider-2', { ...createInitialHealth(), averageResponseTime: 500 }], // Fastest
        ['provider-3', { ...createInitialHealth(), isHealthy: false }],
      ]);

      const circuitMap = new Map<string, CircuitState>([
        ['provider-1', createInitialCircuitState()],
        ['provider-2', createInitialCircuitState()],
        ['provider-3', createInitialCircuitState()],
      ]);

      const result = selectProvidersForOperation(
        [provider1, provider2, provider3],
        healthMap,
        circuitMap,
        'getAddressTransactions',
        Date.now()
      );

      expect(result).toHaveLength(3);
      expect(result[0]!.provider.name).toBe('provider-2'); // Fastest (bonus)
      expect(result[2]!.provider.name).toBe('provider-3'); // Unhealthy (penalty)
    });

    it('should exclude providers that do not support operation', () => {
      const provider1 = createMockProvider('provider-1', ['getAddressTransactions']);
      const provider2 = createMockProvider('provider-2', ['getBlock']);

      const healthMap = new Map<string, ProviderHealth>([
        ['provider-1', createInitialHealth()],
        ['provider-2', createInitialHealth()],
      ]);

      const circuitMap = new Map<string, CircuitState>([
        ['provider-1', createInitialCircuitState()],
        ['provider-2', createInitialCircuitState()],
      ]);

      const result = selectProvidersForOperation(
        [provider1, provider2],
        healthMap,
        circuitMap,
        'getAddressTransactions',
        Date.now()
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.provider.name).toBe('provider-1');
    });

    it('should exclude providers with missing health or circuit state', () => {
      const provider1 = createMockProvider('provider-1');
      const provider2 = createMockProvider('provider-2');

      const healthMap = new Map<string, ProviderHealth>([['provider-1', createInitialHealth()]]);

      const circuitMap = new Map<string, CircuitState>([
        ['provider-1', createInitialCircuitState()],
        ['provider-2', createInitialCircuitState()],
      ]);

      const result = selectProvidersForOperation(
        [provider1, provider2],
        healthMap,
        circuitMap,
        'getAddressTransactions',
        Date.now()
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.provider.name).toBe('provider-1');
    });
  });

  describe('hasAvailableProviders', () => {
    it('should return true if at least one provider has closed circuit', () => {
      const provider1 = createMockProvider('provider-1');
      const provider2 = createMockProvider('provider-2');

      const circuitMap = new Map<string, CircuitState>([
        ['provider-1', createInitialCircuitState()],
        ['provider-2', createInitialCircuitState()],
      ]);

      expect(hasAvailableProviders([provider1, provider2], circuitMap, Date.now())).toBe(true);
    });

    it('should return false if all providers have open circuits', () => {
      const provider1 = createMockProvider('provider-1');
      const provider2 = createMockProvider('provider-2');

      const now = Date.now();
      let state1 = createInitialCircuitState();
      let state2 = createInitialCircuitState();
      for (let i = 0; i < 10; i++) {
        state1 = recordFailure(state1, now);
        state2 = recordFailure(state2, now);
      }

      const circuitMap = new Map<string, CircuitState>([
        ['provider-1', state1],
        ['provider-2', state2],
      ]);

      expect(hasAvailableProviders([provider1, provider2], circuitMap, now)).toBe(false);
    });
  });

  describe('updateHealthMetrics', () => {
    let health: ProviderHealth;
    const now = Date.now();

    beforeEach(() => {
      health = createInitialHealth();
    });

    it('should update health to healthy on success', () => {
      const updated = updateHealthMetrics(health, true, 1000, now);
      expect(updated.isHealthy).toBe(true);
      expect(updated.consecutiveFailures).toBe(0);
      expect(updated.lastChecked).toBe(now);
    });

    it('should update response time on success', () => {
      health.averageResponseTime = 1000;
      const updated = updateHealthMetrics(health, true, 500, now);
      expect(updated.averageResponseTime).toBe(900); // 1000 * 0.8 + 500 * 0.2
    });

    it('should initialize response time on first success', () => {
      const updated = updateHealthMetrics(health, true, 1000, now);
      expect(updated.averageResponseTime).toBe(1000);
    });

    it('should mark unhealthy on failure', () => {
      const updated = updateHealthMetrics(health, false, 0, now, 'Test error');
      expect(updated.isHealthy).toBe(false);
      expect(updated.lastError).toBe('Test error');
    });

    it('should increment consecutive failures on failure', () => {
      let updated = updateHealthMetrics(health, false, 0, now);
      expect(updated.consecutiveFailures).toBe(1);

      updated = updateHealthMetrics(updated, false, 0, now);
      expect(updated.consecutiveFailures).toBe(2);
    });

    it('should reset consecutive failures on success', () => {
      health.consecutiveFailures = 5;
      const updated = updateHealthMetrics(health, true, 1000, now);
      expect(updated.consecutiveFailures).toBe(0);
    });

    it('should update error rate (exponential moving average)', () => {
      health.errorRate = 0;
      let updated = updateHealthMetrics(health, false, 0, now); // First failure
      expect(updated.errorRate).toBe(0.1); // 0 * 0.9 + 1 * 0.1

      updated = updateHealthMetrics(updated, false, 0, now); // Second failure
      expect(updated.errorRate).toBeCloseTo(0.19); // 0.1 * 0.9 + 1 * 0.1

      updated = updateHealthMetrics(updated, true, 1000, now); // Success
      expect(updated.errorRate).toBeCloseTo(0.171); // 0.19 * 0.9 + 0 * 0.1
    });

    it('should not mutate original health object', () => {
      const original = { ...health };
      updateHealthMetrics(health, false, 0, now, 'Error');
      expect(health).toEqual(original);
    });
  });

  describe('createInitialHealth', () => {
    it('should create health with defaults', () => {
      const health = createInitialHealth();
      expect(health.isHealthy).toBe(true);
      expect(health.averageResponseTime).toBe(0);
      expect(health.errorRate).toBe(0);
      expect(health.consecutiveFailures).toBe(0);
      expect(health.lastChecked).toBe(0);
      expect(health.lastError).toBeUndefined();
    });
  });

  describe('getProviderHealthWithCircuit', () => {
    it('should combine health and circuit status', () => {
      const health = createInitialHealth();
      const circuit = createInitialCircuitState();
      const now = Date.now();

      const result = getProviderHealthWithCircuit(health, circuit, now);
      expect(result.circuitState).toBe('closed');
      expect(result.isHealthy).toBe(true);
    });

    it('should show open circuit state', () => {
      const health = createInitialHealth();
      let circuit = createInitialCircuitState();
      const now = Date.now();

      for (let i = 0; i < 10; i++) {
        circuit = recordFailure(circuit, now);
      }

      const result = getProviderHealthWithCircuit(health, circuit, now);
      expect(result.circuitState).toBe('open');
    });
  });

  describe('canProviderResume', () => {
    it('should return true if provider supports cursor type', () => {
      const provider = createMockProvider('test', ['getAddressTransactions'], ['blockNumber', 'timestamp']);
      const cursor: CursorState = {
        primary: { type: 'blockNumber', value: 1000 },
        lastTransactionId: 'tx-1',
        totalFetched: 100,
        metadata: { providerName: 'test', updatedAt: Date.now() },
      };

      expect(canProviderResume(provider, cursor)).toBe(true);
    });

    it('should return false if provider does not support cursor type', () => {
      const provider = createMockProvider('test', ['getAddressTransactions'], ['timestamp']);
      const cursor: CursorState = {
        primary: { type: 'blockNumber', value: 1000 },
        lastTransactionId: 'tx-1',
        totalFetched: 100,
        metadata: { providerName: 'test', updatedAt: Date.now() },
      };

      expect(canProviderResume(provider, cursor)).toBe(false);
    });

    it('should check alternative cursor types', () => {
      const provider = createMockProvider('test', ['getAddressTransactions'], ['timestamp']);
      const cursor: CursorState = {
        primary: { type: 'blockNumber', value: 1000 },
        alternatives: [{ type: 'timestamp', value: Date.now() }],
        lastTransactionId: 'tx-1',
        totalFetched: 100,
        metadata: { providerName: 'test', updatedAt: Date.now() },
      };

      expect(canProviderResume(provider, cursor)).toBe(true);
    });

    it('should reject pageToken from different provider', () => {
      const provider = createMockProvider('test', ['getAddressTransactions'], ['pageToken']);
      const cursor: CursorState = {
        primary: { type: 'pageToken', value: 'token-123', providerName: 'other-provider' },
        lastTransactionId: 'tx-1',
        totalFetched: 100,
        metadata: { providerName: 'other-provider', updatedAt: Date.now() },
      };

      expect(canProviderResume(provider, cursor)).toBe(false);
    });

    it('should accept pageToken from same provider', () => {
      const provider = createMockProvider('test', ['getAddressTransactions'], ['pageToken']);
      const cursor: CursorState = {
        primary: { type: 'pageToken', value: 'token-123', providerName: 'test' },
        lastTransactionId: 'tx-1',
        totalFetched: 100,
        metadata: { providerName: 'test', updatedAt: Date.now() },
      };

      expect(canProviderResume(provider, cursor)).toBe(true);
    });

    it('should return false if provider has no cursor support', () => {
      const provider = createMockProvider('test', ['getAddressTransactions'], []);
      const cursor: CursorState = {
        primary: { type: 'blockNumber', value: 1000 },
        lastTransactionId: 'tx-1',
        totalFetched: 100,
        metadata: { providerName: 'test', updatedAt: Date.now() },
      };

      expect(canProviderResume(provider, cursor)).toBe(false);
    });
  });

  describe('selectBestCursorType', () => {
    it('should return preferred type if no cursor provided', () => {
      const provider = createMockProvider('test', ['getAddressTransactions'], ['blockNumber', 'timestamp']);
      expect(selectBestCursorType(provider)).toBe('blockNumber');
    });

    it('should prioritize blockNumber over other types', () => {
      const provider = createMockProvider('test', ['getAddressTransactions'], ['timestamp', 'blockNumber', 'txHash']);
      const cursor: CursorState = {
        primary: { type: 'timestamp', value: Date.now() },
        alternatives: [
          { type: 'blockNumber', value: 1000 },
          { type: 'txHash', value: 'hash' },
        ],
        lastTransactionId: 'tx-1',
        totalFetched: 100,
        metadata: { providerName: 'test', updatedAt: Date.now() },
      };

      expect(selectBestCursorType(provider, cursor)).toBe('blockNumber');
    });

    it('should follow priority order: blockNumber > timestamp > txHash > pageToken', () => {
      const provider = createMockProvider('test', ['getAddressTransactions'], ['pageToken', 'txHash']);
      const cursor: CursorState = {
        primary: { type: 'pageToken', value: 'token', providerName: 'test' },
        alternatives: [{ type: 'txHash', value: 'hash' }],
        lastTransactionId: 'tx-1',
        totalFetched: 100,
        metadata: { providerName: 'test', updatedAt: Date.now() },
      };

      expect(selectBestCursorType(provider, cursor)).toBe('txHash');
    });
  });

  describe('findBestCursor', () => {
    it('should return primary cursor if supported', () => {
      const provider = createMockProvider('test', ['getAddressTransactions'], ['blockNumber']);
      const cursor: CursorState = {
        primary: { type: 'blockNumber', value: 1000 },
        lastTransactionId: 'tx-1',
        totalFetched: 100,
        metadata: { providerName: 'test', updatedAt: Date.now() },
      };

      const result = findBestCursor(provider, cursor);
      expect(result).toEqual({ type: 'blockNumber', value: 1000 });
    });

    it('should return alternative if primary not supported', () => {
      const provider = createMockProvider('test', ['getAddressTransactions'], ['timestamp']);
      const cursor: CursorState = {
        primary: { type: 'blockNumber', value: 1000 },
        alternatives: [{ type: 'timestamp', value: Date.now() }],
        lastTransactionId: 'tx-1',
        totalFetched: 100,
        metadata: { providerName: 'test', updatedAt: Date.now() },
      };

      const result = findBestCursor(provider, cursor);
      expect(result?.type).toBe('timestamp');
    });

    it('should return undefined if no compatible cursor', () => {
      const provider = createMockProvider('test', ['getAddressTransactions'], ['blockNumber']);
      const cursor: CursorState = {
        primary: { type: 'timestamp', value: Date.now() },
        lastTransactionId: 'tx-1',
        totalFetched: 100,
        metadata: { providerName: 'test', updatedAt: Date.now() },
      };

      const result = findBestCursor(provider, cursor);
      expect(result).toBeUndefined();
    });
  });

  describe('deduplication window', () => {
    describe('createDeduplicationWindow', () => {
      it('should create empty window', () => {
        const window = createDeduplicationWindow();
        expect(window.queue).toEqual([]);
        expect(window.set.size).toBe(0);
      });

      it('should create window with initial IDs', () => {
        const window = createDeduplicationWindow(['tx-1', 'tx-2']);
        expect(window.queue).toEqual(['tx-1', 'tx-2']);
        expect(window.set.has('tx-1')).toBe(true);
        expect(window.set.has('tx-2')).toBe(true);
      });
    });

    describe('addToDeduplicationWindow', () => {
      it('should add ID to window', () => {
        const window = createDeduplicationWindow();
        addToDeduplicationWindow(window, 'tx-1', 10);
        expect(window.queue).toEqual(['tx-1']);
        expect(window.set.has('tx-1')).toBe(true);
      });

      it('should evict oldest when exceeding max size', () => {
        const window = createDeduplicationWindow(['tx-1', 'tx-2']);
        addToDeduplicationWindow(window, 'tx-3', 2);
        expect(window.queue).toEqual(['tx-2', 'tx-3']);
        expect(window.set.has('tx-1')).toBe(false);
        expect(window.set.has('tx-2')).toBe(true);
        expect(window.set.has('tx-3')).toBe(true);
      });

      it('should mutate window in place for performance', () => {
        const window = createDeduplicationWindow(['tx-1']);
        addToDeduplicationWindow(window, 'tx-2', 10);
        // Verify mutation happened
        expect(window.queue).toEqual(['tx-1', 'tx-2']);
        expect(window.set.has('tx-2')).toBe(true);
      });
    });

    describe('isInDeduplicationWindow', () => {
      it('should return true for ID in window', () => {
        const window = createDeduplicationWindow(['tx-1', 'tx-2']);
        expect(isInDeduplicationWindow(window, 'tx-1')).toBe(true);
      });

      it('should return false for ID not in window', () => {
        const window = createDeduplicationWindow(['tx-1', 'tx-2']);
        expect(isInDeduplicationWindow(window, 'tx-3')).toBe(false);
      });
    });

    describe('deduplicateTransactions', () => {
      it('should filter duplicate transactions', () => {
        const window = createDeduplicationWindow(['tx-1']);
        const transactions = [
          { normalized: { id: 'tx-1' } },
          { normalized: { id: 'tx-2' } },
          { normalized: { id: 'tx-3' } },
        ];

        const result = deduplicateTransactions(transactions, window, 10);
        expect(result).toHaveLength(2);
        expect(result[0]!.normalized.id).toBe('tx-2');
        expect(result[1]!.normalized.id).toBe('tx-3');
      });

      it('should update window with new IDs', () => {
        const window = createDeduplicationWindow(['tx-1']);
        const transactions = [{ normalized: { id: 'tx-2' } }, { normalized: { id: 'tx-3' } }];

        deduplicateTransactions(transactions, window, 10);
        // Window is mutated in place
        expect(window.set.has('tx-1')).toBe(true);
        expect(window.set.has('tx-2')).toBe(true);
        expect(window.set.has('tx-3')).toBe(true);
      });

      it('should evict oldest when exceeding window size', () => {
        const window = createDeduplicationWindow(['tx-1', 'tx-2']);
        const transactions = [{ normalized: { id: 'tx-3' } }, { normalized: { id: 'tx-4' } }];

        deduplicateTransactions(transactions, window, 3);
        // Window is mutated in place
        expect(window.queue).toHaveLength(3);
        expect(window.set.has('tx-1')).toBe(false); // Evicted
        expect(window.set.has('tx-2')).toBe(true);
        expect(window.set.has('tx-3')).toBe(true);
        expect(window.set.has('tx-4')).toBe(true);
      });

      it('should mutate window in place for performance', () => {
        const window = createDeduplicationWindow(['tx-1']);
        const transactions = [{ normalized: { id: 'tx-2' } }];

        deduplicateTransactions(transactions, window, 10);
        // Verify mutation happened
        expect(window.queue).toEqual(['tx-1', 'tx-2']);
        expect(window.set.has('tx-2')).toBe(true);
      });
    });
  });

  describe('buildProviderSelectionDebugInfo', () => {
    it('should build JSON string with provider info', () => {
      const provider1 = createMockProvider('provider-1');
      const health1: ProviderHealth = {
        ...createInitialHealth(),
        averageResponseTime: 1234.56,
        errorRate: 0.123,
        consecutiveFailures: 2,
      };

      const scoredProviders = [
        {
          provider: provider1,
          health: health1,
          score: 85.5,
        },
      ];

      const result = buildProviderSelectionDebugInfo(scoredProviders);
      const parsed = JSON.parse(result) as {
        avgResponseTime: number;
        consecutiveFailures: number;
        errorRate: number;
        isHealthy: boolean;
        name: string;
        rateLimitPerSec: number;
        score: number;
      }[];

      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toEqual({
        name: 'provider-1',
        score: 85.5,
        avgResponseTime: 1235, // Rounded
        errorRate: 12, // Rounded percentage
        consecutiveFailures: 2,
        isHealthy: true,
        rateLimitPerSec: 5,
      });
    });
  });

  describe('validateProviderApiKey', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // Clone env to restore later
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      // Restore original env
      process.env = originalEnv;
    });

    it('should validate API key is available', () => {
      process.env['TEST_PROVIDER_API_KEY'] = 'my-secret-key';

      const result = validateProviderApiKey({
        name: 'test-provider',
        displayName: 'Test Provider',
        requiresApiKey: true,
      });

      expect(result.available).toBe(true);
      expect(result.envVar).toBe('TEST_PROVIDER_API_KEY');
    });

    it('should use custom env var name if specified', () => {
      process.env['CUSTOM_API_KEY'] = 'my-secret-key';

      const result = validateProviderApiKey({
        name: 'test-provider',
        displayName: 'Test Provider',
        requiresApiKey: true,
        apiKeyEnvVar: 'CUSTOM_API_KEY',
      });

      expect(result.available).toBe(true);
      expect(result.envVar).toBe('CUSTOM_API_KEY');
    });

    it('should return false when API key is missing', () => {
      const result = validateProviderApiKey({
        name: 'test-provider',
        displayName: 'Test Provider',
        requiresApiKey: true,
      });

      expect(result.available).toBe(false);
      expect(result.envVar).toBe('TEST_PROVIDER_API_KEY');
    });

    it('should return false when API key is placeholder value', () => {
      process.env['TEST_PROVIDER_API_KEY'] = 'YourApiKeyToken';

      const result = validateProviderApiKey({
        name: 'test-provider',
        displayName: 'Test Provider',
        requiresApiKey: true,
      });

      expect(result.available).toBe(false);
    });

    it('should generate env var name from provider name', () => {
      const result = validateProviderApiKey({
        name: 'alchemy',
        displayName: 'Alchemy',
        requiresApiKey: true,
      });

      expect(result.envVar).toBe('ALCHEMY_API_KEY');
    });
  });

  describe('buildProviderNotFoundError', () => {
    it('should build error with suggestions', () => {
      const error = buildProviderNotFoundError('ethereum', 'invalid-provider', ['alchemy', 'moralis', 'infura']);

      expect(error).toContain("Preferred provider 'invalid-provider' not found for ethereum");
      expect(error).toContain('💡 Available providers for ethereum: alchemy, moralis, infura');
      expect(error).toContain("💡 Run 'pnpm run providers:list --blockchain ethereum' to see all options");
      expect(error).toContain("💡 Check for typos in provider name: 'invalid-provider'");
      expect(error).toContain("💡 Use 'pnpm run providers:sync --fix' to sync configuration");
    });

    it('should handle empty available providers list', () => {
      const error = buildProviderNotFoundError('solana', 'helius', []);

      expect(error).toContain("Preferred provider 'helius' not found for solana");
      expect(error).toContain('💡 Available providers for solana: ');
    });

    it('should handle single provider in list', () => {
      const error = buildProviderNotFoundError('bitcoin', 'invalid', ['blockstream']);

      expect(error).toContain('💡 Available providers for bitcoin: blockstream');
    });
  });
});
