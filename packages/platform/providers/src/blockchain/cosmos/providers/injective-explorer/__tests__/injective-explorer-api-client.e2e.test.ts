import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../shared/blockchain/index.js';
import type { RawBalanceData, TransactionWithRawData } from '../../../../../shared/blockchain/types/index.js';
import type { CosmosTransaction } from '../../../types.js';
import { InjectiveExplorerApiClient } from '../injective-explorer.api-client.js';
import type { InjectiveTransaction } from '../injective-explorer.schemas.js';

describe('InjectiveExplorerApiClient Integration', () => {
  const config = ProviderRegistry.createDefaultConfig('injective', 'injective-explorer');
  const provider = new InjectiveExplorerApiClient(config);
  // Test address with some activity (from the user's test)
  const testAddress = 'inj1zk3259rhsxcg5qg96eursm4x8ek2qc5pty4rau';

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
      expect(balance.symbol).toBe('INJ');
      expect(balance.decimals).toBe(18);
      expect(balance.rawAmount || balance.decimalAmount).toBeDefined();

      // Balance should be a valid decimal number
      if (balance.decimalAmount) {
        const numericValue = parseFloat(balance.decimalAmount);
        expect(numericValue).not.toBeNaN();
        expect(numericValue).toBeGreaterThanOrEqual(0);
      }
    }, 30000);

    it('should handle address with minimal or zero balance', async () => {
      // Use a different address that might have minimal balance
      const minimalAddress = 'inj1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqe2hm49';
      const result = await provider.execute<RawBalanceData>({
        address: minimalAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }

      const balance = result.value;
      expect(balance).toBeDefined();
      expect(balance.symbol).toBe('INJ');
      expect(balance.decimals).toBe(18);
      if (balance.decimalAmount) {
        expect(parseFloat(balance.decimalAmount)).toBeGreaterThanOrEqual(0);
      }
    }, 30000);
  });

  describe('Address Transactions', () => {
    it('should fetch address transactions successfully with normalization', async () => {
      const result = await provider.execute<TransactionWithRawData<CosmosTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }

      const transactions = result.value;
      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        const firstTx = transactions[0]!;

        expect(firstTx).toHaveProperty('raw');
        expect(firstTx).toHaveProperty('normalized');

        const rawData = firstTx.raw as InjectiveTransaction;

        expect(rawData).toHaveProperty('hash');
        expect(rawData).toHaveProperty('messages');
        expect(rawData).toHaveProperty('block_number');
        expect(rawData).toHaveProperty('block_timestamp');
        expect(rawData).toHaveProperty('gas_fee');
        expect(rawData).toHaveProperty('gas_used');
        expect(rawData).toHaveProperty('code');

        expect(Array.isArray(rawData.messages)).toBe(true);
        expect(rawData.messages.length).toBeGreaterThan(0);

        const normalized = firstTx.normalized;
        expect(normalized).toHaveProperty('id');
        expect(normalized).toHaveProperty('timestamp');
        expect(normalized).toHaveProperty('status');
        expect(normalized).toHaveProperty('providerName');
        expect(normalized).toHaveProperty('feeAmount');
        expect(normalized).toHaveProperty('feeCurrency');

        expect(normalized.providerName).toBe('injective-explorer');
        expect(['success', 'failed']).toContain(normalized.status);
        expect(normalized.feeCurrency).toBe('INJ');
        expect(typeof normalized.timestamp).toBe('number');
      }
    }, 30000);
  });
});
