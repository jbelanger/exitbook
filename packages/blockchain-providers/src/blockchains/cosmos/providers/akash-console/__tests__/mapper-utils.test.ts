import { describe, expect, it } from 'vitest';

import { mapAkashConsoleTransaction } from '../akash-console.mapper-utils.js';
import type { AkashTransactionDetail } from '../akash-console.schemas.js';

const AKASH_USER = 'akash1qyqszqgpqyqszqgpqyqszqgpqyqszqgplgve5x';
const AKASH_SENDER = 'akash1qgpqyqszqgpqyqszqgpqyqszqgpqyqszwv2uls';
const AKASH_RECEIVER_1 = 'akash1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcr0uta43';
const AKASH_RECEIVER_2 = 'akash1qszqgpqyqszqgpqyqszqgpqyqszqgpqy0vvcjd';
const AKASH_OTHER = 'akash1q5zs2pg9q5zs2pg9q5zs2pg9q5zs2pg9wudecv';
const COSMOS_RECEIVER = 'cosmos1qyqszqgpqyqszqgpqyqszqgpqyqszqgpjnp7du';

const userAddress = AKASH_USER;

describe('akash-console mapper-utils', () => {
  describe('mapAkashConsoleTransaction', () => {
    it('should map bank send message successfully with 6 decimals', () => {
      const rawData: AkashTransactionDetail = {
        datetime: '2025-01-01T12:00:00.000Z',
        error: undefined,
        fee: 5000, // 0.005 AKT in uakt (6 decimals)
        gasUsed: 50000,
        gasWanted: 100000,
        hash: 'ABC123',
        height: 12345,
        isSuccess: true,
        memo: '',
        messages: [
          {
            data: {
              amount: [{ amount: '5000000', denom: 'uakt' }], // 5 AKT in uakt
              from_address: AKASH_SENDER,
              to_address: AKASH_USER,
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgSend',
          },
        ],
        signers: [AKASH_SENDER],
      };

      const result = mapAkashConsoleTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized).toMatchObject({
          amount: '5',
          bridgeType: 'native',
          blockHeight: 12345,
          currency: 'AKT',
          feeAmount: '0.005',
          feeCurrency: 'AKT',
          from: AKASH_SENDER,
          gasUsed: 50000,
          gasWanted: 100000,
          id: 'ABC123',
          messageType: '/cosmos.bank.v1beta1.MsgSend',
          providerName: 'akash-console',
          status: 'success',
          timestamp: new Date('2025-01-01T12:00:00.000Z').getTime(),
          to: AKASH_USER,
          tokenSymbol: 'AKT',
          tokenType: 'native',
        });
      }
    });

    it('should correctly convert amounts using 6 decimals', () => {
      const rawData: AkashTransactionDetail = {
        datetime: '2025-01-01T12:00:00.000Z',
        error: undefined,
        fee: 1000000, // 1 AKT
        gasUsed: 50000,
        gasWanted: 100000,
        hash: 'DECIMAL_TEST',
        height: 12345,
        isSuccess: true,
        memo: '',
        messages: [
          {
            data: {
              amount: [{ amount: '1000000', denom: 'uakt' }], // 1 AKT
              from_address: AKASH_SENDER,
              to_address: AKASH_USER,
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgSend',
          },
        ],
        signers: [AKASH_SENDER],
      };

      const result = mapAkashConsoleTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.amount).toBe('1');
        expect(normalized.feeAmount).toBe('1');
      }
    });

    it('should map IBC transfer message successfully', () => {
      const rawData: AkashTransactionDetail = {
        datetime: '2025-01-01T12:00:00.000Z',
        error: undefined,
        fee: 10000,
        gasUsed: 150000,
        gasWanted: 200000,
        hash: 'IBC123',
        height: 12345,
        isSuccess: true,
        memo: '',
        messages: [
          {
            data: {
              receiver: COSMOS_RECEIVER,
              sender: AKASH_USER,
              source_channel: 'channel-1',
              source_port: 'transfer',
              token: { amount: '2000000', denom: 'uakt' }, // 2 AKT
            },
            id: 'msg-1',
            type: '/ibc.applications.transfer.v1.MsgTransfer',
          },
        ],
        signers: [AKASH_USER],
      };

      const result = mapAkashConsoleTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized).toMatchObject({
          amount: '2',
          bridgeType: 'ibc',
          currency: 'AKT',
          from: AKASH_USER,
          sourceChannel: 'channel-1',
          sourcePort: 'transfer',
          status: 'success',
          to: COSMOS_RECEIVER,
          tokenType: 'ibc',
        });
      }
    });

    it('should map bank multi-send message when user is sender', () => {
      const rawData: AkashTransactionDetail = {
        datetime: '2025-01-01T12:00:00.000Z',
        error: undefined,
        fee: 7500,
        gasUsed: 80000,
        gasWanted: 120000,
        hash: 'MULTISEND123',
        height: 12345,
        isSuccess: true,
        memo: '',
        messages: [
          {
            data: {
              inputs: [
                {
                  address: AKASH_USER,
                  coins: [{ amount: '3000000', denom: 'uakt' }], // 3 AKT
                },
              ],
              outputs: [
                {
                  address: AKASH_RECEIVER_1,
                  coins: [{ amount: '1500000', denom: 'uakt' }],
                },
                {
                  address: AKASH_RECEIVER_2,
                  coins: [{ amount: '1500000', denom: 'uakt' }],
                },
              ],
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgMultiSend',
          },
        ],
        signers: [AKASH_USER],
      };

      const result = mapAkashConsoleTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized).toMatchObject({
          amount: '3',
          bridgeType: 'native',
          currency: 'AKT',
          from: AKASH_USER,
          messageType: '/cosmos.bank.v1beta1.MsgMultiSend',
          status: 'success',
          to: AKASH_RECEIVER_1,
          tokenType: 'native',
        });
      }
    });

    it('should map bank multi-send message when user is receiver', () => {
      const rawData: AkashTransactionDetail = {
        datetime: '2025-01-01T12:00:00.000Z',
        error: undefined,
        fee: 7500,
        gasUsed: 80000,
        gasWanted: 120000,
        hash: 'MULTISEND456',
        height: 12345,
        isSuccess: true,
        memo: '',
        messages: [
          {
            data: {
              inputs: [
                {
                  address: AKASH_SENDER,
                  coins: [{ amount: '3000000', denom: 'uakt' }],
                },
              ],
              outputs: [
                {
                  address: AKASH_USER,
                  coins: [{ amount: '2000000', denom: 'uakt' }], // 2 AKT
                },
                {
                  address: AKASH_OTHER,
                  coins: [{ amount: '1000000', denom: 'uakt' }],
                },
              ],
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgMultiSend',
          },
        ],
        signers: [AKASH_SENDER],
      };

      const result = mapAkashConsoleTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized).toMatchObject({
          amount: '2',
          from: AKASH_SENDER,
          to: AKASH_USER,
        });
      }
    });

    it('should skip transaction not relevant to address', () => {
      const rawData: AkashTransactionDetail = {
        datetime: '2025-01-01T12:00:00.000Z',
        error: undefined,
        fee: 5000,
        gasUsed: 50000,
        gasWanted: 100000,
        hash: 'SKIP123',
        height: 12345,
        isSuccess: true,
        memo: '',
        messages: [
          {
            data: {
              amount: [{ amount: '5000000', denom: 'uakt' }],
              from_address: AKASH_OTHER,
              to_address: AKASH_RECEIVER_2,
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgSend',
          },
        ],
        signers: [AKASH_OTHER],
      };

      const result = mapAkashConsoleTransaction(rawData, userAddress);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('skip');
        if (result.error.type === 'skip') {
          expect(result.error.reason).toContain('No relevant transfer messages found');
        }
      }
    });

    it('should skip transaction with zero amount', () => {
      const rawData: AkashTransactionDetail = {
        datetime: '2025-01-01T12:00:00.000Z',
        error: undefined,
        fee: 5000,
        gasUsed: 50000,
        gasWanted: 100000,
        hash: 'ZERO123',
        height: 12345,
        isSuccess: true,
        memo: '',
        messages: [
          {
            data: {
              amount: [{ amount: '0', denom: 'uakt' }],
              from_address: AKASH_USER,
              to_address: AKASH_OTHER,
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgSend',
          },
        ],
        signers: [AKASH_USER],
      };

      const result = mapAkashConsoleTransaction(rawData, userAddress);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('skip');
      }
    });

    it('should skip unsupported message types', () => {
      const rawData: AkashTransactionDetail = {
        datetime: '2025-01-01T12:00:00.000Z',
        error: undefined,
        fee: 5000,
        gasUsed: 50000,
        gasWanted: 100000,
        hash: 'UNSUPPORTED123',
        height: 12345,
        isSuccess: true,
        memo: '',
        messages: [
          {
            data: {
              delegator_address: AKASH_USER,
              validator_address: 'akashvaloper1validator',
            },
            id: 'msg-1',
            type: '/cosmos.staking.v1beta1.MsgDelegate',
          },
        ],
        signers: [AKASH_USER],
      };

      const result = mapAkashConsoleTransaction(rawData, userAddress);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('skip');
        if (result.error.type === 'skip') {
          expect(result.error.reason).toContain('No relevant transfer messages found');
        }
      }
    });

    it('should return error when address is missing', () => {
      const rawData: AkashTransactionDetail = {
        datetime: '2025-01-01T12:00:00.000Z',
        error: undefined,
        fee: 5000,
        gasUsed: 50000,
        gasWanted: 100000,
        hash: 'NOADDRESS',
        height: 12345,
        isSuccess: true,
        memo: '',
        messages: [
          {
            data: {
              amount: [{ amount: '5000000', denom: 'uakt' }],
              from_address: AKASH_SENDER,
              to_address: AKASH_RECEIVER_1,
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgSend',
          },
        ],
        signers: [AKASH_SENDER],
      };

      const result = mapAkashConsoleTransaction(rawData, '');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('error');
        if (result.error.type === 'error') {
          expect(result.error.message).toBe('Invalid address');
        }
      }
    });

    it('should handle failed transactions', () => {
      const rawData: AkashTransactionDetail = {
        datetime: '2025-01-01T12:00:00.000Z',
        error: 'insufficient funds',
        fee: 5000,
        gasUsed: 100000,
        gasWanted: 100000,
        hash: 'FAILED123',
        height: 12345,
        isSuccess: false,
        memo: '',
        messages: [
          {
            data: {
              amount: [{ amount: '5000000', denom: 'uakt' }],
              from_address: AKASH_USER,
              to_address: AKASH_RECEIVER_1,
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgSend',
          },
        ],
        signers: [AKASH_USER],
      };

      const result = mapAkashConsoleTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.status).toBe('failed');
      }
    });

    it('should handle transactions with memo', () => {
      const rawData: AkashTransactionDetail = {
        datetime: '2025-01-01T12:00:00.000Z',
        error: undefined,
        fee: 5000,
        gasUsed: 50000,
        gasWanted: 100000,
        hash: 'MEMO123',
        height: 12345,
        isSuccess: true,
        memo: 'Test payment memo',
        messages: [
          {
            data: {
              amount: [{ amount: '5000000', denom: 'uakt' }],
              from_address: AKASH_USER,
              to_address: AKASH_RECEIVER_1,
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgSend',
          },
        ],
        signers: [AKASH_USER],
      };

      const result = mapAkashConsoleTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.memo).toBe('Test payment memo');
      }
    });

    it('should handle zero fees', () => {
      const rawData: AkashTransactionDetail = {
        datetime: '2025-01-01T12:00:00.000Z',
        error: undefined,
        fee: 0,
        gasUsed: 50000,
        gasWanted: 100000,
        hash: 'ZEROFEE',
        height: 12345,
        isSuccess: true,
        memo: '',
        messages: [
          {
            data: {
              amount: [{ amount: '5000000', denom: 'uakt' }],
              from_address: AKASH_SENDER,
              to_address: AKASH_USER,
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgSend',
          },
        ],
        signers: [AKASH_SENDER],
      };

      const result = mapAkashConsoleTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.feeAmount).toBeUndefined();
        expect(result.value.feeCurrency).toBeUndefined();
      }
    });
  });
});
