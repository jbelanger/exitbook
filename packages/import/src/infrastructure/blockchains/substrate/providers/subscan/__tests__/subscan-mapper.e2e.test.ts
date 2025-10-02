import type { RawTransactionMetadata } from '@exitbook/import/app/ports/importers.js';
import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../shared/index.ts';
import { SubscanApiClient } from '../subscan.api-client.js';
import { SubscanTransactionMapper } from '../subscan.mapper.js';
import type { SubscanTransferAugmented } from '../subscan.types.js';

describe('SubscanTransactionMapper E2E - Polkadot', () => {
  const mapper = new SubscanTransactionMapper();

  describe('Polkadot', () => {
    const config = ProviderRegistry.createDefaultConfig('polkadot', 'subscan');
    const apiClient = new SubscanApiClient(config);
    // Polkadot Treasury address
    const testAddress = '13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB';

    let cachedTransactions: SubscanTransferAugmented[];

    beforeAll(async () => {
      // Fetch data once to avoid hammering the API
      cachedTransactions = await apiClient.execute<SubscanTransferAugmented[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });
    }, 60000);

    it('should map real Polkadot transaction data from API', () => {
      expect(cachedTransactions.length).toBeGreaterThan(0);

      const rawTx = cachedTransactions[0]!;
      const metadata: RawTransactionMetadata = {
        providerId: 'subscan',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.id).toBe(rawTx.hash);
        expect(normalized.currency).toBe('DOT'); // Polkadot native currency
        expect(normalized.feeCurrency).toBe('DOT');
        expect(normalized.providerId).toBe('subscan');
        expect(normalized.status).toBe(rawTx.success ? 'success' : 'failed');
        expect(normalized.from).toBe(rawTx.from);
        expect(normalized.to).toBe(rawTx.to);
        expect(normalized.timestamp).toBeGreaterThan(0);
        expect(normalized.blockHeight).toBeGreaterThan(0);
        expect(normalized.chainName).toBe('polkadot');
        expect(normalized.ss58Format).toBe(0);
      }
    });

    it('should map native DOT transactions correctly', () => {
      // Subscan returns transfers, so any transaction should have an amount
      const nativeTransfer = cachedTransactions[0];
      if (!nativeTransfer) {
        console.warn('No transactions found, skipping test');
        return;
      }

      const metadata: RawTransactionMetadata = {
        providerId: 'subscan',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(nativeTransfer, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.currency).toBe('DOT');
        expect(normalized.amount).toBeDefined();
        expect(parseFloat(normalized.amount)).toBeGreaterThanOrEqual(0);
        expect(normalized.module).toBe(nativeTransfer.module);
      }
    });

    it('should convert amount from planck to DOT correctly', () => {
      // Find a transaction with a known amount
      const txWithAmount = cachedTransactions.find((tx) => tx.amount !== '0');
      if (!txWithAmount) {
        console.warn('No transactions with amount found, skipping test');
        return;
      }

      const metadata: RawTransactionMetadata = {
        providerId: 'subscan',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(txWithAmount, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        // Amount should be converted from planck (10 decimals) to DOT
        const amountInDot = parseFloat(normalized.amount);
        const amountInPlanck = parseFloat(txWithAmount.amount);
        expect(amountInDot).toBe(amountInPlanck / 1e10);
      }
    });

    it('should handle transactions with fees', () => {
      // Find a transaction with a fee
      const txWithFee = cachedTransactions.find((tx) => tx.fee && tx.fee !== '0');
      if (!txWithFee) {
        console.warn('No transactions with fees found, skipping test');
        return;
      }

      const metadata: RawTransactionMetadata = {
        providerId: 'subscan',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(txWithFee, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.feeAmount).toBeDefined();
        const feeInDot = parseFloat(normalized.feeAmount!);
        const feeInPlanck = parseFloat(txWithFee.fee);
        expect(feeInDot).toBe(feeInPlanck / 1e10);
      }
    });

    it('should include extrinsic index from API', () => {
      const rawTx = cachedTransactions[0]!;
      const metadata: RawTransactionMetadata = {
        providerId: 'subscan',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.extrinsicIndex).toBe(rawTx.extrinsic_index);
      }
    });

    it('should filter out transactions not relevant to user address', () => {
      const rawTx = cachedTransactions[0]!;
      const metadata: RawTransactionMetadata = {
        providerId: 'subscan',
      };
      // Use a different address that's not involved in the transaction
      const sessionContext: ImportSessionMetadata = {
        address: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5', // Random address
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      // Should return error because transaction doesn't involve the specified address
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        const errorMessage = result.error.type === 'error' ? result.error.message : result.error.reason;
        expect(errorMessage).toContain('Transaction not relevant to user addresses');
      }
    });

    it('should use augmented chain config data', () => {
      const rawTx = cachedTransactions[0]!;
      const metadata: RawTransactionMetadata = {
        providerId: 'subscan',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        // Verify the mapper used the augmented chain config data
        expect(normalized.currency).toBe(rawTx._nativeCurrency);
        expect(normalized.feeCurrency).toBe(rawTx._nativeCurrency);
        // Verify the chain config was correctly looked up
        expect(normalized.chainName).toBe('polkadot');
      }
    });
  });
});
