import { describe, expect, it } from 'vitest';

import type { RawBalanceData } from '../../../../../core/index.js';
import { createProviderRegistry } from '../../../../../initialize.js';
import { BlockchainComApiClient } from '../blockchain-com.api-client.js';

const providerRegistry = createProviderRegistry();

describe.skip('BlockchainComApiClient E2E', () => {
  const config = providerRegistry.createDefaultConfig('bitcoin', 'blockchain.com');
  const client = new BlockchainComApiClient(config);
  const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // Genesis block address
  const emptyAddress = 'bc1qeppvcnauqak9xn7mmekw4crr79tl9c8lnxpp2k'; // Address with no transactions

  it('should connect to Blockchain.com API and test health', async () => {
    const result = await client.isHealthy();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(true);
    }
  }, 30000);

  it('should get address balance for known address', async () => {
    const result = await client.execute<RawBalanceData>({
      address: testAddress,
      type: 'getAddressBalances',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const balance = result.value;
      expect(balance).toBeDefined();
      expect(balance.symbol).toBe('BTC');
      expect(balance.decimals).toBe(8);
      expect(balance.rawAmount || balance.decimalAmount).toBeDefined();
      if (balance.decimalAmount) {
        expect(parseFloat(balance.decimalAmount)).toBeGreaterThan(0);
      }
    }
  }, 30000);

  it('should handle empty address gracefully', async () => {
    const result = await client.execute<RawBalanceData>({
      address: emptyAddress,
      type: 'getAddressBalances',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const balance = result.value;
      expect(balance).toBeDefined();
      expect(balance.symbol).toBe('BTC');
      expect(balance.decimals).toBe(8);
      expect(balance.rawAmount || balance.decimalAmount).toBeDefined();
    }
  }, 30000);

  it('should return true for address with transactions', async () => {
    const result = await client.execute<boolean>({
      address: testAddress,
      type: 'hasAddressTransactions',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(true);
    }
  }, 30000);

  it('should return false for address without transactions', async () => {
    const result = await client.execute<boolean>({
      address: emptyAddress,
      type: 'hasAddressTransactions',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(false);
    }
  }, 30000);
});
