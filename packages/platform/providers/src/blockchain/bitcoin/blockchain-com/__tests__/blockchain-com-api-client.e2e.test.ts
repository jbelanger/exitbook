import { describe, expect, it } from 'vitest';

import type { TransactionWithRawData } from '../../../../core/blockchain/index.ts';
import { ProviderRegistry } from '../../../../core/blockchain/index.ts';
import type { AddressInfo, BitcoinTransaction } from '../../types.js';
import { BlockchainComApiClient } from '../blockchain-com.api-client.js';

describe.skip('BlockchainComApiClient E2E', () => {
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
  }, 30000);

  it('should get normalized address transactions', async () => {
    const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

    const result = await client.execute<TransactionWithRawData<BitcoinTransaction>[]>({
      address: testAddress,
      type: 'getRawAddressTransactions',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const transactions = result.value;
      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        const txWithRaw = transactions[0]!;
        expect(txWithRaw).toHaveProperty('raw');
        expect(txWithRaw).toHaveProperty('normalized');

        expect(txWithRaw.raw).toHaveProperty('hash');
        expect(txWithRaw.raw).toHaveProperty('inputs');
        expect(txWithRaw.raw).toHaveProperty('out');

        const tx = txWithRaw.normalized;
        expect(tx).toBeDefined();
        expect(tx.id).toBeDefined();
        expect(typeof tx.id).toBe('string');
        expect(tx.currency).toBe('BTC');
        expect(tx.providerId).toBe('blockchain.com');
        expect(Array.isArray(tx.inputs)).toBe(true);
        expect(Array.isArray(tx.outputs)).toBe(true);
      }
    }
  }, 30000);

  it('should handle empty address gracefully', async () => {
    const emptyAddress = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';

    const result = await client.execute<AddressInfo>({
      address: emptyAddress,
      type: 'getAddressBalances',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const addressInfo = result.value;
      expect(addressInfo).toBeDefined();
      expect(addressInfo).toHaveProperty('balance');
      expect(addressInfo).toHaveProperty('txCount');
    }
  }, 30000);
});
