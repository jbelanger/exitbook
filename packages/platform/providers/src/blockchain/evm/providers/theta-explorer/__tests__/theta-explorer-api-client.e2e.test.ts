import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../shared/blockchain/index.js';
import type { TransactionWithRawData } from '../../../../../shared/blockchain/types/index.js';
import type { EvmTransaction } from '../../../types.js';
import { ThetaExplorerApiClient } from '../theta-explorer.api-client.js';

describe('ThetaExplorerApiClient Integration', () => {
  const config = ProviderRegistry.createDefaultConfig('theta', 'theta-explorer');
  const provider = new ThetaExplorerApiClient(config);
  // Theta Labs deployer address - known to have transactions
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
          expect(firstTx.normalized).toHaveProperty('blockHeight');
          expect(firstTx.normalized).toHaveProperty('timestamp');
          expect(firstTx.normalized.providerName).toBe('theta-explorer');
        }
      }
    }, 30000);

    it('should fetch both send and smart contract transactions', async () => {
      const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        expect(Array.isArray(transactions)).toBe(true);

        if (transactions.length > 0) {
          // Should have valid transaction types
          const firstTx = transactions[0]!;
          expect(firstTx.normalized.type).toBeDefined();
          expect(['transfer', 'token_transfer', 'contract_call']).toContain(firstTx.normalized.type);
        }
      }
    }, 30000);

    it('should return transactions with valid structure', async () => {
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

          expect(firstTx.normalized.id).toMatch(/^0x[a-fA-F0-9]+$/);
          expect(firstTx.normalized.blockHeight).toBeGreaterThan(0);
          expect(firstTx.normalized.providerName).toBe('theta-explorer');
        }
      }
    }, 30000);
  });

  describe('Transaction Types', () => {
    it('should handle send transactions', async () => {
      const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        const sendTx = transactions.find((tx) => tx.normalized.type === 'transfer');
        if (sendTx) {
          expect(sendTx.normalized).toHaveProperty('from');
          expect(sendTx.normalized).toHaveProperty('to');
          expect(sendTx.normalized).toHaveProperty('amount');
        }
      }
    }, 30000);

    it('should handle smart contract transactions', async () => {
      const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        const contractTx = transactions.find((tx) => tx.normalized.type === 'contract_call');
        if (contractTx) {
          expect(contractTx.normalized).toHaveProperty('from');
          expect(contractTx.normalized).toHaveProperty('to');
        }
      }
    }, 30000);
  });
});
