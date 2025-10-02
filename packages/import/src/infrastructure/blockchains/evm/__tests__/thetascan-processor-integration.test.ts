import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.js';
import { describe, expect, it } from 'vitest';

import { EVM_CHAINS } from '../chain-registry.ts';
import { EvmTransactionProcessor } from '../processor.ts';
import type { EvmTransaction } from '../types.ts';

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
        if (!tx) return;

        // Verify new structured movements
        expect(tx.movements.outflows).toHaveLength(1);
        expect(tx.movements.outflows[0]?.asset).toBe('THETA');
        expect(tx.movements.outflows[0]?.amount.amount.toString()).toBe('420.3337');
        expect(tx.movements.inflows).toHaveLength(0);
        expect(tx.movements.primary.asset).toBe('THETA');
        expect(tx.movements.primary.amount.amount.toString()).toBe('420.3337');
        expect(tx.movements.primary.direction).toBe('out');

        // Verify new structured fees
        expect(tx.fees.network).toBeDefined();
        expect(tx.fees.network?.currency).toBe('TFUEL');
        expect(tx.fees.network?.amount.toString()).toBe('0');
        expect(tx.fees.platform).toBeUndefined();
        expect(tx.fees.total.currency).toBe('TFUEL');
        expect(tx.fees.total.amount.toString()).toBe('0');

        // Verify new operation classification
        expect(tx.operation.category).toBe('transfer');
        expect(tx.operation.type).toBe('withdrawal');

        // Verify blockchain metadata
        expect(tx.blockchain).toBeDefined();
        expect(tx.blockchain?.name).toBe('theta');
        expect(tx.blockchain?.block_height).toBe(30599571);
        expect(tx.blockchain?.transaction_hash).toBe(
          '0xa8e2051371ac9307a54e5290ec522d679bd7ecde13b86fd85a5d6acbe3257a3a'
        );
        expect(tx.blockchain?.is_confirmed).toBe(true);

        // Verify backward compatibility (deprecated fields)
        expect(tx.symbol).toBe('THETA');
        expect(tx.amount?.currency).toBe('THETA');
        expect(tx.amount?.amount.toString()).toBe('420.3337');
        expect(tx.type).toBe('withdrawal');
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
        if (!tx) return;

        // Verify new structured movements
        expect(tx.movements.outflows).toHaveLength(1);
        expect(tx.movements.outflows[0]?.asset).toBe('TFUEL');
        expect(tx.movements.outflows[0]?.amount.amount.toString()).toBe('7614.4125');
        expect(tx.movements.inflows).toHaveLength(0);
        expect(tx.movements.primary.asset).toBe('TFUEL');
        expect(tx.movements.primary.amount.amount.toString()).toBe('7614.4125');
        expect(tx.movements.primary.direction).toBe('out');

        // Verify new structured fees
        expect(tx.fees.network).toBeDefined();
        expect(tx.fees.network?.currency).toBe('TFUEL');
        expect(tx.fees.network?.amount.toString()).toBe('0');
        expect(tx.fees.platform).toBeUndefined();
        expect(tx.fees.total.currency).toBe('TFUEL');
        expect(tx.fees.total.amount.toString()).toBe('0');

        // Verify new operation classification
        expect(tx.operation.category).toBe('transfer');
        expect(tx.operation.type).toBe('withdrawal');

        // Verify blockchain metadata
        expect(tx.blockchain).toBeDefined();
        expect(tx.blockchain?.name).toBe('theta');
        expect(tx.blockchain?.block_height).toBe(30599639);
        expect(tx.blockchain?.transaction_hash).toBe(
          '0x9312f29a4a4e6478b4f6e30d91d7407067d6350578a25669d1272f4624e8cc01'
        );
        expect(tx.blockchain?.is_confirmed).toBe(true);

        // Verify backward compatibility (deprecated fields)
        expect(tx.symbol).toBe('TFUEL');
        expect(tx.amount?.currency).toBe('TFUEL');
        expect(tx.amount?.amount.toString()).toBe('7614.4125');
        expect(tx.type).toBe('withdrawal');
      }
    });

    it('should handle mixed THETA and TFUEL transactions in same session', async () => {
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
          type: 'transfer', // TFUEL uses 'transfer', not 'token_transfer'
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
        if (tfuelTx) {
          // Verify new structured movements for TFUEL transaction
          expect(tfuelTx.movements.outflows).toHaveLength(1);
          expect(tfuelTx.movements.outflows[0]?.asset).toBe('TFUEL');
          expect(tfuelTx.movements.outflows[0]?.amount.amount.toString()).toBe('7614.4125');
          expect(tfuelTx.movements.inflows).toHaveLength(0);
          expect(tfuelTx.movements.primary.asset).toBe('TFUEL');
          expect(tfuelTx.movements.primary.direction).toBe('out');

          // Verify operation classification
          expect(tfuelTx.operation.category).toBe('transfer');
          expect(tfuelTx.operation.type).toBe('withdrawal');

          // Verify blockchain metadata
          expect(tfuelTx.blockchain).toBeDefined();
          expect(tfuelTx.blockchain?.name).toBe('theta');

          // Verify backward compatibility
          expect(tfuelTx.amount?.currency).toBe('TFUEL');
          expect(tfuelTx.amount?.amount.toString()).toBe('7614.4125');
        }

        expect(thetaTxs).toHaveLength(2);
        thetaTxs.forEach((tx) => {
          // Verify new structured movements for THETA transactions
          const hasInflow = tx.movements.inflows.length > 0;
          const hasOutflow = tx.movements.outflows.length > 0;

          expect(tx.movements.primary.asset).toBe('THETA');
          expect(['420.3337', '280.2629']).toContain(tx.movements.primary.amount.amount.toString());

          // Verify correct direction based on from/to address
          if (hasInflow) {
            expect(tx.movements.primary.direction).toBe('in');
            expect(tx.operation.type).toBe('deposit');
          } else if (hasOutflow) {
            expect(tx.movements.primary.direction).toBe('out');
            expect(tx.operation.type).toBe('withdrawal');
          }

          // Verify operation classification
          expect(tx.operation.category).toBe('transfer');

          // Verify blockchain metadata
          expect(tx.blockchain).toBeDefined();
          expect(tx.blockchain?.name).toBe('theta');

          // Verify backward compatibility
          expect(tx.amount?.currency).toBe('THETA');
          expect(['420.3337', '280.2629']).toContain(tx.amount?.amount.toString());
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
        if (!tx) return;

        // Verify new structured movements
        expect(tx.movements.outflows).toHaveLength(1);
        expect(tx.movements.outflows[0]?.asset).toBe('THETA');
        expect(tx.movements.primary.asset).toBe('THETA');
        expect(tx.movements.primary.direction).toBe('out');

        // Verify new structured fees - TFUEL is used for gas fees regardless of transaction currency
        expect(tx.fees.network).toBeDefined();
        expect(tx.fees.network?.currency).toBe('TFUEL');
        expect(tx.fees.network?.amount.toString()).toBe('0.1');
        expect(tx.fees.platform).toBeUndefined();
        expect(tx.fees.total.currency).toBe('TFUEL');
        expect(tx.fees.total.amount.toString()).toBe('0.1');

        // Verify new operation classification
        expect(tx.operation.category).toBe('transfer');
        expect(tx.operation.type).toBe('withdrawal');

        // Verify blockchain metadata
        expect(tx.blockchain).toBeDefined();
        expect(tx.blockchain?.name).toBe('theta');
        expect(tx.blockchain?.block_height).toBe(30599571);
        expect(tx.blockchain?.transaction_hash).toBe(
          '0xa8e2051371ac9307a54e5290ec522d679bd7ecde13b86fd85a5d6acbe3257a3a'
        );
        expect(tx.blockchain?.is_confirmed).toBe(true);

        // Verify backward compatibility (deprecated fields)
        expect(tx.symbol).toBe('THETA');
        expect(tx.amount?.currency).toBe('THETA');
        expect(tx.fee).toBeDefined();
        expect(tx.fee?.currency).toBe('TFUEL');
        expect(tx.fee?.amount.toString()).toBe('0.1');
      }
    });
  });
});
