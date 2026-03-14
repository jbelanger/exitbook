import { describe, expect, it } from 'vitest';

import { createProviderRegistry } from '../../../../../initialize.js';
import { ThetaExplorerApiClient } from '../theta-explorer.api-client.js';

const providerRegistry = createProviderRegistry();

describe('ThetaExplorerApiClient Integration', () => {
  const config = providerRegistry.createDefaultConfig('theta', 'theta-explorer');
  const provider = new ThetaExplorerApiClient(config);
  // Theta Labs deployer address - known to have transactions

  describe('Health Checks', () => {
    it('should report healthy when API is accessible', async () => {
      const result = await provider.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    }, 30000);
  });
});
