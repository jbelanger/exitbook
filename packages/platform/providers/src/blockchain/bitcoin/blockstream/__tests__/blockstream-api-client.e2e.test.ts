import type { BlockchainBalanceSnapshot } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { TransactionWithRawData } from '../../../../core/blockchain/index.ts';
import { ProviderRegistry } from '../../../../core/blockchain/index.ts';
import type { BitcoinTransaction } from '../../types.js';
import { BlockstreamApiClient } from '../blockstream-api-client.js';

describe('BlockstreamApiClient E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('bitcoin', 'blockstream.info');
  const client = new BlockstreamApiClient(config);
  const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // Genesis block address
  const emptyAddress = 'bc1qeppvcnauqak9xn7mmekw4crr79tl9c8lnxpp2k'; // Address with no transactions

  it('should connect to Blockstream API and test health', async () => {
    const result = await client.isHealthy();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(true);
    }
  }, 60000);

  it('should get address balance for known address', async () => {
    const result = await client.execute<BlockchainBalanceSnapshot>({
      address: testAddress,
      type: 'getAddressBalances',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const balance = result.value;
      expect(balance).toBeDefined();
      expect(balance).toHaveProperty('total');
      expect(typeof balance.total).toBe('string');
      const totalNum = parseFloat(balance.total);
      expect(totalNum).toBeGreaterThan(0);
    }
  }, 60000);

  it('should get normalized address transactions', async () => {
    const result = await client.execute<TransactionWithRawData<BitcoinTransaction>[]>({
      address: testAddress,
      type: 'getAddressTransactions',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const transactions = result.value;
      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        const txWithRaw = transactions[0]!;
        expect(txWithRaw).toHaveProperty('raw');
        expect(txWithRaw).toHaveProperty('normalized');

        expect(txWithRaw.raw).toHaveProperty('txid');
        expect(txWithRaw.raw).toHaveProperty('vin');
        expect(txWithRaw.raw).toHaveProperty('vout');

        const tx = txWithRaw.normalized;
        expect(tx).toBeDefined();
        expect(tx.id).toBeDefined();
        expect(typeof tx.id).toBe('string');
        expect(tx.currency).toBe('BTC');
        expect(tx.providerId).toBe('blockstream.info');
        expect(Array.isArray(tx.inputs)).toBe(true);
        expect(Array.isArray(tx.outputs)).toBe(true);
      }
    }
  }, 60000);

  it('should return true for address with transactions', async () => {
    const result = await client.execute<boolean>({
      address: testAddress,
      type: 'hasAddressTransactions',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(true);
    }
  }, 60000);

  it('should return false for address without transactions', async () => {
    const result = await client.execute<boolean>({
      address: emptyAddress,
      type: 'hasAddressTransactions',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(false);
    }
  }, 60000);
});
