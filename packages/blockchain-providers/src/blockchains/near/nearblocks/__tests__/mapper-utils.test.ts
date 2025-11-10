import { describe, expect, it } from 'vitest';

import { yoctoNearToNearString } from '../../utils.js';
import {
  calculateTotalDeposit,
  calculateTotalGasBurnt,
  determineTransactionStatus,
  mapNearBlocksActions,
  mapNearBlocksTransaction,
  parseNearBlocksTimestamp,
} from '../mapper-utils.js';
import type { NearBlocksTransaction } from '../nearblocks.schemas.js';

describe('nearblocks/mapper-utils', () => {
  describe('yoctoNearToNearString', () => {
    it('should convert yoctoNEAR to NEAR string', () => {
      expect(yoctoNearToNearString('1000000000000000000000000')).toBe('1');
      expect(yoctoNearToNearString('500000000000000000000000')).toBe('0.5');
      expect(yoctoNearToNearString('2500000000000000000000000')).toBe('2.5');
    });

    it('should handle string input', () => {
      expect(yoctoNearToNearString('1000000000000000000000000')).toBe('1');
    });

    it('should handle number input', () => {
      expect(yoctoNearToNearString(1000000000000000000000000)).toBe('1');
    });

    it('should handle zero', () => {
      expect(yoctoNearToNearString(0)).toBe('0');
      expect(yoctoNearToNearString('0')).toBe('0');
    });

    it('should handle very small amounts', () => {
      expect(yoctoNearToNearString('1')).toBe('0.000000000000000000000001');
    });

    it('should handle very large amounts', () => {
      expect(yoctoNearToNearString('1000000000000000000000000000000')).toBe('1000000');
    });
  });

  describe('parseNearBlocksTimestamp', () => {
    it('should convert nanoseconds to milliseconds (Unix timestamp)', () => {
      // 1 second in nanoseconds = 1,000,000,000
      // 1 second in milliseconds = 1,000
      expect(parseNearBlocksTimestamp('1000000000')).toBe(1000);
      // 1 millisecond in nanoseconds = 1,000,000
      expect(parseNearBlocksTimestamp('1000000')).toBe(1);
    });

    it('should handle real NearBlocks timestamps', () => {
      // Real NearBlocks timestamp: 1640000000000000000 (nanoseconds)
      // Expected: 1640000000000 (Unix timestamp in milliseconds - December 20, 2021)
      expect(parseNearBlocksTimestamp('1640000000000000000')).toBe(1640000000000);
      expect(parseNearBlocksTimestamp('1700000000000000000')).toBe(1700000000000);
    });

    it('should handle zero timestamp', () => {
      expect(parseNearBlocksTimestamp('0')).toBe(0);
    });

    it('should handle very large timestamps', () => {
      // Future timestamp
      expect(parseNearBlocksTimestamp('2000000000000000000')).toBe(2000000000000);
    });

    it('should round to nearest millisecond', () => {
      // 1.5 milliseconds in nanoseconds = 1,500,000
      expect(parseNearBlocksTimestamp('1500000')).toBe(2);
      // 1.4 milliseconds in nanoseconds = 1,400,000
      expect(parseNearBlocksTimestamp('1400000')).toBe(1);
    });
  });

  describe('determineTransactionStatus', () => {
    it('should return "pending" when outcomes is undefined', () => {
      expect(determineTransactionStatus()).toBe('pending');
    });

    it('should return "success" when status is true', () => {
      const outcomes = { status: true };
      expect(determineTransactionStatus(outcomes)).toBe('success');
    });

    it('should return "failed" when status is false', () => {
      const outcomes = { status: false };
      expect(determineTransactionStatus(outcomes)).toBe('failed');
    });
  });

  describe('mapNearBlocksActions', () => {
    it('should map NearBlocks actions to normalized format', () => {
      const actions = [
        {
          action: 'TRANSFER',
          deposit: '100000000000000000000',
          method: undefined,
          args: undefined,
        },
        {
          action: 'FUNCTION_CALL',
          args: { method: 'transfer', amount: '100' },
          deposit: '0',
          method: 'ft_transfer',
        },
      ];

      const result = mapNearBlocksActions(actions);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        actionType: 'TRANSFER',
        deposit: '100000000000000000000',
        receiverId: undefined,
        args: undefined,
        methodName: undefined,
      });
      expect(result[1]).toEqual({
        actionType: 'FUNCTION_CALL',
        args: { method: 'transfer', amount: '100' },
        deposit: '0',
        methodName: 'ft_transfer',
        receiverId: undefined,
      });
    });

    it('should handle undefined actions', () => {
      expect(mapNearBlocksActions()).toEqual([]);
    });

    it('should handle empty actions array', () => {
      expect(mapNearBlocksActions([])).toEqual([]);
    });

    it('should handle actions with optional fields missing', () => {
      const actions = [
        {
          action: 'STAKE',
        },
      ];

      const result = mapNearBlocksActions(actions);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        actionType: 'STAKE',
        receiverId: undefined,
        args: undefined,
        deposit: undefined,
        methodName: undefined,
      });
    });
  });

  describe('calculateTotalDeposit', () => {
    it('should sum deposit amounts from multiple actions', () => {
      const actions = [
        { deposit: '1000000000000000000000000' },
        { deposit: '500000000000000000000000' },
        { deposit: '250000000000000000000000' },
      ];

      const result = calculateTotalDeposit(actions);
      expect(result).toBe('1750000000000000000000000');
    });

    it('should handle actions without deposits', () => {
      const actions = [{ deposit: '1000000000000000000000000' }, {}, { deposit: '500000000000000000000000' }];

      const result = calculateTotalDeposit(actions);
      expect(result).toBe('1500000000000000000000000');
    });

    it('should handle undefined actions', () => {
      expect(calculateTotalDeposit()).toBe('0');
    });

    it('should handle empty actions array', () => {
      expect(calculateTotalDeposit([])).toBe('0');
    });

    it('should handle all actions without deposits', () => {
      const actions = [{}, {}, {}];
      expect(calculateTotalDeposit(actions)).toBe('0');
    });

    it('should handle zero deposits', () => {
      const actions = [{ deposit: '0' }, { deposit: '0' }];
      expect(calculateTotalDeposit(actions)).toBe('0');
    });

    it('should handle mixed zero and non-zero deposits', () => {
      const actions = [{ deposit: '0' }, { deposit: '1000000000000000000000000' }, { deposit: '0' }];
      expect(calculateTotalDeposit(actions)).toBe('1000000000000000000000000');
    });
  });

  describe('calculateTotalGasBurnt', () => {
    it('should get tokens_burnt from receipt outcome', () => {
      const receiptOutcome = {
        executor_account_id: 'test.near',
        gas_burnt: '1000000',
        status: true,
        tokens_burnt: '1750000000000000000000',
      };

      const result = calculateTotalGasBurnt(receiptOutcome);
      expect(result).toBe('1750000000000000000000');
    });

    it('should return undefined for undefined receipt outcome', () => {
      expect(calculateTotalGasBurnt()).toBeUndefined();
    });

    it('should handle zero tokens_burnt', () => {
      const receiptOutcome = {
        executor_account_id: 'test.near',
        gas_burnt: '1000000',
        status: true,
        tokens_burnt: '0',
      };
      expect(calculateTotalGasBurnt(receiptOutcome)).toBe('0');
    });
  });

  describe('mapNearBlocksTransaction', () => {
    it('should map complete NearBlocks transaction to normalized format', () => {
      const rawData: NearBlocksTransaction = {
        actions: [
          {
            action: 'TRANSFER',
            deposit: '100000000000000000000',
            method: undefined,
            args: undefined,
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

      const result = mapNearBlocksTransaction(rawData, { providerName: 'nearblocks' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({
          actions: [
            {
              actionType: 'TRANSFER',
              deposit: '100000000000000000000',
              receiverId: undefined,
              args: undefined,
              methodName: undefined,
            },
          ],
          amount: '100000000000000000000',
          blockHeight: 100000,
          currency: 'NEAR',
          feeAmount: '0.005',
          feeCurrency: 'NEAR',
          from: 'alice.near',
          id: 'AbCdEf123456',
          providerName: 'nearblocks',
          status: 'success',
          timestamp: 1640000000000,
          to: 'bob.near',
          type: 'transfer',
        });
      }
    });

    it('should map transaction without optional fields', () => {
      const rawData: NearBlocksTransaction = {
        block_timestamp: '1640000000000000000',
        signer_account_id: 'alice.near',
        receiver_account_id: 'bob.near',
        transaction_hash: 'TxHash123',
      };

      const result = mapNearBlocksTransaction(rawData, { providerName: 'nearblocks' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({
          actions: [],
          amount: '0',
          currency: 'NEAR',
          from: 'alice.near',
          id: 'TxHash123',
          providerName: 'nearblocks',
          status: 'pending',
          timestamp: 1640000000000,
          to: 'bob.near',
          type: 'contract_call',
        });
      }
    });

    it('should map failed transaction', () => {
      const rawData: NearBlocksTransaction = {
        block_timestamp: '1640000000000000000',
        outcomes: {
          status: false,
        },
        signer_account_id: 'alice.near',
        receiver_account_id: 'bob.near',
        transaction_hash: 'FailedTx',
      };

      const result = mapNearBlocksTransaction(rawData, { providerName: 'nearblocks' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.status).toBe('failed');
      }
    });

    it('should not include feeAmount for zero gas', () => {
      const rawData: NearBlocksTransaction = {
        block_timestamp: '1640000000000000000',
        outcomes: {
          status: true,
        },
        signer_account_id: 'alice.near',
        receipt_outcome: {
          executor_account_id: 'bob.near',
          gas_burnt: '0',
          status: true,
          tokens_burnt: '0',
        },
        receiver_account_id: 'bob.near',
        transaction_hash: 'ZeroGasTx',
      };

      const result = mapNearBlocksTransaction(rawData, { providerName: 'nearblocks' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.feeAmount).toBeUndefined();
        expect(result.value.feeCurrency).toBeUndefined();
      }
    });

    it('should handle function call with method', () => {
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

      const result = mapNearBlocksTransaction(rawData, { providerName: 'nearblocks' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.actions?.[0]).toEqual({
          actionType: 'FUNCTION_CALL',
          args: { receiver_id: 'token.near', amount: '1000000' },
          deposit: '1',
          methodName: 'ft_transfer',
          receiverId: undefined,
        });
      }
    });

    it('should handle multiple actions with different deposits', () => {
      const rawData: NearBlocksTransaction = {
        actions: [
          {
            action: 'TRANSFER',
            deposit: '1000000000000000000000000',
            method: undefined,
            args: undefined,
          },
          {
            action: 'TRANSFER',
            deposit: '2000000000000000000000000',
            method: undefined,
            args: undefined,
          },
        ],
        block_timestamp: '1640000000000000000',
        signer_account_id: 'alice.near',
        receiver_account_id: 'bob.near',
        transaction_hash: 'MultiActionTx',
      };

      const result = mapNearBlocksTransaction(rawData, { providerName: 'nearblocks' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.amount).toBe('3000000000000000000000000'); // Sum of deposits
        expect(result.value.actions).toHaveLength(2);
      }
    });

    it('should use custom provider name from sourceContext', () => {
      const rawData: NearBlocksTransaction = {
        block_timestamp: '1640000000000000000',
        signer_account_id: 'alice.near',
        receiver_account_id: 'bob.near',
        transaction_hash: 'CustomProviderTx',
      };

      const result = mapNearBlocksTransaction(rawData, { providerName: 'custom-near-api' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.providerName).toBe('custom-near-api');
      }
    });

    it('should default to nearblocks when provider name not specified', () => {
      const rawData: NearBlocksTransaction = {
        block_timestamp: '1640000000000000000',
        signer_account_id: 'alice.near',
        receiver_account_id: 'bob.near',
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
