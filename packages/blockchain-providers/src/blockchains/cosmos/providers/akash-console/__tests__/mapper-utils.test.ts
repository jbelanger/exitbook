import { describe, expect, it } from 'vitest';

import type { AkashTransactionDetail } from '../akash-console.schemas.js';
import { mapAkashConsoleTransaction } from '../mapper-utils.js';

const userAddress = 'akash1user123456789';

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
              from_address: 'akash1sender123',
              to_address: 'akash1user123456789',
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgSend',
          },
        ],
        signers: ['akash1sender123'],
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
          from: 'akash1sender123',
          gasUsed: 50000,
          gasWanted: 100000,
          id: 'ABC123',
          messageType: '/cosmos.bank.v1beta1.MsgSend',
          providerName: 'akash-console',
          status: 'success',
          timestamp: new Date('2025-01-01T12:00:00.000Z').getTime(),
          to: 'akash1user123456789',
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
              from_address: 'akash1sender123',
              to_address: 'akash1user123456789',
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgSend',
          },
        ],
        signers: ['akash1sender123'],
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
              receiver: 'cosmos1receiver',
              sender: 'akash1user123456789',
              source_channel: 'channel-1',
              source_port: 'transfer',
              token: { amount: '2000000', denom: 'uakt' }, // 2 AKT
            },
            id: 'msg-1',
            type: '/ibc.applications.transfer.v1.MsgTransfer',
          },
        ],
        signers: ['akash1user123456789'],
      };

      const result = mapAkashConsoleTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized).toMatchObject({
          amount: '2',
          bridgeType: 'ibc',
          currency: 'AKT',
          from: 'akash1user123456789',
          sourceChannel: 'channel-1',
          sourcePort: 'transfer',
          status: 'success',
          to: 'cosmos1receiver',
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
                  address: 'akash1user123456789',
                  coins: [{ amount: '3000000', denom: 'uakt' }], // 3 AKT
                },
              ],
              outputs: [
                {
                  address: 'akash1receiver1',
                  coins: [{ amount: '1500000', denom: 'uakt' }],
                },
                {
                  address: 'akash1receiver2',
                  coins: [{ amount: '1500000', denom: 'uakt' }],
                },
              ],
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgMultiSend',
          },
        ],
        signers: ['akash1user123456789'],
      };

      const result = mapAkashConsoleTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized).toMatchObject({
          amount: '3',
          bridgeType: 'native',
          currency: 'AKT',
          from: 'akash1user123456789',
          messageType: '/cosmos.bank.v1beta1.MsgMultiSend',
          status: 'success',
          to: 'akash1receiver1',
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
                  address: 'akash1sender123',
                  coins: [{ amount: '3000000', denom: 'uakt' }],
                },
              ],
              outputs: [
                {
                  address: 'akash1user123456789',
                  coins: [{ amount: '2000000', denom: 'uakt' }], // 2 AKT
                },
                {
                  address: 'akash1other123',
                  coins: [{ amount: '1000000', denom: 'uakt' }],
                },
              ],
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgMultiSend',
          },
        ],
        signers: ['akash1sender123'],
      };

      const result = mapAkashConsoleTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized).toMatchObject({
          amount: '2',
          from: 'akash1sender123',
          to: 'akash1user123456789',
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
              from_address: 'akash1other123',
              to_address: 'akash1another456',
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgSend',
          },
        ],
        signers: ['akash1other123'],
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
              from_address: 'akash1user123456789',
              to_address: 'akash1other123',
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgSend',
          },
        ],
        signers: ['akash1user123456789'],
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
              delegator_address: 'akash1user123456789',
              validator_address: 'akashvaloper1validator',
            },
            id: 'msg-1',
            type: '/cosmos.staking.v1beta1.MsgDelegate',
          },
        ],
        signers: ['akash1user123456789'],
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
              from_address: 'akash1sender123',
              to_address: 'akash1receiver456',
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgSend',
          },
        ],
        signers: ['akash1sender123'],
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
              from_address: 'akash1user123456789',
              to_address: 'akash1receiver456',
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgSend',
          },
        ],
        signers: ['akash1user123456789'],
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
              from_address: 'akash1user123456789',
              to_address: 'akash1receiver456',
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgSend',
          },
        ],
        signers: ['akash1user123456789'],
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
              from_address: 'akash1sender123',
              to_address: 'akash1user123456789',
            },
            id: 'msg-1',
            type: '/cosmos.bank.v1beta1.MsgSend',
          },
        ],
        signers: ['akash1sender123'],
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
