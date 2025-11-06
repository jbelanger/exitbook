import { describe, expect, it } from 'vitest';

import { mapNearBlocksTransaction } from '../../mapper-utils.js';
import type { NearTransaction } from '../../schemas.js';
import type { NearBlocksTransaction } from '../nearblocks.schemas.js';

describe('NearBlocksTransactionMapper', () => {
  describe('map', () => {
    it('should successfully map valid NearBlocks transaction', () => {
      const rawData: NearBlocksTransaction = {
        actions: [
          {
            action: 'TRANSFER',
            deposit: '1000000000000000000000000',
            from: 'alice.near',
            to: 'bob.near',
          },
        ],
        block_height: 100000,
        block_timestamp: '1640000000000000000',
        outcomes: {
          '8S8R8o9ZN5e8RD3H8A1JjgFmxhYCwPpYxRQyKwqBgYdF': {
            status: true,
            tokens_burnt: '5000000000000000000000',
          },
        },
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        transaction_hash: 'AbCdEf123456',
      };

      const result = mapNearBlocksTransaction(rawData, { providerName: 'nearblocks' });

      if (result.isErr()) {
        console.error('Test 1 failed - Mapper error:', JSON.stringify(result.error, undefined, 2));
      }

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized: NearTransaction = result.value;
        expect(normalized.id).toBe('AbCdEf123456');
        expect(normalized.from).toBe('alice.near');
        expect(normalized.to).toBe('bob.near');
        expect(normalized.amount).toBe('1000000000000000000000000');
        expect(normalized.currency).toBe('NEAR');
        expect(normalized.status).toBe('success');
        expect(normalized.timestamp).toBe(1640000000);
        expect(normalized.blockHeight).toBe(100000);
        expect(normalized.feeAmount).toBe('0.005');
        expect(normalized.feeCurrency).toBe('NEAR');
        expect(normalized.providerName).toBe('nearblocks');
        expect(normalized.actions).toHaveLength(1);
      }
    });

    it('should validate input data with schema', () => {
      const invalidRawData = {
        block_timestamp: '1640000000000000000',
        receiver_id: 'bob.near',
        signer_id: '', // Invalid: empty signer_id
        transaction_hash: 'InvalidTx',
      };

      const result = mapNearBlocksTransaction(invalidRawData as NearBlocksTransaction, { providerName: 'nearblocks' });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('error');
      }
    });

    it('should validate output data with schema', () => {
      const rawData: NearBlocksTransaction = {
        block_timestamp: '1640000000000000000',
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        transaction_hash: 'ValidTx',
      };

      const result = mapNearBlocksTransaction(rawData, { providerName: 'nearblocks' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Output should pass NearTransactionSchema validation
        expect(result.value.id).toBeDefined();
        expect(result.value.from).toBeDefined();
        expect(result.value.to).toBeDefined();
        expect(result.value.amount).toBeDefined();
        expect(result.value.currency).toBeDefined();
        expect(result.value.timestamp).toBeDefined();
      }
    });

    it('should handle transaction with missing optional fields', () => {
      const rawData: NearBlocksTransaction = {
        block_timestamp: '1640000000000000000',
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        transaction_hash: 'MinimalTx',
      };

      const result = mapNearBlocksTransaction(rawData, { providerName: 'nearblocks' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.id).toBe('MinimalTx');
        expect(result.value.from).toBe('alice.near');
        expect(result.value.to).toBe('bob.near');
        expect(result.value.amount).toBe('0');
        expect(result.value.status).toBe('pending');
        expect(result.value.actions).toEqual([]);
        expect(result.value.blockHeight).toBeUndefined();
        expect(result.value.feeAmount).toBeUndefined();
      }
    });

    it('should handle failed transaction', () => {
      const rawData: NearBlocksTransaction = {
        block_timestamp: '1640000000000000000',
        outcomes: {
          FT3ZqXb7YG8RnxV7C2K9HmVPpN4WtQ6sA3Lm2DxRyBkE: {
            status: false,
          },
        },
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        transaction_hash: 'FailedTx',
      };

      const result = mapNearBlocksTransaction(rawData, { providerName: 'nearblocks' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.status).toBe('failed');
      }
    });

    it('should handle function call transaction', () => {
      const rawData: NearBlocksTransaction = {
        actions: [
          {
            action: 'FUNCTION_CALL',
            args: { receiver_id: 'token.near', amount: '1000000' },
            deposit: '1',
            from: 'alice.near',
            method: 'ft_transfer',
            to: 'usdt.tether-token.near',
          },
        ],
        block_height: 100001,
        block_timestamp: '1640000001000000000',
        outcomes: {
          BQ7LmN3R5vYx4TwP9KqGzC8HdXs6FpAtVj2EbZnRyJmS: {
            status: true,
            tokens_burnt: '3000000000000000000000',
          },
        },
        receiver_id: 'usdt.tether-token.near',
        signer_id: 'alice.near',
        transaction_hash: 'FunctionCallTx',
      };

      const result = mapNearBlocksTransaction(rawData, { providerName: 'nearblocks' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.actions).toHaveLength(1);
        expect(result.value.actions?.[0]?.actionType).toBe('FUNCTION_CALL');
        expect(result.value.actions?.[0]?.methodName).toBe('ft_transfer');
        expect(result.value.actions?.[0]?.args).toEqual({
          receiver_id: 'token.near',
          amount: '1000000',
        });
      }
    });

    it('should reject invalid transaction hash (empty)', () => {
      const invalidRawData = {
        block_timestamp: '1640000000000000000',
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        transaction_hash: '', // Invalid: empty
      };

      const result = mapNearBlocksTransaction(invalidRawData as NearBlocksTransaction, { providerName: 'nearblocks' });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('error');
      }
    });

    it('should reject invalid block_timestamp (empty)', () => {
      const invalidRawData = {
        block_timestamp: '', // Invalid: empty
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        transaction_hash: 'ValidTx',
      };

      const result = mapNearBlocksTransaction(invalidRawData as NearBlocksTransaction, { providerName: 'nearblocks' });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('error');
      }
    });

    it('should reject invalid account IDs', () => {
      const invalidRawData = {
        block_timestamp: '1640000000000000000',
        receiver_id: '', // Invalid: empty
        signer_id: 'alice.near',
        transaction_hash: 'ValidTx',
      };

      const result = mapNearBlocksTransaction(invalidRawData as NearBlocksTransaction, { providerName: 'nearblocks' });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('error');
      }
    });

    it('should handle multiple actions', () => {
      const rawData: NearBlocksTransaction = {
        actions: [
          {
            action: 'TRANSFER',
            deposit: '1000000000000000000000000',
            from: 'alice.near',
            to: 'bob.near',
          },
          {
            action: 'TRANSFER',
            deposit: '2000000000000000000000000',
            from: 'alice.near',
            to: 'charlie.near',
          },
        ],
        block_timestamp: '1640000000000000000',
        outcomes: {
          CM5nW8xQ7LtP9JfVz2KgR4HdYs3GpBuXj6EcZqRyNmT: {
            status: true,
            tokens_burnt: '5000000000000000000000',
          },
          DP6oX9yR8MuQ0KgWA3LhS5IeZt4HqCvYk7FdArSzOnU: {
            status: true,
            tokens_burnt: '6000000000000000000000',
          },
        },
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        transaction_hash: 'MultiActionTx',
      };

      const result = mapNearBlocksTransaction(rawData, { providerName: 'nearblocks' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.actions).toHaveLength(2);
        expect(result.value.amount).toBe('3000000000000000000000000'); // Sum of both deposits
        expect(result.value.feeAmount).toBe('0.011'); // Sum of both fees
      }
    });

    it('should handle implicit accounts', () => {
      const implicitSigner = '98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de';
      const implicitReceiver = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

      const rawData: NearBlocksTransaction = {
        block_timestamp: '1640000000000000000',
        receiver_id: implicitReceiver,
        signer_id: implicitSigner,
        transaction_hash: 'ImplicitTx',
      };

      const result = mapNearBlocksTransaction(rawData, { providerName: 'nearblocks' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.from).toBe(implicitSigner);
        expect(result.value.to).toBe(implicitReceiver);
      }
    });

    it('should preserve provider name from source context', () => {
      const rawData: NearBlocksTransaction = {
        block_timestamp: '1640000000000000000',
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        transaction_hash: 'CustomProviderTx',
      };

      const result = mapNearBlocksTransaction(rawData, { providerName: 'custom-near-provider' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.providerName).toBe('custom-near-provider');
      }
    });

    it('should default to nearblocks when provider name not in context', () => {
      const rawData: NearBlocksTransaction = {
        block_timestamp: '1640000000000000000',
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        transaction_hash: 'NoProviderTx',
      };

      const result = mapNearBlocksTransaction(rawData, {});

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.providerName).toBe('nearblocks');
      }
    });
  });
});
