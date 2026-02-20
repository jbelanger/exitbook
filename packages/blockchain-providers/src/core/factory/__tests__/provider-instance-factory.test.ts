/**
 * Tests for ProviderInstanceFactory — config routing, override merging,
 * priority ordering, and preferred-provider validation.
 *
 * Uses a mocked ProviderRegistry to avoid requiring real API keys.
 */

import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';

import { ProviderRegistry } from '../../registry/provider-registry.js';
import type { IBlockchainProvider, ProviderInfo, ProviderMetadata } from '../../types/index.js';
import { ProviderInstanceFactory } from '../provider-instance-factory.js';

vi.mock('../registry/provider-registry.js', () => ({
  ProviderRegistry: {
    getAvailable: vi.fn(),
    getMetadata: vi.fn(),
    createProvider: vi.fn(),
  },
}));

const mockRegistry = ProviderRegistry as unknown as {
  createProvider: Mock;
  getAvailable: Mock;
  getMetadata: Mock;
};

function makeProviderInfo(name: string, blockchain = 'ethereum'): ProviderInfo {
  return {
    name,
    blockchain,
    displayName: name,
    requiresApiKey: false,
    capabilities: { supportedOperations: ['getAddressBalances', 'getAddressTransactions'] },
    defaultConfig: { rateLimit: { requestsPerSecond: 2 }, retries: 3, timeout: 10_000 },
  };
}

function makeMetadata(name: string, blockchain = 'ethereum'): ProviderMetadata {
  return {
    name,
    blockchain,
    displayName: name,
    baseUrl: `https://${name}.test`,
    requiresApiKey: false,
    capabilities: { supportedOperations: ['getAddressBalances', 'getAddressTransactions'] },
    defaultConfig: { rateLimit: { requestsPerSecond: 2 }, retries: 3, timeout: 10_000 },
  };
}

function makeMockProvider(name: string, blockchain = 'ethereum'): IBlockchainProvider {
  return { name, blockchain } as unknown as IBlockchainProvider;
}

describe('ProviderInstanceFactory — no config', () => {
  beforeEach(() => vi.clearAllMocks());

  test('uses registry when no explorerConfig is provided', () => {
    const factory = new ProviderInstanceFactory();

    mockRegistry.getAvailable.mockReturnValue([makeProviderInfo('moralis')]);
    mockRegistry.getMetadata.mockReturnValue(makeMetadata('moralis'));
    mockRegistry.createProvider.mockReturnValue(makeMockProvider('moralis'));

    const result = factory.createProvidersForBlockchain('ethereum');

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.name).toBe('moralis');
  });

  test('returns empty providers when no providers are registered', () => {
    const factory = new ProviderInstanceFactory();

    mockRegistry.getAvailable.mockReturnValue([]);

    const result = factory.createProvidersForBlockchain('ethereum');

    expect(result.providers).toHaveLength(0);
  });

  test('throws a descriptive error when preferred provider is not registered', () => {
    const factory = new ProviderInstanceFactory();

    mockRegistry.getAvailable.mockReturnValue([makeProviderInfo('moralis')]);

    expect(() => factory.createProvidersForBlockchain('ethereum', 'non-existent')).toThrow(/non-existent.*not found/);
  });

  test('sets preferredProviderName in the result', () => {
    const factory = new ProviderInstanceFactory();

    mockRegistry.getAvailable.mockReturnValue([makeProviderInfo('moralis')]);
    mockRegistry.getMetadata.mockReturnValue(makeMetadata('moralis'));
    mockRegistry.createProvider.mockReturnValue(makeMockProvider('moralis'));

    const result = factory.createProvidersForBlockchain('ethereum', 'moralis');

    expect(result.preferredProviderName).toBe('moralis');
  });
});

describe('ProviderInstanceFactory — override config', () => {
  beforeEach(() => vi.clearAllMocks());

  test('enables only providers listed in defaultEnabled', () => {
    const factory = new ProviderInstanceFactory({ ethereum: { defaultEnabled: ['routescan'], overrides: {} } });

    mockRegistry.getAvailable.mockReturnValue([makeProviderInfo('moralis'), makeProviderInfo('routescan')]);
    mockRegistry.getMetadata.mockImplementation((_: string, name: string) => makeMetadata(name));
    mockRegistry.createProvider.mockImplementation((_: string, name: string) => makeMockProvider(name));

    const result = factory.createProvidersForBlockchain('ethereum');

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.name).toBe('routescan');
  });

  test('skips providers disabled via override', () => {
    const factory = new ProviderInstanceFactory({
      ethereum: {
        defaultEnabled: ['moralis', 'routescan'],
        overrides: { moralis: { enabled: false } },
      },
    });

    mockRegistry.getAvailable.mockReturnValue([makeProviderInfo('moralis'), makeProviderInfo('routescan')]);
    mockRegistry.getMetadata.mockImplementation((_: string, name: string) => makeMetadata(name));
    mockRegistry.createProvider.mockImplementation((_: string, name: string) => makeMockProvider(name));

    const result = factory.createProvidersForBlockchain('ethereum');

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.name).toBe('routescan');
  });

  test('respects explicit priority ordering from overrides', () => {
    const factory = new ProviderInstanceFactory({
      ethereum: {
        defaultEnabled: ['moralis', 'routescan'],
        overrides: { moralis: { priority: 2 }, routescan: { priority: 1 } },
      },
    });

    mockRegistry.getAvailable.mockReturnValue([makeProviderInfo('moralis'), makeProviderInfo('routescan')]);
    mockRegistry.getMetadata.mockImplementation((_: string, name: string) => makeMetadata(name));
    mockRegistry.createProvider.mockImplementation((_: string, name: string) => makeMockProvider(name));

    const result = factory.createProvidersForBlockchain('ethereum');

    expect(result.providers[0]?.name).toBe('routescan'); // lower priority number = higher rank
    expect(result.providers[1]?.name).toBe('moralis');
  });

  test('uses all registered providers when defaultEnabled is omitted', () => {
    const factory = new ProviderInstanceFactory({ ethereum: { overrides: {} } });

    mockRegistry.getAvailable.mockReturnValue([makeProviderInfo('moralis'), makeProviderInfo('routescan')]);
    mockRegistry.getMetadata.mockImplementation((_: string, name: string) => makeMetadata(name));
    mockRegistry.createProvider.mockImplementation((_: string, name: string) => makeMockProvider(name));

    const result = factory.createProvidersForBlockchain('ethereum');

    expect(result.providers).toHaveLength(2);
  });

  test('falls back to registry when blockchain has no config entry', () => {
    const factory = new ProviderInstanceFactory({ bitcoin: { overrides: {} } });

    mockRegistry.getAvailable.mockReturnValue([makeProviderInfo('moralis')]);
    mockRegistry.getMetadata.mockReturnValue(makeMetadata('moralis'));
    mockRegistry.createProvider.mockReturnValue(makeMockProvider('moralis'));

    const result = factory.createProvidersForBlockchain('ethereum');

    expect(mockRegistry.getAvailable).toHaveBeenCalledWith('ethereum');
    expect(result.providers).toHaveLength(1);
  });

  test('warns and skips provider listed in defaultEnabled that is not registered', () => {
    const factory = new ProviderInstanceFactory({
      ethereum: { defaultEnabled: ['moralis', 'unknown-provider'], overrides: {} },
    });

    mockRegistry.getAvailable.mockReturnValue([makeProviderInfo('moralis')]);
    mockRegistry.getMetadata.mockReturnValue(makeMetadata('moralis'));
    mockRegistry.createProvider.mockReturnValue(makeMockProvider('moralis'));

    const result = factory.createProvidersForBlockchain('ethereum');

    // 'unknown-provider' is absent from registry, so only moralis is created
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.name).toBe('moralis');
  });
});

describe('ProviderInstanceFactory — setContext', () => {
  beforeEach(() => vi.clearAllMocks());

  test('instrumentation is forwarded to created provider config', () => {
    const factory = new ProviderInstanceFactory();
    const mockInstrumentation = {} as never;

    factory.setContext({ instrumentation: mockInstrumentation });

    mockRegistry.getAvailable.mockReturnValue([makeProviderInfo('moralis')]);
    mockRegistry.getMetadata.mockReturnValue(makeMetadata('moralis'));
    mockRegistry.createProvider.mockImplementation((_: string, _name: string, config: { instrumentation: unknown }) => {
      expect(config.instrumentation).toBe(mockInstrumentation);
      return makeMockProvider('moralis');
    });

    factory.createProvidersForBlockchain('ethereum');

    expect(mockRegistry.createProvider).toHaveBeenCalledOnce();
  });
});
