import { describe, expect, it } from 'vitest';

import { createProviderRegistry } from '../../../initialize.js';
import { cosmosRestFactories } from '../providers/cosmos-rest/cosmos-rest.api-client.js';

describe('Cosmos provider registration', () => {
  const providerRegistry = createProviderRegistry();

  function providerNamesFor(blockchain: string): string[] {
    return providerRegistry.getAvailable(blockchain).map((provider) => provider.name);
  }

  it('routes Injective account history through the Injective explorer provider only', () => {
    expect(providerNamesFor('injective')).toEqual(['injective-explorer']);
    expect(cosmosRestFactories.some((factory) => factory.metadata.blockchain === 'injective')).toBe(false);
  });

  it('routes Akash account history through the Akash console provider only', () => {
    expect(providerNamesFor('akash')).toEqual(['akash-console']);
    expect(cosmosRestFactories.some((factory) => factory.metadata.blockchain === 'akash')).toBe(false);
  });

  it('keeps Fetch on generic Cosmos REST because that endpoint has usable indexed history', () => {
    expect(providerNamesFor('fetch')).toEqual(['cosmos-rest']);
    expect(cosmosRestFactories.some((factory) => factory.metadata.blockchain === 'fetch')).toBe(true);
  });
});
