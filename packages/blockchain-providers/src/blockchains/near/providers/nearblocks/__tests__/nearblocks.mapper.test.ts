import { describe, expect, it } from 'vitest';

import type { NearTransaction } from '../../../schemas.ts';
import { mapNearBlocksTransaction } from '../mapper-utils.js';
import type { NearBlocksTransaction } from '../nearblocks.schemas.js';

describe('NearBlocksTransactionMapper', () => {
  describe('map', () => {
    it('should successfully map valid NearBlocks transaction', () => {
      const rawData: NearBlocksTransaction = {
        actions: [
          {
            action: 'TRANSFER',
            args: undefined,
            deposit: '1000000000000000000000000',
            method: undefined,
          },
        ],
        block: {
          block_height: 100000,
        },
        block_timestamp: '1640000000000000000',
        outcomes: {
          status: true,
        },
        signer_account_id: 'alice.near',
        receipt_outcome: {
          executor_account_id: 'bob.near',
          gas_burnt: '4174947687500',
          status: true,
          tokens_burnt: '5000000000000000000000',
        },
        receiver_account_id: 'bob.near',
        transaction_hash: 'AbCdEf123456',
      };

      const result = mapNearBlocksTransaction(rawData);

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
        expect(normalized.timestamp).toBe(1640000000000);
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
        signer_account_id: '', // Invalid: empty
        receiver_account_id: 'bob.near',
        transaction_hash: 'InvalidTx',
      };

      const result = mapNearBlocksTransaction(invalidRawData as NearBlocksTransaction);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('error');
      }
    });

    it('should validate output data with schema', () => {
      const rawData: NearBlocksTransaction = {
        block_timestamp: '1640000000000000000',
        signer_account_id: 'alice.near',
        receiver_account_id: 'bob.near',
        transaction_hash: 'ValidTx',
      };

      const result = mapNearBlocksTransaction(rawData);

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
        signer_account_id: 'alice.near',
        receiver_account_id: 'bob.near',
        transaction_hash: 'MinimalTx',
      };

      const result = mapNearBlocksTransaction(rawData);

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
          status: false,
        },
        signer_account_id: 'alice.near',
        receiver_account_id: 'bob.near',
        transaction_hash: 'FailedTx',
      };

      const result = mapNearBlocksTransaction(rawData);

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
            method: 'ft_transfer',
          },
        ],
        block: {
          block_height: 100001,
        },
        block_timestamp: '1640000001000000000',
        outcomes: {
          status: true,
        },
        signer_account_id: 'alice.near',
        receipt_outcome: {
          executor_account_id: 'usdt.tether-token.near',
          gas_burnt: '3000000000000',
          status: true,
          tokens_burnt: '3000000000000000000000',
        },
        receiver_account_id: 'usdt.tether-token.near',
        transaction_hash: 'FunctionCallTx',
      };

      const result = mapNearBlocksTransaction(rawData);

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
        signer_account_id: 'alice.near',
        receiver_account_id: 'bob.near',
        transaction_hash: '', // Invalid: empty
      };

      const result = mapNearBlocksTransaction(invalidRawData as NearBlocksTransaction);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('error');
      }
    });

    it('should reject invalid block_timestamp (empty)', () => {
      const invalidRawData = {
        block_timestamp: '', // Invalid: empty
        signer_account_id: 'alice.near',
        receiver_account_id: 'bob.near',
        transaction_hash: 'ValidTx',
      };

      const result = mapNearBlocksTransaction(invalidRawData as NearBlocksTransaction);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('error');
      }
    });

    it('should reject invalid account IDs', () => {
      const invalidRawData = {
        block_timestamp: '1640000000000000000',
        signer_account_id: 'alice.near',
        receiver_account_id: '', // Invalid: empty
        transaction_hash: 'ValidTx',
      };

      const result = mapNearBlocksTransaction(invalidRawData as NearBlocksTransaction);

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
            args: undefined,
            deposit: '1000000000000000000000000',
            method: undefined,
          },
          {
            action: 'TRANSFER',
            args: undefined,
            deposit: '2000000000000000000000000',
            method: undefined,
          },
        ],
        block_timestamp: '1640000000000000000',
        outcomes: {
          status: true,
        },
        signer_account_id: 'alice.near',
        receipt_outcome: {
          executor_account_id: 'bob.near',
          gas_burnt: '8000000000000',
          status: true,
          tokens_burnt: '11000000000000000000000',
        },
        receiver_account_id: 'bob.near',
        transaction_hash: 'MultiActionTx',
      };

      const result = mapNearBlocksTransaction(rawData);

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
        signer_account_id: implicitSigner,
        receiver_account_id: implicitReceiver,
        transaction_hash: 'ImplicitTx',
      };

      const result = mapNearBlocksTransaction(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.from).toBe(implicitSigner);
        expect(result.value.to).toBe(implicitReceiver);
      }
    });

    it('should default to nearblocks when provider name not in context', () => {
      const rawData: NearBlocksTransaction = {
        block_timestamp: '1640000000000000000',
        signer_account_id: 'alice.near',
        receiver_account_id: 'bob.near',
        transaction_hash: 'NoProviderTx',
      };

      const result = mapNearBlocksTransaction(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.providerName).toBe('nearblocks');
      }
    });
  });
});
