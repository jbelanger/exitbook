import { describe, expect, it } from 'vitest';

import type { NearTransaction } from '../../schemas.js';
import { mapNearDataTransaction } from '../neardata.mapper.js';
import type { NearDataTransaction } from '../neardata.schemas.js';

describe('NearDataTransactionMapper', () => {
  describe('map', () => {
    it('should successfully map valid NearData transaction', () => {
      const rawData: NearDataTransaction = {
        actions: [
          {
            action_kind: 'TRANSFER',
            deposit: '1000000000000000000000000',
          },
        ],
        block_hash: 'ABC123DEF456',
        block_height: 100000,
        block_timestamp: 1640000000000000000,
        outcome: {
          execution_outcome: {
            block_hash: 'ABC123DEF456',
            id: 'receipt-1',
            outcome: {
              executor_id: 'bob.near',
              gas_burnt: 4174947687500,
              status: { SuccessValue: '' },
              tokens_burnt: '5000000000000000000000',
            },
          },
        },
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        tx_hash: 'AbCdEf123456',
      };

      const result = mapNearDataTransaction(rawData, { providerName: 'neardata' });

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
        expect(normalized.blockId).toBe('ABC123DEF456');
        expect(normalized.feeAmount).toBe('0.005');
        expect(normalized.feeCurrency).toBe('NEAR');
        expect(normalized.providerName).toBe('neardata');
        expect(normalized.actions).toHaveLength(1);
      }
    });

    it('should validate input data with schema', () => {
      const invalidRawData = {
        block_timestamp: 1640000000000000000,
        receiver_id: 'bob.near',
        signer_id: '',
        tx_hash: 'InvalidTx',
      };

      const result = mapNearDataTransaction(invalidRawData as NearDataTransaction, { providerName: 'neardata' });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('error');
      }
    });

    it('should validate output data with schema', () => {
      const rawData: NearDataTransaction = {
        block_timestamp: 1640000000000000000,
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        tx_hash: 'ValidTx',
      };

      const result = mapNearDataTransaction(rawData, { providerName: 'neardata' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.id).toBeDefined();
        expect(result.value.from).toBeDefined();
        expect(result.value.to).toBeDefined();
        expect(result.value.amount).toBeDefined();
        expect(result.value.currency).toBeDefined();
        expect(result.value.timestamp).toBeDefined();
      }
    });

    it('should handle transaction with missing optional fields', () => {
      const rawData: NearDataTransaction = {
        block_timestamp: 1640000000000000000,
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        tx_hash: 'MinimalTx',
      };

      const result = mapNearDataTransaction(rawData, { providerName: 'neardata' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.id).toBe('MinimalTx');
        expect(result.value.from).toBe('alice.near');
        expect(result.value.to).toBe('bob.near');
        expect(result.value.amount).toBe('0');
        expect(result.value.status).toBe('pending');
        expect(result.value.actions).toEqual([]);
        expect(result.value.blockHeight).toBeUndefined();
        expect(result.value.blockId).toBeUndefined();
        expect(result.value.feeAmount).toBeUndefined();
      }
    });

    it('should handle failed transaction', () => {
      const rawData: NearDataTransaction = {
        block_timestamp: 1640000000000000000,
        outcome: {
          execution_outcome: {
            block_hash: 'ABC123',
            id: 'receipt-1',
            outcome: {
              executor_id: 'bob.near',
              gas_burnt: 1000000,
              status: { Failure: { error: 'execution failed' } },
              tokens_burnt: '1000000000000000000000',
            },
          },
        },
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        tx_hash: 'FailedTx',
      };

      const result = mapNearDataTransaction(rawData, { providerName: 'neardata' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.status).toBe('failed');
      }
    });

    it('should handle function call transaction', () => {
      const rawData: NearDataTransaction = {
        actions: [
          {
            action_kind: 'FUNCTION_CALL',
            args: { receiver_id: 'token.near', amount: '1000000' },
            deposit: '1',
            gas: 30000000000000,
            method_name: 'ft_transfer',
          },
        ],
        block_hash: 'ABC123',
        block_height: 100001,
        block_timestamp: 1640000001000000000,
        outcome: {
          execution_outcome: {
            block_hash: 'ABC123',
            id: 'receipt-1',
            outcome: {
              executor_id: 'usdt.tether-token.near',
              gas_burnt: 3000000000000,
              status: { SuccessValue: '' },
              tokens_burnt: '3000000000000000000000',
            },
          },
        },
        receiver_id: 'usdt.tether-token.near',
        signer_id: 'alice.near',
        tx_hash: 'FunctionCallTx',
      };

      const result = mapNearDataTransaction(rawData, { providerName: 'neardata' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.actions).toHaveLength(1);
        expect(result.value.actions?.[0]?.actionType).toBe('FUNCTION_CALL');
        expect(result.value.actions?.[0]?.methodName).toBe('ft_transfer');
        expect(result.value.actions?.[0]?.args).toEqual({
          amount: '1000000',
          receiver_id: 'token.near',
        });
      }
    });

    it('should reject invalid transaction hash (empty)', () => {
      const invalidRawData = {
        block_timestamp: 1640000000000000000,
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        tx_hash: '',
      };

      const result = mapNearDataTransaction(invalidRawData as NearDataTransaction, { providerName: 'neardata' });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('error');
      }
    });

    it('should reject invalid account IDs', () => {
      const invalidRawData = {
        block_timestamp: 1640000000000000000,
        receiver_id: '',
        signer_id: 'alice.near',
        tx_hash: 'ValidTx',
      };

      const result = mapNearDataTransaction(invalidRawData as NearDataTransaction, { providerName: 'neardata' });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('error');
      }
    });

    it('should handle multiple actions', () => {
      const rawData: NearDataTransaction = {
        actions: [
          {
            action_kind: 'TRANSFER',
            deposit: '1000000000000000000000000',
          },
          {
            action_kind: 'TRANSFER',
            deposit: '2000000000000000000000000',
          },
        ],
        block_timestamp: 1640000000000000000,
        outcome: {
          execution_outcome: {
            block_hash: 'ABC123',
            id: 'receipt-1',
            outcome: {
              executor_id: 'bob.near',
              gas_burnt: 8000000000000,
              status: { SuccessValue: '' },
              tokens_burnt: '11000000000000000000000',
            },
          },
        },
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        tx_hash: 'MultiActionTx',
      };

      const result = mapNearDataTransaction(rawData, { providerName: 'neardata' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.actions).toHaveLength(2);
        expect(result.value.amount).toBe('3000000000000000000000000');
        expect(result.value.feeAmount).toBe('0.011');
      }
    });

    it('should handle implicit accounts', () => {
      const implicitSigner = '98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de';
      const implicitReceiver = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

      const rawData: NearDataTransaction = {
        block_timestamp: 1640000000000000000,
        receiver_id: implicitReceiver,
        signer_id: implicitSigner,
        tx_hash: 'ImplicitTx',
      };

      const result = mapNearDataTransaction(rawData, { providerName: 'neardata' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.from).toBe(implicitSigner);
        expect(result.value.to).toBe(implicitReceiver);
      }
    });

    it('should preserve provider name from source context', () => {
      const rawData: NearDataTransaction = {
        block_timestamp: 1640000000000000000,
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        tx_hash: 'CustomProviderTx',
      };

      const result = mapNearDataTransaction(rawData, { providerName: 'custom-near-provider' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.providerName).toBe('custom-near-provider');
      }
    });

    it('should default to neardata when provider name not in context', () => {
      const rawData: NearDataTransaction = {
        block_timestamp: 1640000000000000000,
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        tx_hash: 'NoProviderTx',
      };

      const result = mapNearDataTransaction(rawData, {});

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.providerName).toBe('neardata');
      }
    });

    it('should handle success with SuccessReceiptId status', () => {
      const rawData: NearDataTransaction = {
        block_timestamp: 1640000000000000000,
        outcome: {
          execution_outcome: {
            block_hash: 'ABC123',
            id: 'receipt-1',
            outcome: {
              executor_id: 'bob.near',
              gas_burnt: 1000000,
              status: { SuccessReceiptId: 'receipt-id-123' },
              tokens_burnt: '1000000000000000000000',
            },
          },
        },
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        tx_hash: 'SuccessReceiptTx',
      };

      const result = mapNearDataTransaction(rawData, { providerName: 'neardata' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.status).toBe('success');
      }
    });

    it('should handle zero fees', () => {
      const rawData: NearDataTransaction = {
        block_timestamp: 1640000000000000000,
        outcome: {
          execution_outcome: {
            block_hash: 'ABC123',
            id: 'receipt-1',
            outcome: {
              executor_id: 'bob.near',
              gas_burnt: 0,
              status: { SuccessValue: '' },
              tokens_burnt: '0',
            },
          },
        },
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        tx_hash: 'ZeroFeesTx',
      };

      const result = mapNearDataTransaction(rawData, { providerName: 'neardata' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.feeAmount).toBeUndefined();
        expect(result.value.feeCurrency).toBeUndefined();
      }
    });
  });
});
