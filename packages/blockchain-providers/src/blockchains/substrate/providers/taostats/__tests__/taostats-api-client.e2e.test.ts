import { beforeAll, describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { RawBalanceData } from '../../../../../core/types/index.js';
import { TaostatsApiClient } from '../taostats.api-client.js';

describe('TaostatsApiClient Integration - Bittensor', () => {
  describe('Bittensor', () => {
    const config = ProviderRegistry.createDefaultConfig('bittensor', 'taostats');
    const provider = new TaostatsApiClient(config);
    // Test address with minimal transaction history to avoid rate limits
    const testAddress = '5HEo565WAy4Dbq3Sv271SAi7syBSofyfhhwRNjFNSM2gP9M2';

    beforeAll(() => {
      if (!process.env['TAOSTATS_API_KEY']) {
        console.warn('⚠️  TAOSTATS_API_KEY not set - tests may fail. Add to apps/cli/.env');
      }
    });

    describe('Health Checks', () => {
      it('should check API health', async () => {
        const result = await provider.isHealthy();
        // Health check endpoint may not exist, but we expect a result (ok or err)
        expect(result.isOk()).toBe(true);
      }, 30000);
    });

    describe('Address Balance', () => {
      it('should fetch address balance successfully', async () => {
        const result = await provider.execute<RawBalanceData>({
          address: testAddress,
          type: 'getAddressBalances',
        });

        expect(result.isOk()).toBe(true);
        if (result.isErr()) {
          throw result.error;
        }

        const balance = result.value;
        expect(balance).toBeDefined();
        expect(balance.symbol).toBe('TAO');
        expect(balance.decimals).toBe(9);
        expect(balance.rawAmount || balance.decimalAmount).toBeDefined();

        // Balance should be valid
        if (balance.decimalAmount) {
          const totalNum = parseFloat(balance.decimalAmount);
          expect(totalNum).not.toBeNaN();
          expect(totalNum).toBeGreaterThan(0);
        }
      }, 30000);
    });
  });
});
