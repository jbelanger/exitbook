/**
 * Tests for provider manager pure utility functions
 *
 * No mocks needed - all functions are pure!
 */

import type { CircuitState } from '@exitbook/platform-http';
import { createInitialCircuitState } from '@exitbook/platform-http';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import * as ProviderManagerUtils from '../provider-manager-utils.ts';
import type {
  IPriceProvider,
  ProviderHealth,
  ProviderMetadata,
  PriceData,
  PriceProviderOperation,
} from '../types/index.ts';

describe('isCacheValid', () => {
  it('should return true when cache has not expired', () => {
    const now = 1000;
    const expiry = 2000;

    expect(ProviderManagerUtils.isCacheValid(expiry, now)).toBe(true);
  });

  it('should return false when cache has expired', () => {
    const now = 2000;
    const expiry = 1000;

    expect(ProviderManagerUtils.isCacheValid(expiry, now)).toBe(false);
  });

  it('should return false when cache expires exactly now', () => {
    const now = 1000;
    const expiry = 1000;

    expect(ProviderManagerUtils.isCacheValid(expiry, now)).toBe(false);
  });
});

describe('scoreProvider', () => {
  const mockRateLimit = {
    burstLimit: 1,
    requestsPerHour: 600,
    requestsPerMinute: 10,
    requestsPerSecond: 0.17,
  };

  const createMockMetadata = (overrides?: Partial<ProviderMetadata>): ProviderMetadata => ({
    capabilities: {
      supportedCurrencies: ['USD'],
      supportedOperations: ['fetchPrice'],
      rateLimit: mockRateLimit,
    },
    displayName: 'Test Provider',
    name: 'test',
    requiresApiKey: false,
    ...overrides,
  });

  const createMockHealth = (overrides?: Partial<ProviderHealth>): ProviderHealth => ({
    averageResponseTime: 500,
    consecutiveFailures: 0,
    errorRate: 0,
    isHealthy: true,
    lastChecked: 0,
    ...overrides,
  });

  it('should return base score of 100 for healthy provider', () => {
    const metadata = createMockMetadata();
    const health = createMockHealth();
    const circuit = createInitialCircuitState();
    const now = Date.now();

    const score = ProviderManagerUtils.scoreProvider(metadata, health, circuit, now);

    // Base 100 + fast response bonus (20) = 120
    expect(score).toBe(120);
  });

  it('should penalize open circuit breaker', () => {
    const metadata = createMockMetadata();
    const health = createMockHealth();
    const now = Date.now();
    const circuit = {
      ...createInitialCircuitState(),
      failureCount: 5, // Exceeds maxFailures (default 3)
      lastFailureTime: now - 1000, // Recent failure, within recovery timeout
    };

    const score = ProviderManagerUtils.scoreProvider(metadata, health, circuit, now);

    // Base 100 - open circuit (100) + fast bonus (20) = 20
    expect(score).toBe(20);
  });

  it('should penalize half-open circuit breaker', () => {
    const metadata = createMockMetadata();
    const health = createMockHealth();
    const now = Date.now();
    const circuit = {
      ...createInitialCircuitState(),
      failureCount: 5, // Exceeds maxFailures
      lastFailureTime: now - 70000, // 70s ago, past recovery timeout (60s default)
      recoveryTimeoutMs: 60000,
    };

    const score = ProviderManagerUtils.scoreProvider(metadata, health, circuit, now);

    // Base 100 - half-open (25) + fast bonus (20) = 95
    expect(score).toBe(95);
  });

  it('should penalize unhealthy provider', () => {
    const metadata = createMockMetadata();
    const health = createMockHealth({ isHealthy: false });
    const circuit = createInitialCircuitState();
    const now = Date.now();

    const score = ProviderManagerUtils.scoreProvider(metadata, health, circuit, now);

    // Base 100 - unhealthy (50) + fast bonus (20) = 70
    expect(score).toBe(70);
  });

  it('should bonus for fast response time', () => {
    const metadata = createMockMetadata();
    const health = createMockHealth({ averageResponseTime: 500 });
    const circuit = createInitialCircuitState();
    const now = Date.now();

    const score = ProviderManagerUtils.scoreProvider(metadata, health, circuit, now);

    // Should include +20 bonus for < 1000ms
    expect(score).toBeGreaterThan(100);
  });

  it('should penalize slow response time', () => {
    const metadata = createMockMetadata();
    const health = createMockHealth({ averageResponseTime: 6000 });
    const circuit = createInitialCircuitState();
    const now = Date.now();

    const score = ProviderManagerUtils.scoreProvider(metadata, health, circuit, now);

    // Base 100 - slow penalty (30) = 70
    expect(score).toBe(70);
  });

  it('should penalize based on error rate', () => {
    const metadata = createMockMetadata();
    const health = createMockHealth({ errorRate: 0.5, averageResponseTime: 1500 }); // 50% errors
    const circuit = createInitialCircuitState();
    const now = Date.now();

    const score = ProviderManagerUtils.scoreProvider(metadata, health, circuit, now);

    // Base 100 - error rate penalty (25) = 75
    expect(score).toBe(75);
  });

  it('should penalize consecutive failures', () => {
    const metadata = createMockMetadata();
    const health = createMockHealth({ consecutiveFailures: 3 });
    const circuit = createInitialCircuitState();
    const now = Date.now();

    const score = ProviderManagerUtils.scoreProvider(metadata, health, circuit, now);

    // Base 100 - failures (30) + fast bonus (20) = 90
    expect(score).toBe(90);
  });
});

describe('supportsOperation', () => {
  const mockRateLimit = {
    burstLimit: 1,
    requestsPerHour: 600,
    requestsPerMinute: 10,
    requestsPerSecond: 0.17,
  };

  it('should return true when operation is supported', () => {
    const metadata: ProviderMetadata = {
      capabilities: {
        supportedCurrencies: ['USD'],
        supportedOperations: ['fetchPrice'],
        rateLimit: mockRateLimit,
      },
      displayName: 'Test',
      name: 'test',
      requiresApiKey: false,
    };

    expect(ProviderManagerUtils.supportsOperation(metadata, 'fetchPrice')).toBe(true);
  });

  it('should return false when operation is not supported', () => {
    const metadata: ProviderMetadata = {
      capabilities: {
        supportedCurrencies: ['USD'],
        supportedOperations: ['fetchPrice'],
        rateLimit: mockRateLimit,
      },
      displayName: 'Test',
      name: 'test',
      requiresApiKey: false,
    };

    expect(ProviderManagerUtils.supportsOperation(metadata, 'fetchBatch')).toBe(false);
  });
});

describe('selectProvidersForOperation', () => {
  const mockRateLimit = {
    burstLimit: 1,
    requestsPerHour: 600,
    requestsPerMinute: 10,
    requestsPerSecond: 0.17,
  };

  const createMockProvider = (name: string, operations: string[]): IPriceProvider => ({
    fetchPrice: async () => Promise.resolve({ isErr: () => true, isOk: () => false } as Result<PriceData, Error>),
    getMetadata: () => ({
      capabilities: {
        supportedCurrencies: ['USD'],
        supportedOperations: operations as PriceProviderOperation[],
        rateLimit: mockRateLimit,
      },
      displayName: name,
      name,
      requiresApiKey: false,
    }),
  });

  it('should filter providers by operation support', () => {
    const provider1 = createMockProvider('provider1', ['fetchPrice']);
    const provider2 = createMockProvider('provider2', ['fetchPrice', 'fetchBatch']);
    const providers = [provider1, provider2];

    const healthMap = new Map<string, ProviderHealth>([
      ['provider1', ProviderManagerUtils.createInitialHealth()],
      ['provider2', ProviderManagerUtils.createInitialHealth()],
    ]);

    const circuitMap = new Map([
      ['provider1', createInitialCircuitState()],
      ['provider2', createInitialCircuitState()],
    ]);

    const selected = ProviderManagerUtils.selectProvidersForOperation(
      providers,
      healthMap,
      circuitMap,
      'fetchBatch',
      Date.now()
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]?.metadata.name).toBe('provider2');
  });

  it('should order providers by score (highest first)', () => {
    const fastProvider = createMockProvider('fast', ['fetchPrice']);
    const slowProvider = createMockProvider('slow', ['fetchPrice']);
    const providers = [slowProvider, fastProvider];

    const healthMap = new Map<string, ProviderHealth>([
      ['fast', { ...ProviderManagerUtils.createInitialHealth(), averageResponseTime: 100 }],
      ['slow', { ...ProviderManagerUtils.createInitialHealth(), averageResponseTime: 10000 }],
    ]);

    const circuitMap = new Map([
      ['fast', createInitialCircuitState()],
      ['slow', createInitialCircuitState()],
    ]);

    const selected = ProviderManagerUtils.selectProvidersForOperation(
      providers,
      healthMap,
      circuitMap,
      'fetchPrice',
      Date.now()
    );

    expect(selected).toHaveLength(2);
    expect(selected[0]?.metadata.name).toBe('fast');
    expect(selected[1]?.metadata.name).toBe('slow');
  });

  it('should skip providers without health or circuit state', () => {
    const provider = createMockProvider('test', ['fetchPrice']);
    const providers = [provider];

    const healthMap = new Map<string, ProviderHealth>();
    const circuitMap = new Map<string, CircuitState>();

    const selected = ProviderManagerUtils.selectProvidersForOperation(
      providers,
      healthMap,
      circuitMap,
      'fetchPrice',
      Date.now()
    );

    expect(selected).toHaveLength(0);
  });
});

describe('hasAvailableProviders', () => {
  const mockRateLimit = {
    burstLimit: 1,
    requestsPerHour: 600,
    requestsPerMinute: 10,
    requestsPerSecond: 0.17,
  };

  const createMockProvider = (name: string): IPriceProvider => ({
    fetchPrice: async () => Promise.resolve({ isErr: () => true, isOk: () => false } as Result<PriceData, Error>),
    getMetadata: () => ({
      capabilities: {
        supportedCurrencies: ['USD'],
        supportedOperations: ['fetchPrice'],
        rateLimit: mockRateLimit,
      },
      displayName: name,
      name,
      requiresApiKey: false,
    }),
  });

  it('should return true when at least one provider has closed circuit', () => {
    const providers = [createMockProvider('test')];
    const circuitMap = new Map([['test', createInitialCircuitState()]]);
    const now = Date.now();

    expect(ProviderManagerUtils.hasAvailableProviders(providers, circuitMap, now)).toBe(true);
  });

  it('should return false when all providers have open circuits', () => {
    const providers = [createMockProvider('test')];
    const now = Date.now();
    const circuitMap = new Map([
      [
        'test',
        {
          ...createInitialCircuitState(),
          failureCount: 5,
          lastFailureTime: now - 1000, // Recent failure
        },
      ],
    ]);

    expect(ProviderManagerUtils.hasAvailableProviders(providers, circuitMap, now)).toBe(false);
  });

  it('should return true when provider has no circuit state', () => {
    const providers = [createMockProvider('test')];
    const circuitMap = new Map<string, CircuitState>();
    const now = Date.now();

    expect(ProviderManagerUtils.hasAvailableProviders(providers, circuitMap, now)).toBe(true);
  });
});

describe('updateHealthMetrics', () => {
  it('should update health on success', () => {
    const currentHealth = ProviderManagerUtils.createInitialHealth();
    const now = 1000;

    const newHealth = ProviderManagerUtils.updateHealthMetrics(currentHealth, true, 500, now);

    expect(newHealth.isHealthy).toBe(true);
    expect(newHealth.lastChecked).toBe(1000);
    expect(newHealth.consecutiveFailures).toBe(0);
    expect(newHealth.averageResponseTime).toBe(500);
  });

  it('should update health on failure', () => {
    const currentHealth = ProviderManagerUtils.createInitialHealth();
    const now = 1000;

    const newHealth = ProviderManagerUtils.updateHealthMetrics(currentHealth, false, 500, now, 'Test error');

    expect(newHealth.isHealthy).toBe(false);
    expect(newHealth.lastChecked).toBe(1000);
    expect(newHealth.consecutiveFailures).toBe(1);
    expect(newHealth.lastError).toBe('Test error');
  });

  it('should increment consecutive failures', () => {
    const currentHealth = {
      ...ProviderManagerUtils.createInitialHealth(),
      consecutiveFailures: 2,
    };
    const now = 1000;

    const newHealth = ProviderManagerUtils.updateHealthMetrics(currentHealth, false, 500, now);

    expect(newHealth.consecutiveFailures).toBe(3);
  });

  it('should reset consecutive failures on success', () => {
    const currentHealth = {
      ...ProviderManagerUtils.createInitialHealth(),
      consecutiveFailures: 5,
    };
    const now = 1000;

    const newHealth = ProviderManagerUtils.updateHealthMetrics(currentHealth, true, 500, now);

    expect(newHealth.consecutiveFailures).toBe(0);
  });

  it('should calculate exponential moving average for response time', () => {
    const currentHealth = {
      ...ProviderManagerUtils.createInitialHealth(),
      averageResponseTime: 1000,
    };
    const now = 1000;

    const newHealth = ProviderManagerUtils.updateHealthMetrics(currentHealth, true, 500, now);

    // EMA: 1000 * 0.8 + 500 * 0.2 = 900
    expect(newHealth.averageResponseTime).toBe(900);
  });

  it('should update error rate', () => {
    const currentHealth = {
      ...ProviderManagerUtils.createInitialHealth(),
      errorRate: 0.5,
    };
    const now = 1000;

    const newHealthSuccess = ProviderManagerUtils.updateHealthMetrics(currentHealth, true, 500, now);
    const newHealthFailure = ProviderManagerUtils.updateHealthMetrics(currentHealth, false, 500, now);

    // Success: 0.5 * 0.9 + 0 * 0.1 = 0.45
    expect(newHealthSuccess.errorRate).toBe(0.45);

    // Failure: 0.5 * 0.9 + 1 * 0.1 = 0.55
    expect(newHealthFailure.errorRate).toBe(0.55);
  });

  it('should not mutate original health object', () => {
    const currentHealth = ProviderManagerUtils.createInitialHealth();
    const originalHealth = { ...currentHealth };
    const now = 1000;

    ProviderManagerUtils.updateHealthMetrics(currentHealth, false, 500, now);

    expect(currentHealth).toEqual(originalHealth);
  });
});

describe('createInitialHealth', () => {
  it('should create initial health state', () => {
    const health = ProviderManagerUtils.createInitialHealth();

    expect(health).toEqual({
      averageResponseTime: 0,
      consecutiveFailures: 0,
      errorRate: 0,
      isHealthy: true,
      lastChecked: 0,
    });
  });
});

describe('shouldBlockDueToCircuit', () => {
  it('should not block when circuit is closed', () => {
    const circuit = createInitialCircuitState();
    const now = Date.now();

    const reason = ProviderManagerUtils.shouldBlockDueToCircuit(circuit, true, now);

    expect(reason).toBeUndefined();
  });

  it('should block when circuit is open and alternatives exist', () => {
    const now = Date.now();
    const circuit = {
      ...createInitialCircuitState(),
      failureCount: 5,
      lastFailureTime: now - 1000, // Recent failure
    };

    const reason = ProviderManagerUtils.shouldBlockDueToCircuit(circuit, true, now);

    expect(reason).toBe('circuit_open');
  });

  it('should warn when circuit is open but no alternatives', () => {
    const now = Date.now();
    const circuit = {
      ...createInitialCircuitState(),
      failureCount: 5,
      lastFailureTime: now - 1000,
    };

    const reason = ProviderManagerUtils.shouldBlockDueToCircuit(circuit, false, now);

    expect(reason).toBe('circuit_open_no_alternatives');
  });

  it('should warn when circuit is half-open', () => {
    const now = Date.now();
    const circuit = {
      ...createInitialCircuitState(),
      failureCount: 5,
      lastFailureTime: now - 70000, // Past recovery timeout
      recoveryTimeoutMs: 60000,
    };

    const reason = ProviderManagerUtils.shouldBlockDueToCircuit(circuit, true, now);

    expect(reason).toBe('circuit_half_open');
  });
});

describe('buildProviderSelectionDebugInfo', () => {
  it('should build JSON debug string from scored providers', () => {
    const mockRateLimit = {
      burstLimit: 1,
      requestsPerHour: 600,
      requestsPerMinute: 10,
      requestsPerSecond: 0.17,
    };

    const scoredProviders = [
      {
        health: {
          averageResponseTime: 123.456,
          consecutiveFailures: 0,
          errorRate: 0.123,
          isHealthy: true,
          lastChecked: 1000,
        },
        metadata: {
          capabilities: {
            supportedCurrencies: ['USD'],
            supportedOperations: ['fetchPrice'] as PriceProviderOperation[],
            rateLimit: mockRateLimit,
          },
          displayName: 'Test',
          name: 'test',
          requiresApiKey: false,
        },
        provider: {} as IPriceProvider,
        score: 150,
      },
    ];

    const debugInfo = ProviderManagerUtils.buildProviderSelectionDebugInfo(scoredProviders);

    const parsed = JSON.parse(debugInfo) as {
      avgResponseTime: number;
      consecutiveFailures: number;
      errorRate: number;
      isHealthy: boolean;
      name: string;
      score: number;
    }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      avgResponseTime: 123,
      consecutiveFailures: 0,
      errorRate: 12,
      isHealthy: true,
      name: 'test',
      score: 150,
    });
  });
});
