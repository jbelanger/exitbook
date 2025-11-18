import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { RawBalanceData, StreamingBatchResult, TransactionWithRawData } from '../../../../../core/types/index.js';
import type { EvmTransaction } from '../../../types.js';
import { ThetaScanApiClient } from '../thetascan.api-client.js';

describe('ThetaScanApiClient Integration', () => {
  const config = ProviderRegistry.createDefaultConfig('theta', 'thetascan');
  const provider = new ThetaScanApiClient(config);
  // Example Theta address - you can replace with a known address
  const testAddress = '0x2E833968E5bB786Ae419c4d13189fB081Cc43bab';

  describe('Health Checks', () => {
    it('should report healthy when API is accessible', async () => {
      const result = await provider.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    }, 30000);
  });

  describe('Raw Address Transactions', () => {
    it('should fetch raw address transactions successfully', async () => {
      const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        expect(Array.isArray(transactions)).toBe(true);
        if (transactions.length > 0) {
          const firstTx = transactions[0]!;
          expect(firstTx).toHaveProperty('raw');
          expect(firstTx).toHaveProperty('normalized');
          expect(firstTx.normalized).toHaveProperty('id');
          expect(firstTx.normalized).toHaveProperty('from');
          expect(firstTx.normalized).toHaveProperty('to');
          expect(firstTx.normalized).toHaveProperty('blockHeight');
          expect(firstTx.normalized).toHaveProperty('timestamp');
          expect(firstTx.normalized.providerName).toBe('thetascan');
        }
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
      if (result.isOk()) {
        const balance = result.value;
        expect(balance).toBeDefined();
        expect(balance.symbol).toBe('TFUEL');
        expect(balance.decimals).toBe(18);
        expect(balance.rawAmount || balance.decimalAmount).toBeDefined();
      }
    }, 30000);
  });

  describe('Token Balances', () => {
    it('should return empty array when no contract addresses provided', async () => {
      const result = await provider.execute<RawBalanceData[]>({
        address: testAddress,
        type: 'getAddressTokenBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        expect(Array.isArray(balances)).toBe(true);
        expect(balances.length).toBe(0);
      }
    }, 30000);

    it('should handle token balances with symbols from contract metadata', async () => {
      // Example Theta token contract - replace with actual contract if known
      const contractAddresses = ['0x4dc08b15ea0e10b96c41aec22fab934ba15c983e'];

      const result = await provider.execute<RawBalanceData[]>({
        address: testAddress,
        contractAddresses,
        type: 'getAddressTokenBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        expect(Array.isArray(balances)).toBe(true);
        // May or may not have balances depending on the address
        if (balances.length > 0 && balances[0]) {
          expect(balances[0]).toHaveProperty('symbol');
          expect(balances[0]).toHaveProperty('contractAddress');
          expect(balances[0].rawAmount || balances[0].decimalAmount).toBeDefined();
          // Symbol may be undefined for some tokens
          if (balances[0].symbol) {
            expect(balances[0].symbol.length).toBeGreaterThan(0);
          }
        }
      }
    }, 30000);
  });

  describe('Address Validation', () => {
    it('should reject invalid Theta addresses', async () => {
      const invalidAddress = 'invalid-address';

      const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
        address: invalidAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid Theta address');
      }
    });

    it('should accept valid Ethereum-style addresses', async () => {
      const validAddress = '0x0000000000000000000000000000000000000000';

      // Should not throw
      const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
        address: validAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        expect(Array.isArray(transactions)).toBe(true);
      }
    }, 30000);
  });

  describe('Streaming Transactions', () => {
    it('should stream address transactions successfully', async () => {
      const batches: StreamingBatchResult<EvmTransaction>[] = [];

      for await (const result of provider.executeStreaming<EvmTransaction>({
        address: testAddress,
        type: 'getAddressTransactions',
      })) {
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          batches.push(result.value);
        }
      }

      // ThetaScan should return at least one batch (even if empty)
      expect(batches.length).toBeGreaterThan(0);

      // Verify structure of batches
      for (const batch of batches) {
        expect(batch).toHaveProperty('data');
        expect(batch).toHaveProperty('cursor');
        expect(Array.isArray(batch.data)).toBe(true);

        // Verify each transaction has the expected structure
        for (const tx of batch.data) {
          expect(tx).toHaveProperty('raw');
          expect(tx).toHaveProperty('normalized');
          expect(tx.normalized).toHaveProperty('id');
          expect(tx.normalized).toHaveProperty('from');
          expect(tx.normalized).toHaveProperty('to');
          expect(tx.normalized).toHaveProperty('blockHeight');
          expect(tx.normalized).toHaveProperty('timestamp');
          expect(tx.normalized.providerName).toBe('thetascan');
        }
      }

      // The final batch should be marked as complete
      const lastBatch = batches[batches.length - 1];
      expect(lastBatch?.cursor.metadata?.isComplete).toBe(true);
    }, 30000);

    it('should handle resuming from cursor (single-batch provider)', async () => {
      const batches: StreamingBatchResult<EvmTransaction>[] = [];

      // First, fetch all transactions
      for await (const result of provider.executeStreaming<EvmTransaction>({
        address: testAddress,
        type: 'getAddressTransactions',
      })) {
        if (result.isOk()) {
          batches.push(result.value);
        }
      }

      // For ThetaScan (single-batch provider), resuming should yield no new data
      if (batches.length > 0 && batches[0]) {
        const cursor = batches[0].cursor;
        const resumedBatches: StreamingBatchResult<EvmTransaction>[] = [];

        for await (const result of provider.executeStreaming<EvmTransaction>(
          {
            address: testAddress,
            type: 'getAddressTransactions',
          },
          cursor
        )) {
          if (result.isOk()) {
            resumedBatches.push(result.value);
          }
        }

        // Should still complete successfully (may return empty or same data)
        expect(resumedBatches.length).toBeGreaterThan(0);
      }
    }, 30000);
  });
});
