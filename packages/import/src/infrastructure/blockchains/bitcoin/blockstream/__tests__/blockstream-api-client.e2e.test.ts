import { describe, expect, it } from 'vitest';

import type { AddressInfo } from '../../types.js';
import { BlockstreamApiClient } from '../blockstream-api-client.js';
import type { BlockstreamTransaction } from '../blockstream.types.js';

describe('BlockstreamApiClient E2E', () => {
  // Reuse same client across tests to share rate limiter
  const client = new BlockstreamApiClient();

  it('should connect to Blockstream API and test health', async () => {
    const isHealthy = await client.isHealthy();
    expect(isHealthy).toBe(true);
  }, 60000);

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
  }, 60000);

  it('should get raw address transactions', async () => {
    const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

    const transactions = await client.execute<BlockstreamTransaction[]>({
      address: testAddress,
      type: 'getRawAddressTransactions',
    });

    expect(Array.isArray(transactions)).toBe(true);
    if (transactions.length > 0) {
      const tx = transactions[0]!;
      expect(tx).toBeDefined();
      expect(tx.txid).toBeDefined();
      expect(typeof tx.txid).toBe('string');
      expect(Array.isArray(tx.vin)).toBe(true);
      expect(Array.isArray(tx.vout)).toBe(true);
    }
  }, 60000);

  it('should handle empty address gracefully', async () => {
    const emptyAddress = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

    const addressInfo = await client.execute<AddressInfo>({
      address: emptyAddress,
      type: 'getAddressInfo',
    });

    expect(addressInfo).toBeDefined();
    expect(addressInfo).toHaveProperty('balance');
    expect(addressInfo).toHaveProperty('txCount');
  }, 60000);

  it('should filter transactions by timestamp', async () => {
    const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
    const futureTimestamp = Date.now() + 86400000; // 24 hours from now

    const transactions = await client.execute<BlockstreamTransaction[]>({
      address: testAddress,
      since: futureTimestamp,
      type: 'getRawAddressTransactions',
    });

    expect(Array.isArray(transactions)).toBe(true);
    expect(transactions).toHaveLength(0);
  }, 60000);

  it('should handle rate limiting', async () => {
    const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

    const promises = Array.from({ length: 3 }, () =>
      client.execute<AddressInfo>({
        address: testAddress,
        type: 'getAddressInfo',
      })
    );

    const results = await Promise.all(promises);

    expect(results.length).toBe(3);
    results.forEach((result) => {
      expect(result).toBeDefined();
      expect(result).toHaveProperty('balance');
      expect(result).toHaveProperty('txCount');
    });
  }, 90000);
});
