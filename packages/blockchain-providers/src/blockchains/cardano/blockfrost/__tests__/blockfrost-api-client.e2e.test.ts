import { beforeAll, describe, expect, it } from 'vitest';

import { createProviderRegistry } from '../../../../initialize.js';
import { BlockfrostApiClient } from '../blockfrost-api-client.js';

const providerRegistry = createProviderRegistry();

describe('BlockfrostApiClient E2E', () => {
  let client: BlockfrostApiClient;

  // Set the API key and create client before tests run
  // To run these tests, you need a valid Blockfrost API key
  // Get one from https://blockfrost.io/ and set it in your .env file or here
  beforeAll(() => {
    // Use environment variable if set, otherwise use the provided key
    // Note: The provided key may be invalid/expired - replace with your own valid key
    if (!process.env['BLOCKFROST_API_KEY']) {
      process.env['BLOCKFROST_API_KEY'] = 'mainnetQwP2Nb7Y47Zn5Cl73a5V9okE2nvmyDoZ';
    }
    const config = providerRegistry.createDefaultConfig('cardano', 'blockfrost');
    client = new BlockfrostApiClient(config);
  });

  // Minswap DEX contract address - a well-known public address with many transactions
  const testAddress =
    'addr1z8snz7c4974vzdpxu65ruphl3zjdvtxw8strf2c2tmqnxz2j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq0xmsha';

  it('should connect to Blockfrost API and test health', async () => {
    const result = await client.isHealthy();
    if (result.isErr()) {
      console.error('Health check error:', result.error.message);
    }
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(true);
    }
  }, 60000);

  it('should fetch address balance', async () => {
    const result = await client.execute({
      address: testAddress,
      type: 'getAddressBalances',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const balanceData = result.value;

      // Verify structure
      expect(balanceData).toHaveProperty('rawAmount');
      expect(balanceData).toHaveProperty('decimalAmount');
      expect(balanceData).toHaveProperty('symbol');
      expect(balanceData).toHaveProperty('decimals');

      // Verify balance data
      expect(balanceData.symbol).toBe('ADA');
      expect(balanceData.decimals).toBe(6);

      // Verify rawAmount (lovelace) is a numeric string
      expect(typeof balanceData.rawAmount).toBe('string');
      if (balanceData.rawAmount) {
        const lovelace = parseFloat(balanceData.rawAmount);
        expect(lovelace).toBeGreaterThanOrEqual(0);
      }

      // Verify decimalAmount (ADA) is a numeric string
      expect(typeof balanceData.decimalAmount).toBe('string');
      if (balanceData.decimalAmount) {
        const ada = parseFloat(balanceData.decimalAmount);
        expect(ada).toBeGreaterThanOrEqual(0);

        // Verify conversion is correct: 1 ADA = 1,000,000 lovelace
        if (balanceData.rawAmount) {
          const lovelace = parseFloat(balanceData.rawAmount);
          const expectedAda = lovelace / 1000000;
          expect(Math.abs(ada - expectedAda)).toBeLessThan(0.000001); // Allow for floating point precision
        }
      }
    }
  }, 60000);

  it('should handle unsupported operations gracefully', async () => {
    const result = await client.execute({
      address: testAddress,
      type: 'nonExistent' as never,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Unsupported operation');
    }
  }, 60000);
});
