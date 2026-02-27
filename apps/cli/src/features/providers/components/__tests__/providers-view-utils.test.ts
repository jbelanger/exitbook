import type { ProviderInfo, ProviderStatsRow } from '@exitbook/blockchain-providers';
import { describe, expect, it } from 'vitest';

import {
  buildProviderMap,
  computeAggregateStats,
  computeHealthStatus,
  checkApiKeyStatus,
  detectConfigSource,
  detectConfigSourceForBlockchain,
  filterProviders,
  formatTimeAgo,
  sortProviders,
  validateHealthFilter,
  mergeProviderData,
} from '../../providers-view-utils.js';
import type { ProviderViewItem } from '../providers-view-state.js';

// --- Test Helpers ---

function makeProviderInfo(overrides: Partial<ProviderInfo> & { blockchain: string; name: string }): ProviderInfo {
  return {
    displayName: overrides.displayName ?? overrides.name,
    description: '',
    requiresApiKey: false,
    capabilities: {
      supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
    },
    defaultConfig: {
      rateLimit: { requestsPerSecond: 5 },
      retries: 3,
      timeout: 30_000,
    },
    ...overrides,
  };
}

function makeStatsRow(
  overrides: Partial<ProviderStatsRow> & { blockchain: string; provider_name: string }
): ProviderStatsRow {
  return {
    avg_response_time: 100,
    error_rate: 0.5,
    consecutive_failures: 0,
    is_healthy: 1,
    // eslint-disable-next-line unicorn/no-null -- db null ok
    last_error: null,
    last_checked: Date.now(),
    failure_count: 0,
    last_failure_time: 0,
    last_success_time: Date.now(),
    total_successes: 100,
    total_failures: 1,
    ...overrides,
  };
}

function makeViewItem(overrides: Partial<ProviderViewItem> & { name: string }): ProviderViewItem {
  return {
    displayName: overrides.displayName ?? overrides.name,
    requiresApiKey: false,
    blockchains: [],
    chainCount: 1,
    healthStatus: 'healthy',
    configSource: 'default',
    ...overrides,
  };
}

// --- Tests ---

describe('view-providers-utils', () => {
  describe('validateHealthFilter', () => {
    it('should validate valid health filters', () => {
      expect(validateHealthFilter('healthy').isOk()).toBe(true);
      expect(validateHealthFilter('degraded').isOk()).toBe(true);
      expect(validateHealthFilter('unhealthy').isOk()).toBe(true);
    });

    it('should reject invalid health filters', () => {
      const result = validateHealthFilter('invalid');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid health filter');
      }
    });

    it('should not accept no-stats as filter value', () => {
      const result = validateHealthFilter('no-stats');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('buildProviderMap', () => {
    it('should group providers by name across blockchains', () => {
      const getAvailable = (blockchain: string): ProviderInfo[] => {
        if (blockchain === 'ethereum') {
          return [
            makeProviderInfo({ name: 'alchemy', blockchain: 'ethereum' }),
            makeProviderInfo({ name: 'etherscan', blockchain: 'ethereum' }),
          ];
        }
        if (blockchain === 'polygon') {
          return [makeProviderInfo({ name: 'alchemy', blockchain: 'polygon' })];
        }
        return [];
      };

      const map = buildProviderMap(['ethereum', 'polygon'], getAvailable);

      expect(map.size).toBe(2);
      expect(map.get('alchemy')?.length).toBe(2);
      expect(map.get('etherscan')?.length).toBe(1);
    });

    it('should handle blockchains with no providers', () => {
      const map = buildProviderMap(['empty-chain'], () => []);
      expect(map.size).toBe(0);
    });

    it('should handle empty blockchain list', () => {
      const map = buildProviderMap([], () => []);
      expect(map.size).toBe(0);
    });
  });

  describe('computeAggregateStats', () => {
    it('should compute weighted average response time', () => {
      const stats = computeAggregateStats([
        { avgResponseTime: 100, totalSuccesses: 100, totalFailures: 0, errorRate: 0, lastChecked: 1000 },
        { avgResponseTime: 200, totalSuccesses: 100, totalFailures: 0, errorRate: 0, lastChecked: 2000 },
      ]);

      expect(stats).toBeDefined();
      expect(stats!.avgResponseTime).toBe(150); // (100*100 + 200*100) / 200
      expect(stats!.totalRequests).toBe(200);
      expect(stats!.lastChecked).toBe(2000);
    });

    it('should compute weighted avg accounting for different request counts', () => {
      const stats = computeAggregateStats([
        { avgResponseTime: 100, totalSuccesses: 300, totalFailures: 0, errorRate: 0, lastChecked: 1000 },
        { avgResponseTime: 400, totalSuccesses: 100, totalFailures: 0, errorRate: 0, lastChecked: 2000 },
      ]);

      expect(stats).toBeDefined();
      // (100*300 + 400*100) / 400 = 70000/400 = 175
      expect(stats!.avgResponseTime).toBe(175);
    });

    it('should compute error rate from totals', () => {
      const stats = computeAggregateStats([
        { avgResponseTime: 100, totalSuccesses: 90, totalFailures: 10, errorRate: 10, lastChecked: 1000 },
        { avgResponseTime: 100, totalSuccesses: 100, totalFailures: 0, errorRate: 0, lastChecked: 1000 },
      ]);

      expect(stats).toBeDefined();
      expect(stats!.errorRate).toBe(5); // 10/200 * 100 = 5%
    });

    it('should return undefined for empty stats', () => {
      expect(computeAggregateStats([])).toBeUndefined();
    });

    it('should return undefined when all stats have zero requests', () => {
      const stats = computeAggregateStats([
        { avgResponseTime: 0, totalSuccesses: 0, totalFailures: 0, errorRate: 0, lastChecked: 0 },
      ]);
      expect(stats).toBeUndefined();
    });
  });

  describe('computeHealthStatus', () => {
    it('should return healthy when all chains under 2%', () => {
      expect(
        computeHealthStatus([
          { errorRate: 0.5, isHealthy: true },
          { errorRate: 1.0, isHealthy: true },
        ])
      ).toBe('healthy');
    });

    it('should return degraded when any chain between 2-10%', () => {
      expect(
        computeHealthStatus([
          { errorRate: 0.5, isHealthy: true },
          { errorRate: 5.0, isHealthy: true },
        ])
      ).toBe('degraded');
    });

    it('should return unhealthy when any chain >= 10%', () => {
      expect(
        computeHealthStatus([
          { errorRate: 0.5, isHealthy: true },
          { errorRate: 12.0, isHealthy: false },
        ])
      ).toBe('unhealthy');
    });

    it('should return no-stats for empty array', () => {
      expect(computeHealthStatus([])).toBe('no-stats');
    });

    it('should use worst-of logic (unhealthy wins over degraded)', () => {
      expect(
        computeHealthStatus([
          { errorRate: 5.0, isHealthy: true },
          { errorRate: 15.0, isHealthy: false },
        ])
      ).toBe('unhealthy');
    });
  });

  describe('checkApiKeyStatus', () => {
    it('should return undefined for undefined env var', () => {
      expect(checkApiKeyStatus(undefined)).toBeUndefined();
    });

    it('should return false for unset env var', () => {
      expect(checkApiKeyStatus('DEFINITELY_NOT_SET_XYZ_123')).toBe(false);
    });

    it('should return true for set env var', () => {
      // PATH is always set
      expect(checkApiKeyStatus('PATH')).toBe(true);
    });
  });

  describe('detectConfigSourceForBlockchain', () => {
    it('should return default when no config', () => {
      expect(detectConfigSourceForBlockchain('alchemy', 'ethereum', undefined)).toBe('default');
    });

    it('should return default when no override for provider on this blockchain', () => {
      const config = {
        ethereum: {
          overrides: {
            etherscan: { priority: 1 },
          },
        },
      };
      expect(detectConfigSourceForBlockchain('alchemy', 'ethereum', config)).toBe('default');
    });

    it('should return override when provider has override on this blockchain', () => {
      const config = {
        ethereum: {
          overrides: {
            alchemy: { priority: 2 },
          },
        },
      };
      expect(detectConfigSourceForBlockchain('alchemy', 'ethereum', config)).toBe('override');
    });

    it('should return default for blockchain without override even if other chains have it', () => {
      const config = {
        ethereum: {
          overrides: {
            alchemy: { priority: 2 },
          },
        },
      };
      expect(detectConfigSourceForBlockchain('alchemy', 'polygon', config)).toBe('default');
    });
  });

  describe('detectConfigSource', () => {
    it('should return default when no config', () => {
      expect(detectConfigSource('alchemy', ['ethereum'], undefined)).toBe('default');
    });

    it('should return default when no override for provider on any blockchain', () => {
      const config = {
        ethereum: {
          overrides: {
            etherscan: { priority: 1 },
          },
        },
      };
      expect(detectConfigSource('alchemy', ['ethereum'], config)).toBe('default');
    });

    it('should return override when provider has override on any blockchain', () => {
      const config = {
        ethereum: {
          overrides: {
            alchemy: { priority: 2 },
          },
        },
      };
      expect(detectConfigSource('alchemy', ['ethereum'], config)).toBe('override');
    });

    it('should check all blockchains and return override if any has it', () => {
      const config = {
        polygon: {
          overrides: {
            alchemy: { priority: 2 },
          },
        },
      };
      expect(detectConfigSource('alchemy', ['ethereum', 'polygon'], config)).toBe('override');
    });
  });

  describe('filterProviders', () => {
    const providers: ProviderViewItem[] = [
      makeViewItem({
        name: 'alchemy',
        healthStatus: 'healthy',
        requiresApiKey: true,
        apiKeyConfigured: true,
        blockchains: [
          { name: 'ethereum', capabilities: ['txs'], configSource: 'default' },
          { name: 'polygon', capabilities: ['txs'], configSource: 'default' },
        ],
      }),
      makeViewItem({
        name: 'etherscan',
        healthStatus: 'degraded',
        requiresApiKey: true,
        apiKeyConfigured: false,
        blockchains: [{ name: 'ethereum', capabilities: ['txs'], configSource: 'default' }],
      }),
      makeViewItem({
        name: 'blockstream',
        healthStatus: 'healthy',
        blockchains: [{ name: 'bitcoin', capabilities: ['txs'], configSource: 'default' }],
      }),
    ];

    it('should filter by blockchain', () => {
      const filtered = filterProviders(providers, { blockchain: 'ethereum' });
      expect(filtered).toHaveLength(2);
      expect(filtered.map((p) => p.name)).toEqual(['alchemy', 'etherscan']);
    });

    it('should filter by health - degraded includes unhealthy', () => {
      const providersWithUnhealthy: ProviderViewItem[] = [
        ...providers,
        makeViewItem({
          name: 'failing-provider',
          healthStatus: 'unhealthy',
          blockchains: [{ name: 'ethereum', capabilities: ['txs'], configSource: 'default' }],
        }),
      ];
      const filtered = filterProviders(providersWithUnhealthy, { health: 'degraded' });
      expect(filtered).toHaveLength(2);
      expect(filtered.map((p) => p.name).sort()).toEqual(['etherscan', 'failing-provider'].sort());
    });

    it('should filter by health - unhealthy exact match only', () => {
      const providersWithUnhealthy: ProviderViewItem[] = [
        ...providers,
        makeViewItem({
          name: 'failing-provider',
          healthStatus: 'unhealthy',
          blockchains: [{ name: 'ethereum', capabilities: ['txs'], configSource: 'default' }],
        }),
      ];
      const filtered = filterProviders(providersWithUnhealthy, { health: 'unhealthy' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.name).toBe('failing-provider');
    });

    it('should filter by missing API key', () => {
      const filtered = filterProviders(providers, { missingApiKey: true });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.name).toBe('etherscan');
    });

    it('should apply multiple filters', () => {
      const filtered = filterProviders(providers, { blockchain: 'ethereum', health: 'healthy' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.name).toBe('alchemy');
    });

    it('should return all when no filters', () => {
      const filtered = filterProviders(providers, {});
      expect(filtered).toHaveLength(3);
    });
  });

  describe('sortProviders', () => {
    it('should sort by total requests descending', () => {
      const providers: ProviderViewItem[] = [
        makeViewItem({ name: 'low', stats: { totalRequests: 10, avgResponseTime: 100, errorRate: 0, lastChecked: 0 } }),
        makeViewItem({
          name: 'high',
          stats: { totalRequests: 1000, avgResponseTime: 100, errorRate: 0, lastChecked: 0 },
        }),
        makeViewItem({
          name: 'mid',
          stats: { totalRequests: 500, avgResponseTime: 100, errorRate: 0, lastChecked: 0 },
        }),
      ];

      const sorted = sortProviders(providers);
      expect(sorted.map((p) => p.name)).toEqual(['high', 'mid', 'low']);
    });

    it('should put no-stats providers at bottom', () => {
      const providers: ProviderViewItem[] = [
        makeViewItem({ name: 'no-stats-a', healthStatus: 'no-stats' }),
        makeViewItem({
          name: 'with-stats',
          stats: { totalRequests: 100, avgResponseTime: 100, errorRate: 0, lastChecked: 0 },
        }),
        makeViewItem({ name: 'no-stats-b', healthStatus: 'no-stats' }),
      ];

      const sorted = sortProviders(providers);
      expect(sorted[0]!.name).toBe('with-stats');
      expect(sorted[1]!.name).toBe('no-stats-a');
      expect(sorted[2]!.name).toBe('no-stats-b');
    });

    it('should sort alphabetically when same request count', () => {
      const providers: ProviderViewItem[] = [
        makeViewItem({
          name: 'charlie',
          stats: { totalRequests: 100, avgResponseTime: 100, errorRate: 0, lastChecked: 0 },
        }),
        makeViewItem({
          name: 'alpha',
          stats: { totalRequests: 100, avgResponseTime: 100, errorRate: 0, lastChecked: 0 },
        }),
        makeViewItem({
          name: 'bravo',
          stats: { totalRequests: 100, avgResponseTime: 100, errorRate: 0, lastChecked: 0 },
        }),
      ];

      const sorted = sortProviders(providers);
      expect(sorted.map((p) => p.name)).toEqual(['alpha', 'bravo', 'charlie']);
    });

    it('should sort no-stats providers alphabetically', () => {
      const providers: ProviderViewItem[] = [
        makeViewItem({ name: 'zebra', healthStatus: 'no-stats' }),
        makeViewItem({ name: 'alpha', healthStatus: 'no-stats' }),
      ];

      const sorted = sortProviders(providers);
      expect(sorted.map((p) => p.name)).toEqual(['alpha', 'zebra']);
    });
  });

  describe('formatTimeAgo', () => {
    it('should return "just now" for recent timestamps', () => {
      expect(formatTimeAgo(Date.now())).toBe('just now');
      expect(formatTimeAgo(Date.now() - 30_000)).toBe('just now');
    });

    it('should return minutes for 1-59 minutes', () => {
      expect(formatTimeAgo(Date.now() - 60_000)).toBe('1 min ago');
      expect(formatTimeAgo(Date.now() - 5 * 60_000)).toBe('5 min ago');
      expect(formatTimeAgo(Date.now() - 59 * 60_000)).toBe('59 min ago');
    });

    it('should return hours for 1-23 hours', () => {
      expect(formatTimeAgo(Date.now() - 60 * 60_000)).toBe('1 hr ago');
      expect(formatTimeAgo(Date.now() - 3 * 60 * 60_000)).toBe('3 hrs ago');
    });

    it('should return days for 24+ hours', () => {
      expect(formatTimeAgo(Date.now() - 24 * 60 * 60_000)).toBe('1 day ago');
      expect(formatTimeAgo(Date.now() - 3 * 24 * 60 * 60_000)).toBe('3 days ago');
    });

    it('should return "just now" for future timestamps', () => {
      expect(formatTimeAgo(Date.now() + 60_000)).toBe('just now');
    });
  });

  describe('mergeProviderData', () => {
    it('should create view items from provider map and stats', () => {
      const providerMap = new Map([
        [
          'blockstream',
          [{ blockchain: 'bitcoin', providerInfo: makeProviderInfo({ name: 'blockstream', blockchain: 'bitcoin' }) }],
        ],
      ]);

      const statsRows: ProviderStatsRow[] = [
        makeStatsRow({
          blockchain: 'bitcoin',
          provider_name: 'blockstream',
          total_successes: 100,
          total_failures: 2,
          avg_response_time: 150,
        }),
      ];

      const items = mergeProviderData(providerMap, statsRows, undefined);

      expect(items).toHaveLength(1);
      expect(items[0]!.name).toBe('blockstream');
      expect(items[0]!.chainCount).toBe(1);
      expect(items[0]!.stats).toBeDefined();
      expect(items[0]!.stats!.totalRequests).toBe(102);
      expect(items[0]!.healthStatus).toBe('healthy');
    });

    it('should handle providers with no stats', () => {
      const providerMap = new Map([
        [
          'blockstream',
          [{ blockchain: 'bitcoin', providerInfo: makeProviderInfo({ name: 'blockstream', blockchain: 'bitcoin' }) }],
        ],
      ]);

      const items = mergeProviderData(providerMap, [], undefined);

      expect(items).toHaveLength(1);
      expect(items[0]!.stats).toBeUndefined();
      expect(items[0]!.healthStatus).toBe('no-stats');
    });

    it('should merge multi-chain provider into single item', () => {
      const providerMap = new Map([
        [
          'alchemy',
          [
            {
              blockchain: 'ethereum',
              providerInfo: makeProviderInfo({ name: 'alchemy', blockchain: 'ethereum', requiresApiKey: true }),
            },
            {
              blockchain: 'polygon',
              providerInfo: makeProviderInfo({ name: 'alchemy', blockchain: 'polygon', requiresApiKey: true }),
            },
          ],
        ],
      ]);

      const items = mergeProviderData(providerMap, [], undefined);

      expect(items).toHaveLength(1);
      expect(items[0]!.chainCount).toBe(2);
      expect(items[0]!.blockchains).toHaveLength(2);
    });

    it('should set per-blockchain configSource correctly for mixed overrides', () => {
      const providerMap = new Map([
        [
          'alchemy',
          [
            {
              blockchain: 'ethereum',
              providerInfo: makeProviderInfo({ name: 'alchemy', blockchain: 'ethereum' }),
            },
            {
              blockchain: 'polygon',
              providerInfo: makeProviderInfo({ name: 'alchemy', blockchain: 'polygon' }),
            },
            {
              blockchain: 'arbitrum',
              providerInfo: makeProviderInfo({ name: 'alchemy', blockchain: 'arbitrum' }),
            },
          ],
        ],
      ]);

      const config = {
        ethereum: {
          overrides: {
            alchemy: { priority: 2 },
          },
        },
        arbitrum: {
          overrides: {
            alchemy: { priority: 1 },
          },
        },
      };

      const items = mergeProviderData(providerMap, [], config);

      expect(items).toHaveLength(1);
      expect(items[0]!.blockchains).toHaveLength(3);

      // Find each blockchain and verify configSource
      const ethereum = items[0]!.blockchains.find((b) => b.name === 'ethereum');
      const polygon = items[0]!.blockchains.find((b) => b.name === 'polygon');
      const arbitrum = items[0]!.blockchains.find((b) => b.name === 'arbitrum');

      expect(ethereum?.configSource).toBe('override');
      expect(polygon?.configSource).toBe('default');
      expect(arbitrum?.configSource).toBe('override');

      // Provider-level configSource should be 'override' (any chain has override)
      expect(items[0]!.configSource).toBe('override');
    });
  });
});
