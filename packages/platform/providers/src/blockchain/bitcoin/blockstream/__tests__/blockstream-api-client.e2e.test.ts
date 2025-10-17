import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../core/blockchain/index.ts';
import type { AddressInfo } from '../../types.js';
import { BlockstreamApiClient } from '../blockstream-api-client.js';
import type { BlockstreamTransaction } from '../blockstream.types.js';

describe('BlockstreamApiClient E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('bitcoin', 'blockstream.info');
  const client = new BlockstreamApiClient(config);
  const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // Genesis block address

  it('should connect to Blockstream API and test health', async () => {
    const result = await client.isHealthy();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(true);
    }
  }, 60000);

  it('should get address info for known address', async () => {
    const result = await client.execute<AddressInfo>({
      address: testAddress,
      type: 'getAddressBalances',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const addressInfo = result.value;
      expect(addressInfo).toBeDefined();
      expect(addressInfo).toHaveProperty('balance');
      expect(addressInfo).toHaveProperty('txCount');
      expect(typeof addressInfo.balance).toBe('string');
      expect(typeof addressInfo.txCount).toBe('number');
      expect(addressInfo.txCount).toBeGreaterThan(0);
    }
  }, 60000);

  it('should get raw address transactions', async () => {
    const result = await client.execute<BlockstreamTransaction[]>({
      address: testAddress,
      type: 'getRawAddressTransactions',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const transactions = result.value;
      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        const tx = transactions[0]!;
        expect(tx).toBeDefined();
        expect(tx.txid).toBeDefined();
        expect(typeof tx.txid).toBe('string');
        expect(Array.isArray(tx.vin)).toBe(true);
        expect(Array.isArray(tx.vout)).toBe(true);
      }
    }
  }, 60000);
});
