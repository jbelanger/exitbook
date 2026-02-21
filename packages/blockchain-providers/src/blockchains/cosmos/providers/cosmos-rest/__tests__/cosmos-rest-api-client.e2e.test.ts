import { describe, expect, it } from 'vitest';

import type { TransactionWithRawData } from '../../../../../core/types/index.js';
import { createProviderRegistry } from '../../../../../initialize.js';
import type { CosmosTransaction } from '../../../types.js';
import { CosmosRestApiClient } from '../cosmos-rest.api-client.js';
import type { CosmosTxResponse } from '../cosmos-rest.schemas.js';

const providerRegistry = createProviderRegistry();

describe('CosmosRestApiClient Integration - Fetch.ai', () => {
  const config = {
    ...providerRegistry.createDefaultConfig('fetch', 'cosmos-rest'),
    chainName: 'fetch',
  };
  const provider = new CosmosRestApiClient(config);

  // Valid Fetch.ai address for testing
  const testAddress = 'fetch1asagzdynnr5h6c7sq3qgn4azjmsewt0lar6dfe';

  describe('Health Checks', () => {
    it('should report healthy when API is accessible', async () => {
      const result = await provider.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    }, 30000);
  });

  describe('Address Balance', () => {
    it('should fetch address balance successfully', async () => {
      const result = await provider.execute({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }

      const balance = result.value;
      expect(balance).toBeDefined();
      expect(balance.symbol).toBe('FET');
      expect(balance.decimals).toBe(18);
      expect(balance.rawAmount || balance.decimalAmount).toBeDefined();

      // Balance should be a valid decimal number
      if (balance.decimalAmount) {
        const numericValue = parseFloat(balance.decimalAmount);
        expect(numericValue).not.toBeNaN();
        expect(numericValue).toBeGreaterThanOrEqual(0);
      }
    }, 30000);

    it('should handle address with zero or minimal balance', async () => {
      // Another valid address for testing
      const minimalAddress = 'fetch1aatyrgyv0dcjna072fdaadsx6sennxlws3gp4w';
      const result = await provider.execute({
        address: minimalAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }

      const balance = result.value;
      expect(balance).toBeDefined();
      expect(balance.symbol).toBe('FET');
      expect(balance.decimals).toBe(18);
      if (balance.decimalAmount) {
        expect(parseFloat(balance.decimalAmount)).toBeGreaterThanOrEqual(0);
      }
    }, 30000);
  });

  describe('Address Transactions Streaming', () => {
    it('should stream address transactions successfully with normalization', async () => {
      const transactions: TransactionWithRawData<CosmosTransaction>[] = [];
      let batchCount = 0;
      const MAX_BATCHES = 2; // Limit to first 2 batches for testing

      for await (const batchResult of provider.executeStreaming<CosmosTransaction>({
        address: testAddress,
        type: 'getAddressTransactions',
      })) {
        expect(batchResult.isOk()).toBe(true);
        if (batchResult.isErr()) {
          throw batchResult.error;
        }

        const batch = batchResult.value;
        transactions.push(...batch.data);

        batchCount++;
        if (batchCount >= MAX_BATCHES) {
          break;
        }
      }

      expect(transactions.length).toBeGreaterThan(0);

      if (transactions.length > 0) {
        const firstTx = transactions[0]!;

        expect(firstTx).toHaveProperty('raw');
        expect(firstTx).toHaveProperty('normalized');

        const rawData = firstTx.raw as CosmosTxResponse;

        expect(rawData).toHaveProperty('txhash');
        expect(rawData).toHaveProperty('height');
        expect(rawData).toHaveProperty('timestamp');
        expect(rawData).toHaveProperty('tx');

        const normalized = firstTx.normalized;
        expect(normalized).toHaveProperty('id');
        expect(normalized).toHaveProperty('timestamp');
        expect(normalized).toHaveProperty('status');
        expect(normalized).toHaveProperty('providerName');
        expect(normalized).toHaveProperty('from');
        expect(normalized).toHaveProperty('to');
        expect(normalized).toHaveProperty('amount');
        expect(normalized).toHaveProperty('currency');

        expect(normalized.providerName).toBe('cosmos-rest');
        expect(['success', 'failed', 'pending']).toContain(normalized.status);
        expect(typeof normalized.timestamp).toBe('number');
        expect(normalized.timestamp).toBeGreaterThan(0);

        // Verify addresses are properly formatted (lowercase Bech32)
        expect(normalized.from).toMatch(/^fetch1[a-z0-9]{38}$/);
        expect(normalized.to).toMatch(/^fetch1[a-z0-9]{38}$/);

        // Verify amount is a valid decimal string
        const amount = parseFloat(normalized.amount);
        expect(amount).not.toBeNaN();
        expect(amount).toBeGreaterThanOrEqual(0);

        // Verify currency is set
        expect(normalized.currency).toBeTruthy();
        expect(typeof normalized.currency).toBe('string');
      }
    }, 60000);
  });
});

describe('CosmosRestApiClient Integration - Osmosis', () => {
  const config = {
    ...providerRegistry.createDefaultConfig('osmosis', 'cosmos-rest'),
    chainName: 'osmosis',
  };
  const provider = new CosmosRestApiClient(config);

  // Osmosis test address
  const testAddress = 'osmo1tctqykwxyypr475mdnd83kc643tyca63rxdfl9';

  describe('Health Checks', () => {
    it('should report healthy when API is accessible', async () => {
      const result = await provider.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    }, 30000);
  });

  describe('Address Balance', () => {
    it('should fetch address balance successfully', async () => {
      const result = await provider.execute({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }

      const balance = result.value;
      expect(balance).toBeDefined();
      expect(balance.symbol).toBe('OSMO');
      expect(balance.decimals).toBe(6);
      expect(balance.rawAmount || balance.decimalAmount).toBeDefined();

      if (balance.decimalAmount) {
        const numericValue = parseFloat(balance.decimalAmount);
        expect(numericValue).not.toBeNaN();
        expect(numericValue).toBeGreaterThanOrEqual(0);
      }
    }, 30000);
  });
});
