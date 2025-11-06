import { describe, expect, it } from 'vitest';

import {
  calculateTotalDeposit,
  calculateTotalGasBurnt,
  determineTransactionStatus,
  mapNearBlocksActions,
  mapNearBlocksTransaction,
  parseNearBlocksTimestamp,
  yoctoNearToNearString,
} from '../mapper-utils.js';
import type { NearBlocksTransaction } from '../nearblocks/nearblocks.schemas.js';

describe('mapper-utils', () => {
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
    it('should convert nanoseconds to seconds (Unix timestamp)', () => {
      // 1 second in nanoseconds = 1,000,000,000
      expect(parseNearBlocksTimestamp('1000000000')).toBe(1);
      // 1 millisecond in nanoseconds = 1,000,000 (rounds to 0 seconds)
      expect(parseNearBlocksTimestamp('1000000')).toBe(0);
    });

    it('should handle real NearBlocks timestamps', () => {
      // Real NearBlocks timestamp: 1640000000000000000 (nanoseconds)
      // Expected: 1640000000 (Unix timestamp in seconds - December 20, 2021)
      expect(parseNearBlocksTimestamp('1640000000000000000')).toBe(1640000000);
      expect(parseNearBlocksTimestamp('1700000000000000000')).toBe(1700000000);
    });

    it('should handle zero timestamp', () => {
      expect(parseNearBlocksTimestamp('0')).toBe(0);
    });

    it('should handle very large timestamps', () => {
      // Future timestamp
      expect(parseNearBlocksTimestamp('2000000000000000000')).toBe(2000000000);
    });

    it('should round to nearest second', () => {
      // 1.5 seconds in nanoseconds = 1,500,000,000
      expect(parseNearBlocksTimestamp('1500000000')).toBe(2);
      // 1.4 seconds in nanoseconds = 1,400,000,000
      expect(parseNearBlocksTimestamp('1400000000')).toBe(1);
    });
  });

  describe('determineTransactionStatus', () => {
    it('should return "pending" when outcomes is undefined', () => {
      expect(determineTransactionStatus()).toBe('pending');
    });

    it('should return "pending" when outcomes is empty', () => {
      expect(determineTransactionStatus({})).toBe('pending');
    });

    it('should return "success" when all outcomes have status true', () => {
      const outcomes = {
        receipt1: { status: true },
        receipt2: { status: true },
      };
      expect(determineTransactionStatus(outcomes)).toBe('success');
    });

    it('should return "failed" when any outcome has status false', () => {
      const outcomes = {
        receipt1: { status: true },
        receipt2: { status: false },
      };
      expect(determineTransactionStatus(outcomes)).toBe('failed');
    });

    it('should return "success" when status is object with SuccessValue', () => {
      const outcomes = {
        receipt1: { status: { SuccessValue: '' } },
      };
      expect(determineTransactionStatus(outcomes)).toBe('success');
    });

    it('should return "failed" when status is object with Failure', () => {
      const outcomes = {
        receipt1: { status: { Failure: { ActionError: 'some error' } } },
      };
      expect(determineTransactionStatus(outcomes)).toBe('failed');
    });

    it('should return "failed" if any outcome fails in mixed status types', () => {
      const outcomes = {
        receipt1: { status: true },
        receipt2: { status: { SuccessValue: '' } },
        receipt3: { status: { Failure: 'error' } },
      };
      expect(determineTransactionStatus(outcomes)).toBe('failed');
    });

    it('should return "success" for all successful mixed status types', () => {
      const outcomes = {
        receipt1: { status: true },
        receipt2: { status: { SuccessValue: 'value' } },
        receipt3: { status: { SuccessReceiptId: 'id' } },
      };
      expect(determineTransactionStatus(outcomes)).toBe('success');
    });
  });

  describe('mapNearBlocksActions', () => {
    it('should map NearBlocks actions to normalized format', () => {
      const actions = [
        {
          action: 'TRANSFER',
          deposit: '1000000000000000000000000',
          from: 'alice.near',
          to: 'bob.near',
        },
        {
          action: 'FUNCTION_CALL',
          args: { method: 'transfer', amount: '100' },
          deposit: '0',
          from: 'alice.near',
          method: 'ft_transfer',
          to: 'token.near',
        },
      ];

      const result = mapNearBlocksActions(actions);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        actionType: 'TRANSFER',
        deposit: '1000000000000000000000000',
        receiverId: 'bob.near',
        args: undefined,
        methodName: undefined,
      });
      expect(result[1]).toEqual({
        actionType: 'FUNCTION_CALL',
        args: { method: 'transfer', amount: '100' },
        deposit: '0',
        methodName: 'ft_transfer',
        receiverId: 'token.near',
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
          from: 'alice.near',
          to: 'validator.near',
        },
      ];

      const result = mapNearBlocksActions(actions);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        actionType: 'STAKE',
        receiverId: 'validator.near',
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
    it('should sum tokens_burnt from outcomes', () => {
      const outcomes = {
        receipt1: { tokens_burnt: '1000000000000000000000' },
        receipt2: { tokens_burnt: '500000000000000000000' },
        receipt3: { tokens_burnt: '250000000000000000000' },
      };

      const result = calculateTotalGasBurnt(outcomes);
      expect(result).toBe('1750000000000000000000');
    });

    it('should handle outcomes without tokens_burnt', () => {
      const outcomes = {
        receipt1: { tokens_burnt: '1000000000000000000000' },
        receipt2: {},
        receipt3: { tokens_burnt: '500000000000000000000' },
      };

      const result = calculateTotalGasBurnt(outcomes);
      expect(result).toBe('1500000000000000000000');
    });

    it('should return undefined for undefined outcomes', () => {
      expect(calculateTotalGasBurnt()).toBeUndefined();
    });

    it('should return undefined for empty outcomes', () => {
      expect(calculateTotalGasBurnt({})).toBeUndefined();
    });

    it('should handle all outcomes without tokens_burnt', () => {
      const outcomes = {
        receipt1: {},
        receipt2: {},
      };
      expect(calculateTotalGasBurnt(outcomes)).toBe('0');
    });

    it('should handle zero tokens_burnt', () => {
      const outcomes = {
        receipt1: { tokens_burnt: '0' },
        receipt2: { tokens_burnt: '0' },
      };
      expect(calculateTotalGasBurnt(outcomes)).toBe('0');
    });

    it('should handle gas_burnt field (even though we only use tokens_burnt)', () => {
      const outcomes = {
        receipt1: { gas_burnt: 1000000, tokens_burnt: '1000000000000000000000' },
        receipt2: { gas_burnt: 500000, tokens_burnt: '500000000000000000000' },
      };

      const result = calculateTotalGasBurnt(outcomes);
      expect(result).toBe('1500000000000000000000');
    });
  });

  describe('mapNearBlocksTransaction', () => {
    it('should map complete NearBlocks transaction to normalized format', () => {
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
          receipt1: {
            status: true,
            tokens_burnt: '5000000000000000000000',
          },
        },
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
        transaction_hash: 'AbCdEf123456',
      };

      const result = mapNearBlocksTransaction(rawData, { providerName: 'nearblocks' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({
          actions: [
            {
              actionType: 'TRANSFER',
              deposit: '1000000000000000000000000',
              receiverId: 'bob.near',
              args: undefined,
              methodName: undefined,
            },
          ],
          amount: '1000000000000000000000000',
          blockHeight: 100000,
          currency: 'NEAR',
          feeAmount: '0.005',
          feeCurrency: 'NEAR',
          from: 'alice.near',
          id: 'AbCdEf123456',
          providerName: 'nearblocks',
          status: 'success',
          timestamp: 1640000000,
          to: 'bob.near',
        });
      }
    });

    it('should map transaction without optional fields', () => {
      const rawData: NearBlocksTransaction = {
        block_timestamp: '1640000000000000000',
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
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
          timestamp: 1640000000,
          to: 'bob.near',
        });
      }
    });

    it('should map failed transaction', () => {
      const rawData: NearBlocksTransaction = {
        block_timestamp: '1640000000000000000',
        outcomes: {
          receipt1: {
            status: { Failure: { ActionError: 'Insufficient balance' } },
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

    it('should not include feeAmount for zero gas', () => {
      const rawData: NearBlocksTransaction = {
        block_timestamp: '1640000000000000000',
        outcomes: {
          receipt1: {
            status: true,
            tokens_burnt: '0',
          },
        },
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
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
            from: 'alice.near',
            method: 'ft_transfer',
            to: 'usdt.tether-token.near',
          },
        ],
        block_height: 100001,
        block_timestamp: '1640000001000000000',
        outcomes: {
          receipt1: {
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
        expect(result.value.actions?.[0]).toEqual({
          actionType: 'FUNCTION_CALL',
          args: { receiver_id: 'token.near', amount: '1000000' },
          deposit: '1',
          methodName: 'ft_transfer',
          receiverId: 'usdt.tether-token.near',
        });
      }
    });

    it('should handle multiple actions with different deposits', () => {
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
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
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
        receiver_id: 'bob.near',
        signer_id: 'alice.near',
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
