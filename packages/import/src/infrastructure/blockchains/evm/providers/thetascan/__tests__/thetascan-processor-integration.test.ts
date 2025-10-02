import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.js';
import { describe, expect, it } from 'vitest';

import { EVM_CHAINS } from '../../../chain-registry.js';
import { EvmTransactionProcessor } from '../../../processor.js';
import type { EvmTransaction } from '../../../types.js';

describe('Theta Processor Integration', () => {
  const thetaChainConfig = EVM_CHAINS['theta'];
  if (!thetaChainConfig) {
    throw new Error('Theta chain config not found');
  }

  const processor = new EvmTransactionProcessor(thetaChainConfig);
  const sessionMetadata: ImportSessionMetadata = {
    address: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
  };

  describe('THETA currency handling', () => {
    it('should process THETA token_transfer and preserve THETA currency', async () => {
      const normalizedTransactions: EvmTransaction[] = [
        {
          amount: '420.3337', // Normalized amount (not wei)
          blockHeight: 30599571,
          currency: 'THETA',
          feeAmount: '0',
          feeCurrency: 'TFUEL',
          from: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
          id: '0xa8e2051371ac9307a54e5290ec522d679bd7ecde13b86fd85a5d6acbe3257a3a',
          providerId: 'thetascan',
          status: 'success',
          timestamp: 1752686427000,
          to: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
          tokenSymbol: 'THETA',
          tokenType: 'native',
          type: 'token_transfer', // Mapped as token_transfer
        },
      ];

      const result = await processor['processInternal'](normalizedTransactions, sessionMetadata);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        expect(transactions).toHaveLength(1);

        const tx = transactions[0];
        expect(tx).toBeDefined();
        expect(tx!.symbol).toBe('THETA');
        expect(tx!.amount.currency).toBe('THETA');
        expect(tx!.amount.amount.toString()).toBe('420.3337');
        expect(tx!.type).toBe('withdrawal');
      }
    });

    it('should process TFUEL native transfer and preserve TFUEL currency', async () => {
      const normalizedTransactions: EvmTransaction[] = [
        {
          amount: '7614412500000000000000', // Wei amount
          blockHeight: 30599639,
          currency: 'TFUEL',
          feeAmount: '0',
          feeCurrency: 'TFUEL',
          from: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
          id: '0x9312f29a4a4e6478b4f6e30d91d7407067d6350578a25669d1272f4624e8cc01',
          providerId: 'thetascan',
          status: 'success',
          timestamp: 1752686906000,
          to: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
          tokenSymbol: 'TFUEL',
          tokenType: 'native',
          type: 'transfer', // Mapped as regular transfer
        },
      ];

      const result = await processor['processInternal'](normalizedTransactions, sessionMetadata);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        expect(transactions).toHaveLength(1);

        const tx = transactions[0];
        expect(tx).toBeDefined();
        expect(tx!.symbol).toBe('TFUEL');
        expect(tx!.amount.currency).toBe('TFUEL');
        expect(tx!.amount.amount.toString()).toBe('7614.4125');
        expect(tx!.type).toBe('withdrawal');
      }
    });

    it('should handle mixed THETA and TFUEL transactions in same session', async () => {
      const normalizedTransactions: EvmTransaction[] = [
        {
          amount: '7614.4125',
          blockHeight: 30599639,
          currency: 'TFUEL',
          feeAmount: '0',
          feeCurrency: 'TFUEL',
          from: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
          id: '0x9312f29a4a4e6478b4f6e30d91d7407067d6350578a25669d1272f4624e8cc01',
          providerId: 'thetascan',
          status: 'success',
          timestamp: 1752686906000,
          to: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
          tokenSymbol: 'TFUEL',
          tokenType: 'native',
          type: 'token_transfer',
        },
        {
          amount: '420.3337',
          blockHeight: 30599571,
          currency: 'THETA',
          feeAmount: '0',
          feeCurrency: 'TFUEL',
          from: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
          id: '0xa8e2051371ac9307a54e5290ec522d679bd7ecde13b86fd85a5d6acbe3257a3a',
          providerId: 'thetascan',
          status: 'success',
          timestamp: 1752686427000,
          to: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
          tokenSymbol: 'THETA',
          tokenType: 'native',
          type: 'token_transfer',
        },
        {
          amount: '280.2629',
          blockHeight: 25171619,
          currency: 'THETA',
          feeAmount: '0',
          feeCurrency: 'TFUEL',
          from: '0x5a722d3c43e5e5cec5dd91391594309829ae0a24',
          id: '0x20f9184b7537ea513d8c59c6f1bf53d5f23c03530ef8aedc6d1b75a75558230a',
          providerId: 'thetascan',
          status: 'success',
          timestamp: 1715285402000,
          to: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
          tokenSymbol: 'THETA',
          tokenType: 'native',
          type: 'token_transfer',
        },
      ];

      const result = await processor['processInternal'](normalizedTransactions, sessionMetadata);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        expect(transactions).toHaveLength(3);

        // Verify each transaction has the correct currency
        const tfuelTx = transactions.find((tx) => tx.symbol === 'TFUEL');
        const thetaTxs = transactions.filter((tx) => tx.symbol === 'THETA');

        expect(tfuelTx).toBeDefined();
        expect(tfuelTx!.amount.currency).toBe('TFUEL');
        expect(tfuelTx!.amount.amount.toString()).toBe('7614.4125');

        expect(thetaTxs).toHaveLength(2);
        thetaTxs.forEach((tx) => {
          expect(tx.amount.currency).toBe('THETA');
          expect(['420.3337', '280.2629']).toContain(tx.amount.amount.toString());
        });
      }
    });

    it('should always use TFUEL for fees regardless of transaction currency', async () => {
      const normalizedTransactions: EvmTransaction[] = [
        {
          amount: '420.3337',
          blockHeight: 30599571,
          currency: 'THETA',
          feeAmount: '100000000000000000', // 0.1 TFUEL in wei
          feeCurrency: 'TFUEL',
          from: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
          id: '0xa8e2051371ac9307a54e5290ec522d679bd7ecde13b86fd85a5d6acbe3257a3a',
          providerId: 'thetascan',
          status: 'success',
          timestamp: 1752686427000,
          to: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
          tokenSymbol: 'THETA',
          tokenType: 'native',
          type: 'token_transfer',
        },
      ];

      const result = await processor['processInternal'](normalizedTransactions, sessionMetadata);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        expect(transactions).toHaveLength(1);

        const tx = transactions[0];
        expect(tx).toBeDefined();
        expect(tx!.symbol).toBe('THETA');
        expect(tx!.amount.currency).toBe('THETA');
        expect(tx!.fee).toBeDefined();
        expect(tx!.fee?.currency).toBe('TFUEL');
        expect(tx!.fee?.amount.toString()).toBe('0.1');
      }
    });
  });
});
