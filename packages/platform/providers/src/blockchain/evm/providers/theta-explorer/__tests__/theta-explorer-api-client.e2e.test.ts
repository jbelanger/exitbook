import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/blockchain/index.ts';
import { ThetaExplorerApiClient } from '../theta-explorer.api-client.ts';
import type { ThetaTransaction } from '../theta-explorer.types.ts';

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
      const result = await provider.execute<ThetaTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        expect(Array.isArray(transactions)).toBe(true);
        if (transactions.length > 0) {
          expect(transactions[0]).toHaveProperty('hash');
          expect(transactions[0]).toHaveProperty('block_height');
          expect(transactions[0]).toHaveProperty('timestamp');
          expect(transactions[0]).toHaveProperty('type');
          expect(transactions[0]).toHaveProperty('data');
        }
      }
    }, 30000);

    it('should fetch both send and smart contract transactions', async () => {
      const result = await provider.execute<ThetaTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        expect(Array.isArray(transactions)).toBe(true);

        if (transactions.length > 0) {
          // Should contain type 2 (send) or type 7 (smart contract) transactions
          const hasValidTypes = transactions.some((tx) => tx.type === 2 || tx.type === 7);
          expect(hasValidTypes).toBe(true);
        }
      }
    }, 30000);

    it('should return transactions with valid structure', async () => {
      const result = await provider.execute<ThetaTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        expect(Array.isArray(transactions)).toBe(true);

        if (transactions.length > 0) {
          const tx = transactions[0]!;

          // Check hash format (should be 0x prefixed)
          expect(tx.hash).toMatch(/^0x[a-fA-F0-9]+$/);

          // Check block height is numeric string
          expect(parseInt(tx.block_height)).toBeGreaterThan(0);

          // Check type is valid
          expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).toContain(tx.type);
        }
      }
    }, 30000);
  });

  describe('Transaction Types', () => {
    it('should handle send transactions (type 2)', async () => {
      const result = await provider.execute<ThetaTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        const sendTx = transactions.find((tx) => tx.type === 2);
        if (sendTx) {
          expect(sendTx.data).toBeDefined();
          // Send transactions should have source/target or inputs/outputs
          const hasSourceTarget = 'source' in sendTx.data || 'target' in sendTx.data;
          const hasInputsOutputs = 'inputs' in sendTx.data || 'outputs' in sendTx.data;
          expect(hasSourceTarget || hasInputsOutputs).toBe(true);
        }
      }
    }, 30000);

    it('should handle smart contract transactions (type 7)', async () => {
      const result = await provider.execute<ThetaTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        const contractTx = transactions.find((tx) => tx.type === 7);
        if (contractTx) {
          expect(contractTx.data).toBeDefined();
          // Smart contract transactions should have from/to
          expect('from' in contractTx.data || 'to' in contractTx.data).toBe(true);
        }
      }
    }, 30000);
  });
});
