import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../shared/index.ts';
import type { AddressInfo } from '../../types.js';
import { BlockchainComApiClient } from '../blockchain-com.api-client.js';
import type { BlockchainComTransaction } from '../blockchain-com.types.js';

describe('BlockchainComApiClient E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('bitcoin', 'blockchain.com');
  const client = new BlockchainComApiClient(config);

  it('should connect to Blockchain.com API and test health', async () => {
    const result = await client.isHealthy();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(true);
    }
  }, 30000);

  it('should get address info for known address', async () => {
    const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // Genesis block address

    const addressInfo = await client.execute<AddressInfo>({
      address: testAddress,
      type: 'getAddressInfo',
    });

    expect(addressInfo).toBeDefined();
    expect(addressInfo).toHaveProperty('balance');
    expect(addressInfo).toHaveProperty('txCount');
    expect(typeof addressInfo.balance).toBe('string');
    expect(typeof addressInfo.txCount).toBe('number');
    expect(addressInfo.txCount).toBeGreaterThan(0);
  }, 30000);

  it('should get raw address transactions', async () => {
    const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

    const transactions = await client.execute<BlockchainComTransaction[]>({
      address: testAddress,
      type: 'getRawAddressTransactions',
    });

    expect(Array.isArray(transactions)).toBe(true);
    if (transactions.length > 0) {
      const tx = transactions[0]!;
      expect(tx).toBeDefined();
      expect(tx.hash).toBeDefined();
      expect(typeof tx.hash).toBe('string');
      expect(Array.isArray(tx.inputs)).toBe(true);
      expect(Array.isArray(tx.out)).toBe(true);
    }
  }, 30000);

  it('should handle empty address gracefully', async () => {
    const emptyAddress = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';

    const addressInfo = await client.execute<AddressInfo>({
      address: emptyAddress,
      type: 'getAddressInfo',
    });

    expect(addressInfo).toBeDefined();
    expect(addressInfo).toHaveProperty('balance');
    expect(addressInfo).toHaveProperty('txCount');
  }, 30000);
});
