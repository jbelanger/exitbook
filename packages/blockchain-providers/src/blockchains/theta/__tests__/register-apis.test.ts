import { describe, expect, it } from 'vitest';

import { createProviderRegistry } from '../../../initialize.js';
import { thetaProviderFactories } from '../register-apis.js';

describe('theta/register-apis', () => {
  it('exposes Theta-only provider factories', () => {
    expect(thetaProviderFactories.map((factory) => factory.metadata.name).sort()).toEqual([
      'theta-explorer',
      'thetascan',
    ]);
    expect(thetaProviderFactories.every((factory) => factory.metadata.blockchain === 'theta')).toBe(true);
  });

  it('registers Theta providers through the shared registry bootstrap', () => {
    const providerRegistry = createProviderRegistry();

    expect(providerRegistry.isRegistered('theta', 'theta-explorer')).toBe(true);
    expect(providerRegistry.isRegistered('theta', 'thetascan')).toBe(true);
    expect(
      providerRegistry
        .getAvailable('theta')
        .map((provider) => provider.name)
        .sort()
    ).toEqual(['theta-explorer', 'thetascan']);
  });
});
