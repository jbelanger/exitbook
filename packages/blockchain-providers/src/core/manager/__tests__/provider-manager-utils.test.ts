/**
 * Unit tests for provider-manager-utils
 * Pure function tests without mocks
 */

import type { CursorState, CursorType, PaginationCursor } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { createInitialCircuitState, type CircuitState } from '@exitbook/resilience/circuit-breaker';
import { createInitialHealth } from '@exitbook/resilience/provider-health';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IBlockchainProvider, ProviderCapabilities, ProviderHealth } from '../../types/index.js';
import type { CursorResolutionConfig } from '../provider-manager-utils.js';
import {
  addToDeduplicationWindow,
  buildProviderNotFoundError,
  canProviderResume,
  createDeduplicationWindow,
  deduplicateTransactions,
  isInDeduplicationWindow,
  resolveCursorForResumption,
  selectProvidersForOperation,
  supportsOperation,
  validateProviderApiKey,
} from '../provider-manager-utils.js';

const logger = getLogger('test');

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
  describe('supportsOperation', () => {
    it('should return true for supported operation', () => {
      const capabilities = {
        supportedOperations: ['getAddressTransactions', 'getTransaction'],
      } as ProviderCapabilities;
      expect(supportsOperation(capabilities, { type: 'getAddressTransactions', address: '0x123' })).toBe(true);
    });

    it('should return false for unsupported operation', () => {
      const capabilities = {
        supportedOperations: ['getAddressTransactions'],
      } as ProviderCapabilities;
      expect(supportsOperation(capabilities, { type: 'getAddressInfo', address: '0x123' })).toBe(false);
    });

    it('should check streamType for getAddressTransactions', () => {
      const capabilities = {
        supportedOperations: ['getAddressTransactions'],
        supportedTransactionTypes: ['normal', 'internal'],
      } as ProviderCapabilities;

      expect(
        supportsOperation(capabilities, {
          type: 'getAddressTransactions',
          address: '0x123',
          streamType: 'normal',
        })
      ).toBe(true);
      expect(
        supportsOperation(capabilities, {
          type: 'getAddressTransactions',
          address: '0x123',
          streamType: 'internal',
        })
      ).toBe(true);
      expect(
        supportsOperation(capabilities, {
          type: 'getAddressTransactions',
          address: '0x123',
          streamType: 'token',
        })
      ).toBe(false);
    });

    it('should default to normal if supportedTransactionTypes is missing', () => {
      const capabilities = {
        supportedOperations: ['getAddressTransactions'],
      } as ProviderCapabilities;

      expect(
        supportsOperation(capabilities, {
          type: 'getAddressTransactions',
          address: '0x123',
          streamType: 'normal',
        })
      ).toBe(true);
      expect(
        supportsOperation(capabilities, {
          type: 'getAddressTransactions',
          address: '0x123',
          streamType: 'token',
        })
      ).toBe(false);
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
        { type: 'getAddressTransactions', address: '0x123' },
        Date.now()
      );

      expect(result).toHaveLength(3);
      expect(result[0]!.provider.name).toBe('provider-2'); // Fastest (bonus)
      expect(result[2]!.provider.name).toBe('provider-3'); // Unhealthy (penalty)
    });

    it('should exclude providers that do not support operation', () => {
      const provider1 = createMockProvider('provider-1', ['getAddressTransactions']);
      const provider2 = createMockProvider('provider-2', ['getAddressInfo']);

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
        { type: 'getAddressTransactions', address: '0x123' },
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
        { type: 'getAddressTransactions', address: '0x123' },
        Date.now()
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.provider.name).toBe('provider-1');
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
        const window = createDeduplicationWindow(['event-1']);
        const transactions = [
          { normalized: { id: 'tx-1', eventId: 'event-1' } },
          { normalized: { id: 'tx-2', eventId: 'event-2' } },
          { normalized: { id: 'tx-3', eventId: 'event-3' } },
        ];

        const result = deduplicateTransactions(transactions, window, 10);
        expect(result).toHaveLength(2);
        expect(result[0]!.normalized.id).toBe('tx-2');
        expect(result[1]!.normalized.id).toBe('tx-3');
      });

      it('should update window with new IDs', () => {
        const window = createDeduplicationWindow(['event-1']);
        const transactions = [
          { normalized: { id: 'tx-2', eventId: 'event-2' } },
          { normalized: { id: 'tx-3', eventId: 'event-3' } },
        ];

        deduplicateTransactions(transactions, window, 10);
        // Window is mutated in place
        expect(window.set.has('event-1')).toBe(true);
        expect(window.set.has('event-2')).toBe(true);
        expect(window.set.has('event-3')).toBe(true);
      });

      it('should evict oldest when exceeding window size', () => {
        const window = createDeduplicationWindow(['event-1', 'event-2']);
        const transactions = [
          { normalized: { id: 'tx-3', eventId: 'event-3' } },
          { normalized: { id: 'tx-4', eventId: 'event-4' } },
        ];

        deduplicateTransactions(transactions, window, 3);
        // Window is mutated in place
        expect(window.queue).toHaveLength(3);
        expect(window.set.has('event-1')).toBe(false); // Evicted
        expect(window.set.has('event-2')).toBe(true);
        expect(window.set.has('event-3')).toBe(true);
        expect(window.set.has('event-4')).toBe(true);
      });

      it('should mutate window in place for performance', () => {
        const window = createDeduplicationWindow(['event-1']);
        const transactions = [{ normalized: { id: 'tx-2', eventId: 'event-2' } }];

        deduplicateTransactions(transactions, window, 10);
        // Verify mutation happened
        expect(window.queue).toEqual(['event-1', 'event-2']);
        expect(window.set.has('event-2')).toBe(true);
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
      expect(error).toContain('Available providers for ethereum: alchemy, moralis, infura');
      expect(error).toContain("Run 'pnpm run providers:list --blockchain ethereum' to see all options");
      expect(error).toContain("Check for typos in provider name: 'invalid-provider'");
      expect(error).toContain("Use 'pnpm run providers:sync --fix' to sync configuration");
    });

    it('should handle empty available providers list', () => {
      const error = buildProviderNotFoundError('solana', 'helius', []);

      expect(error).toContain("Preferred provider 'helius' not found for solana");
      expect(error).toContain('Available providers for solana: ');
    });

    it('should handle single provider in list', () => {
      const error = buildProviderNotFoundError('bitcoin', 'invalid', ['blockstream']);

      expect(error).toContain('Available providers for bitcoin: blockstream');
    });
  });

  describe('resolveCursorForResumption', () => {
    const mockApplyReplayWindow = (cursor: PaginationCursor): PaginationCursor => {
      if (cursor.type === 'blockNumber') {
        return { type: 'blockNumber', value: Math.max(0, cursor.value - 5) };
      }
      if (cursor.type === 'timestamp') {
        return { type: 'timestamp', value: Math.max(0, cursor.value - 300000) }; // 5 min
      }
      return cursor;
    };

    it('should return empty object when no resume cursor provided', () => {
      const config: CursorResolutionConfig = {
        providerName: 'moralis',
        supportedCursorTypes: ['pageToken', 'blockNumber'],
        isFailover: false,
        applyReplayWindow: mockApplyReplayWindow,
      };

      const resolved = resolveCursorForResumption(undefined, config, logger);

      expect(resolved).toEqual({});
    });

    it('should use pageToken from same provider (Priority 1)', () => {
      const resumeCursor: CursorState = {
        primary: { type: 'pageToken', value: 'abc123', providerName: 'moralis' },
        alternatives: [{ type: 'blockNumber', value: 15000000 }],
        lastTransactionId: 'tx-123',
        totalFetched: 100,
      };

      const config: CursorResolutionConfig = {
        providerName: 'moralis',
        supportedCursorTypes: ['pageToken', 'blockNumber'],
        isFailover: false, // Same provider resume
        applyReplayWindow: mockApplyReplayWindow,
      };

      const resolved = resolveCursorForResumption(resumeCursor, config, logger);

      expect(resolved).toEqual({
        pageToken: 'abc123',
      });
    });

    it('should not use pageToken from different provider', () => {
      const resumeCursor: CursorState = {
        primary: { type: 'pageToken', value: 'abc123', providerName: 'alchemy' },
        alternatives: [{ type: 'blockNumber', value: 15000000 }],
        lastTransactionId: 'tx-123',
        totalFetched: 100,
      };

      const config: CursorResolutionConfig = {
        providerName: 'moralis',
        supportedCursorTypes: ['pageToken', 'blockNumber'],
        isFailover: true, // Cross-provider failover
        applyReplayWindow: mockApplyReplayWindow,
      };

      const resolved = resolveCursorForResumption(resumeCursor, config, logger);

      // Should fall back to blockNumber with replay window
      expect(resolved).toEqual({
        fromBlock: 14999995, // 15000000 - 5
      });
    });

    it('should use blockNumber from primary cursor with replay window on failover', () => {
      const resumeCursor: CursorState = {
        primary: { type: 'blockNumber', value: 15000000 },
        alternatives: [{ type: 'timestamp', value: 1640000000000 }],
        lastTransactionId: 'tx-123',
        totalFetched: 100,
      };

      const config: CursorResolutionConfig = {
        providerName: 'moralis',
        supportedCursorTypes: ['pageToken', 'blockNumber'],
        isFailover: true, // Cross-provider failover
        applyReplayWindow: mockApplyReplayWindow,
      };

      const resolved = resolveCursorForResumption(resumeCursor, config, logger);

      expect(resolved).toEqual({
        fromBlock: 14999995, // With replay window applied
      });
    });

    it('should use blockNumber from alternatives if not in primary', () => {
      const resumeCursor: CursorState = {
        primary: { type: 'pageToken', value: 'abc123', providerName: 'alchemy' },
        alternatives: [
          { type: 'blockNumber', value: 15000000 },
          { type: 'timestamp', value: 1640000000000 },
        ],
        lastTransactionId: 'tx-123',
        totalFetched: 100,
      };

      const config: CursorResolutionConfig = {
        providerName: 'moralis',
        supportedCursorTypes: ['blockNumber'],
        isFailover: true, // Cross-provider failover
        applyReplayWindow: mockApplyReplayWindow,
      };

      const resolved = resolveCursorForResumption(resumeCursor, config, logger);

      expect(resolved).toEqual({
        fromBlock: 14999995,
      });
    });

    it('should use timestamp cursor if blockNumber not available', () => {
      const resumeCursor: CursorState = {
        primary: { type: 'timestamp', value: 1640000000000 },
        alternatives: [],
        lastTransactionId: 'tx-123',
        totalFetched: 100,
      };

      const config: CursorResolutionConfig = {
        providerName: 'moralis',
        supportedCursorTypes: ['timestamp'],
        isFailover: true, // Cross-provider failover
        applyReplayWindow: mockApplyReplayWindow,
      };

      const resolved = resolveCursorForResumption(resumeCursor, config, logger);

      expect(resolved).toEqual({
        fromTimestamp: 1639999700000, // With replay window applied
      });
    });

    it('should return empty if no compatible cursor type supported', () => {
      const resumeCursor: CursorState = {
        primary: { type: 'blockNumber', value: 15000000 },
        alternatives: [{ type: 'timestamp', value: 1640000000000 }],
        lastTransactionId: 'tx-123',
        totalFetched: 100,
      };

      const config: CursorResolutionConfig = {
        providerName: 'moralis',
        supportedCursorTypes: ['pageToken'], // Only supports pageToken
        isFailover: false,
        applyReplayWindow: mockApplyReplayWindow,
      };

      const resolved = resolveCursorForResumption(resumeCursor, config, logger);

      expect(resolved).toEqual({});
    });

    it('should apply replay window to cross-provider cursors', () => {
      const applyReplayWindowSpy = vi.fn(mockApplyReplayWindow);

      const resumeCursor: CursorState = {
        primary: { type: 'blockNumber', value: 15000000 },
        alternatives: [],
        lastTransactionId: 'tx-123',
        totalFetched: 100,
      };

      const config: CursorResolutionConfig = {
        providerName: 'moralis',
        supportedCursorTypes: ['blockNumber'],
        isFailover: true, // Cross-provider failover
        applyReplayWindow: applyReplayWindowSpy,
      };

      resolveCursorForResumption(resumeCursor, config, logger);

      expect(applyReplayWindowSpy).toHaveBeenCalledWith({ type: 'blockNumber', value: 15000000 });
    });

    // NEW: Test for regression fix - replay window should NOT apply on same-provider resume
    it('should NOT apply replay window for same-provider blockNumber resume', () => {
      const applyReplayWindowSpy = vi.fn(mockApplyReplayWindow);

      const resumeCursor: CursorState = {
        primary: { type: 'blockNumber', value: 15000000 },
        alternatives: [],
        lastTransactionId: 'tx-123',
        totalFetched: 100,
      };

      const config: CursorResolutionConfig = {
        providerName: 'moralis',
        supportedCursorTypes: ['blockNumber'],
        isFailover: false, // Same provider resume - NO replay window
        applyReplayWindow: applyReplayWindowSpy,
      };

      const resolved = resolveCursorForResumption(resumeCursor, config, logger);

      // Should use exact cursor value without replay window
      expect(resolved).toEqual({
        fromBlock: 15000000, // Exact value, NOT 14999995
      });
      // Replay window function should NOT be called
      expect(applyReplayWindowSpy).not.toHaveBeenCalled();
    });

    it('should NOT apply replay window for same-provider timestamp resume', () => {
      const applyReplayWindowSpy = vi.fn(mockApplyReplayWindow);

      const resumeCursor: CursorState = {
        primary: { type: 'timestamp', value: 1640000000000 },
        alternatives: [],
        lastTransactionId: 'tx-123',
        totalFetched: 100,
      };

      const config: CursorResolutionConfig = {
        providerName: 'moralis',
        supportedCursorTypes: ['timestamp'],
        isFailover: false, // Same provider resume - NO replay window
        applyReplayWindow: applyReplayWindowSpy,
      };

      const resolved = resolveCursorForResumption(resumeCursor, config, logger);

      // Should use exact cursor value without replay window
      expect(resolved).toEqual({
        fromTimestamp: 1640000000000, // Exact value, NOT 1639999700000
      });
      // Replay window function should NOT be called
      expect(applyReplayWindowSpy).not.toHaveBeenCalled();
    });
  });
});
