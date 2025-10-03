import type { RawTransactionMetadata, ImportSessionMetadata } from '@exitbook/data';

import { ProviderRegistry } from '../../../../../core/blockchain/index.ts';
import { TaostatsApiClient } from '../taostats.api-client.js';
import { TaostatsTransactionMapper } from '../taostats.mapper.js';
import type { TaostatsTransactionAugmented } from '../taostats.types.js';

describe('TaostatsTransactionMapper E2E - Bittensor', () => {
  const mapper = new TaostatsTransactionMapper();

  describe('Bittensor', () => {
    const config = ProviderRegistry.createDefaultConfig('bittensor', 'taostats');
    const apiClient = new TaostatsApiClient(config);
    // Bittensor Foundation Treasury address
    const testAddress = '5HEo565WAy4Dbq3Sv271SAi7syBSofyfhhwRNjFNSM2gP9M2';

    let cachedTransactions: TaostatsTransactionAugmented[];

    beforeAll(async () => {
      // Fetch data once to avoid hammering the API
      cachedTransactions = await apiClient.execute<TaostatsTransactionAugmented[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });
    }, 60000);

    it('should map real Bittensor transaction data from API', () => {
      expect(cachedTransactions.length).toBeGreaterThan(0);

      const rawTx = cachedTransactions[0]!;
      const metadata: RawTransactionMetadata = {
        providerId: 'taostats',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.id).toBe(rawTx.transaction_hash);
        expect(normalized.currency).toBe('TAO'); // Bittensor native currency
        expect(normalized.feeCurrency).toBe('TAO');
        expect(normalized.providerId).toBe('taostats');
        expect(normalized.status).toBe('success'); // Taostats only returns successful txs
        expect(normalized.from).toBe(rawTx.from.ss58);
        expect(normalized.to).toBe(rawTx.to.ss58);
        expect(normalized.timestamp).toBeGreaterThan(0);
        expect(normalized.blockHeight).toBeGreaterThan(0);
        expect(normalized.chainName).toBe('bittensor');
        expect(normalized.ss58Format).toBe(42);
      }
    });

    it('should map native TAO transactions correctly', () => {
      // Taostats returns transfers, so any transaction should have an amount
      const nativeTransfer = cachedTransactions[0];
      if (!nativeTransfer) {
        console.warn('No transactions found, skipping test');
        return;
      }

      const metadata: RawTransactionMetadata = {
        providerId: 'taostats',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(nativeTransfer, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.currency).toBe('TAO');
        expect(normalized.amount).toBeDefined();
        expect(parseFloat(normalized.amount)).toBeGreaterThanOrEqual(0);
        expect(normalized.module).toBe('balances');
      }
    });

    it('should convert amount from rao to TAO correctly', () => {
      // Find a transaction with a known amount
      const txWithAmount = cachedTransactions.find((tx) => tx.amount !== '0');
      if (!txWithAmount) {
        console.warn('No transactions with amount found, skipping test');
        return;
      }

      const metadata: RawTransactionMetadata = {
        providerId: 'taostats',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(txWithAmount, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        // Amount should be converted from rao (9 decimals) to TAO
        const amountInTao = parseFloat(normalized.amount);
        const amountInRao = parseFloat(txWithAmount.amount);
        expect(amountInTao).toBe(amountInRao / 1e9);
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
        providerId: 'taostats',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(txWithFee, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.feeAmount).toBeDefined();
        const feeInTao = parseFloat(normalized.feeAmount!);
        const feeInRao = parseFloat(txWithFee.fee!);
        expect(feeInTao).toBe(feeInRao / 1e9);
      }
    });

    it('should include extrinsic index from API', () => {
      const rawTx = cachedTransactions[0]!;
      const metadata: RawTransactionMetadata = {
        providerId: 'taostats',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.extrinsicIndex).toBe(rawTx.extrinsic_id);
      }
    });

    it('should filter out transactions not relevant to user address', () => {
      const rawTx = cachedTransactions[0]!;
      const metadata: RawTransactionMetadata = {
        providerId: 'taostats',
      };
      // Use a different address that's not involved in the transaction
      const sessionContext: ImportSessionMetadata = {
        address: '5EJA1oSrTx7xYMBerrUHLNktA3P89YHJBeTrevotTQab6gEY', // Random address
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      // Should return error because transaction doesn't involve the specified address
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        const errorMessage = result.error.type === 'error' ? result.error.message : result.error.reason;
        expect(errorMessage).toContain('Transaction not relevant to user addresses');
      }
    });
  });
});
