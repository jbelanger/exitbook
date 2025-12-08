import { describe, expect, it } from 'vitest';

import type { InjectiveTransaction } from '../injective-explorer.schemas.js';
import { mapInjectiveExplorerTransaction } from '../mapper-utils.js';

const userAddress = 'inj1user123456789';

describe('injective-explorer mapper-utils', () => {
  describe('mapInjectiveExplorerTransaction', () => {
    it('should map bank send message successfully', () => {
      const rawData: InjectiveTransaction = {
        block_number: 12345,
        block_timestamp: new Date('2025-01-01T12:00:00.000Z'),
        code: 0,
        data: undefined,
        gas_fee: {
          amount: [{ amount: '1000000000000000', denom: 'inj' }],
          gas_limit: 100000,
        },
        gas_used: 50000,
        gas_wanted: 100000,
        hash: '0xabc123',
        messages: [
          {
            type: '/cosmos.bank.v1beta1.MsgSend',
            value: {
              amount: [{ amount: '5000000000000000000', denom: 'inj' }],
              from_address: 'inj1sender123',
              to_address: 'inj1user123456789',
            },
          },
        ],
        tx_type: 'bank',
      };

      const result = mapInjectiveExplorerTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized).toMatchObject({
          id: '0xabc123',
          amount: '5',
          from: 'inj1sender123',
          to: 'inj1user123456789',
          currency: 'INJ',
          tokenType: 'native',
          tokenSymbol: 'INJ',
          bridgeType: 'native',
          status: 'success',
          blockHeight: 12345,
          timestamp: new Date('2025-01-01T12:00:00.000Z').getTime(),
          feeAmount: '0.001',
          feeCurrency: 'INJ',
          gasUsed: 50000,
          gasWanted: 100000,
          providerName: 'injective-explorer',
          messageType: '/cosmos.bank.v1beta1.MsgSend',
        });
      }
    });

    it('should map IBC transfer message successfully', () => {
      const rawData: InjectiveTransaction = {
        block_number: 12345,
        block_timestamp: new Date('2025-01-01T12:00:00.000Z'),
        code: 0,
        data: undefined,
        gas_fee: {
          amount: [{ amount: '500000000000000', denom: 'inj' }],
          gas_limit: 200000,
        },
        gas_used: 150000,
        gas_wanted: 200000,
        hash: '0xdef456',
        messages: [
          {
            type: '/ibc.applications.transfer.v1.MsgTransfer',
            value: {
              receiver: 'cosmos1receiver',
              sender: 'inj1user123456789',
              source_channel: 'channel-1',
              source_port: 'transfer',
              token: { amount: '1000000000000000000', denom: 'usdc' },
            },
          },
        ],
        tx_type: 'ibc',
      };

      const result = mapInjectiveExplorerTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized).toMatchObject({
          amount: '1',
          from: 'inj1user123456789',
          to: 'cosmos1receiver',
          currency: 'USDC',
          tokenType: 'ibc',
          bridgeType: 'ibc',
          sourceChannel: 'channel-1',
          sourcePort: 'transfer',
          status: 'success',
        });
      }
    });

    it('should map Peggy deposit message with event nonce', () => {
      const rawData: InjectiveTransaction = {
        block_number: 54321,
        block_timestamp: new Date('2025-02-01T12:00:00.000Z'),
        claim_id: [100, 200],
        code: 0,
        data: undefined,
        gas_fee: {
          amount: [{ amount: '2000000000000000', denom: 'inj' }],
          gas_limit: 300000,
        },
        gas_used: 250000,
        gas_wanted: 300000,
        hash: '0xpeggy123',
        messages: [
          {
            type: '/injective.peggy.v1.MsgDepositClaim',
            value: {
              amount: '1000000000000000000',
              cosmos_receiver: 'inj1user123456789',
              ethereum_receiver: '0xethReceiver',
              ethereum_sender: '0xeth123',
              event_nonce: '12345',
              token_contract: '0xtoken123',
            },
          },
        ],
        tx_type: 'peggy',
      };

      const result = mapInjectiveExplorerTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.id).toBe('peggy-deposit-12345');
        expect(normalized).toMatchObject({
          amount: '1',
          currency: 'INJ',
          bridgeType: 'peggy',
          ethereumSender: '0xeth123',
          ethereumReceiver: '0xethreceiver',
          eventNonce: '12345',
          tokenAddress: '0xtoken123',
        });
      }
    });

    it('should use claim_id when event_nonce is missing', () => {
      const rawData: InjectiveTransaction = {
        block_number: 54321,
        block_timestamp: new Date('2025-02-01T12:00:00.000Z'),
        claim_id: [999],
        code: 0,
        data: undefined,
        gas_fee: {
          amount: [{ amount: '1000000000000000', denom: 'inj' }],
          gas_limit: 100000,
        },
        gas_used: 80000,
        gas_wanted: 100000,
        hash: '0xpeggy456',
        messages: [
          {
            type: '/injective.peggy.v1.MsgDepositClaim',
            value: {
              amount: {
                amount: '500000000000000000',
                denom: 'inj',
              },
              cosmos_receiver: 'inj1user123456789',
              ethereum_sender: '0xeth456',
            },
          },
        ],
        tx_type: 'peggy',
      };

      const result = mapInjectiveExplorerTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.id).toBe('peggy-deposit-999');
      }
    });

    it('should map Peggy withdrawal message', () => {
      const rawData: InjectiveTransaction = {
        block_number: 67890,
        block_timestamp: new Date('2025-03-01T12:00:00.000Z'),
        code: 0,
        data: undefined,
        gas_fee: {
          amount: [{ amount: '3000000000000000', denom: 'inj' }],
          gas_limit: 400000,
        },
        gas_used: 350000,
        gas_wanted: 400000,
        hash: '0xwithdrawal123',
        messages: [
          {
            type: '/injective.peggy.v1.MsgSendToEth',
            value: {
              amount: { amount: '2000000000000000000', denom: 'inj' },
              bridge_fee: { amount: '10000000000000000', denom: 'inj' },
              eth_dest: '0xethReceiver',
              sender: 'inj1user123456789',
            },
          },
        ],
        tx_type: 'peggy',
      };

      const result = mapInjectiveExplorerTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized).toMatchObject({
          amount: '2',
          from: 'inj1user123456789',
          to: '0xethreceiver',
          currency: 'INJ',
          bridgeType: 'peggy',
          ethereumReceiver: '0xethreceiver',
        });
      }
    });

    it('should skip transaction not relevant to address', () => {
      const rawData: InjectiveTransaction = {
        block_number: 12345,
        block_timestamp: new Date('2025-01-01T12:00:00.000Z'),
        code: 0,
        data: undefined,
        gas_fee: {
          amount: [{ amount: '1000000000000000', denom: 'inj' }],
          gas_limit: 100000,
        },
        gas_used: 50000,
        gas_wanted: 100000,
        hash: '0xabc789',
        messages: [
          {
            type: '/cosmos.bank.v1beta1.MsgSend',
            value: {
              amount: [{ amount: '5000000000000000000', denom: 'inj' }],
              from_address: 'inj1other123',
              to_address: 'inj1another456',
            },
          },
        ],
        tx_type: 'bank',
      };

      const result = mapInjectiveExplorerTransaction(rawData, userAddress);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('skip');
        if (result.error.type === 'skip') {
          expect(result.error.reason).toContain('not relevant');
        }
      }
    });

    it('should skip transaction with zero amount', () => {
      const rawData: InjectiveTransaction = {
        block_number: 12345,
        block_timestamp: new Date('2025-01-01T12:00:00.000Z'),
        code: 0,
        data: undefined,
        gas_fee: {
          amount: [{ amount: '1000000000000000', denom: 'inj' }],
          gas_limit: 100000,
        },
        gas_used: 50000,
        gas_wanted: 100000,
        hash: '0xzero123',
        messages: [
          {
            type: '/cosmos.bank.v1beta1.MsgSend',
            value: {
              amount: [{ amount: '0', denom: 'inj' }],
              from_address: 'inj1user123456789',
              to_address: 'inj1other123',
            },
          },
        ],
        tx_type: 'bank',
      };

      const result = mapInjectiveExplorerTransaction(rawData, userAddress);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('skip');
      }
    });

    it('should skip unsupported message types', () => {
      const rawData: InjectiveTransaction = {
        block_number: 12345,
        block_timestamp: new Date('2025-01-01T12:00:00.000Z'),
        code: 0,
        data: undefined,
        gas_fee: {
          amount: [{ amount: '1000000000000000', denom: 'inj' }],
          gas_limit: 100000,
        },
        gas_used: 50000,
        gas_wanted: 100000,
        hash: '0xunsupported123',
        messages: [
          {
            type: '/cosmos.staking.v1beta1.MsgDelegate',
            value: {},
          },
        ],
        tx_type: 'staking',
      };

      const result = mapInjectiveExplorerTransaction(rawData, userAddress);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('skip');
        if (result.error.type === 'skip') {
          expect(result.error.reason).toContain('Unsupported message type');
        }
      }
    });

    it('should return error when address is missing from context', () => {
      const rawData: InjectiveTransaction = {
        block_number: 12345,
        block_timestamp: new Date('2025-01-01T12:00:00.000Z'),
        code: 0,
        data: undefined,
        gas_fee: {
          amount: [{ amount: '1000000000000000', denom: 'inj' }],
          gas_limit: 100000,
        },
        gas_used: 50000,
        gas_wanted: 100000,
        hash: '0xnoaddress',
        messages: [
          {
            type: '/cosmos.bank.v1beta1.MsgSend',
            value: {
              amount: [{ amount: '5000000000000000000', denom: 'inj' }],
              from_address: 'inj1sender123',
              to_address: 'inj1receiver456',
            },
          },
        ],
        tx_type: 'bank',
      };

      const result = mapInjectiveExplorerTransaction(rawData, '');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('error');
        if (result.error.type === 'error') {
          expect(result.error.message).toBe('Invalid address');
        }
      }
    });

    it('should handle failed transactions', () => {
      const rawData: InjectiveTransaction = {
        block_number: 12345,
        block_timestamp: new Date('2025-01-01T12:00:00.000Z'),
        code: 5,
        data: undefined,
        gas_fee: {
          amount: [{ amount: '1000000000000000', denom: 'inj' }],
          gas_limit: 100000,
        },
        gas_used: 100000,
        gas_wanted: 100000,
        hash: '0xfailed123',
        messages: [
          {
            type: '/cosmos.bank.v1beta1.MsgSend',
            value: {
              amount: [{ amount: '5000000000000000000', denom: 'inj' }],
              from_address: 'inj1user123456789',
              to_address: 'inj1receiver456',
            },
          },
        ],
        tx_type: 'bank',
      };

      const result = mapInjectiveExplorerTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.status).toBe('failed');
      }
    });

    it('should handle transactions with memo', () => {
      const rawData: InjectiveTransaction = {
        block_number: 12345,
        block_timestamp: new Date('2025-01-01T12:00:00.000Z'),
        code: 0,
        data: undefined,
        gas_fee: {
          amount: [{ amount: '1000000000000000', denom: 'inj' }],
          gas_limit: 100000,
        },
        gas_used: 50000,
        gas_wanted: 100000,
        hash: '0xmemo123',
        memo: 'Test memo',
        messages: [
          {
            type: '/cosmos.bank.v1beta1.MsgSend',
            value: {
              amount: [{ amount: '5000000000000000000', denom: 'inj' }],
              from_address: 'inj1user123456789',
              to_address: 'inj1receiver456',
            },
          },
        ],
        tx_type: 'bank',
      };

      const result = mapInjectiveExplorerTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.memo).toBe('Test memo');
      }
    });

    it('should skip CosmWasm execution when sender is not the relevant address', () => {
      const rawData: InjectiveTransaction = {
        block_number: 12345,
        block_timestamp: new Date('2025-01-01T12:00:00.000Z'),
        code: 0,
        data: undefined,
        gas_fee: {
          amount: [{ amount: '1000000000000000', denom: 'inj' }],
          gas_limit: 100000,
        },
        gas_used: 50000,
        gas_wanted: 100000,
        hash: '0xwasm123',
        messages: [
          {
            type: '/cosmwasm.wasm.v1.MsgExecuteContract',
            value: {
              contract: 'inj1contract123',
              funds: [{ amount: '1000000', denom: 'usdc' }],
              msg: { transfer: { amount: '1000000', recipient: 'inj1receiver' } },
              sender: 'inj1other123',
            },
          },
        ],
        tx_type: 'contract',
      };

      const result = mapInjectiveExplorerTransaction(rawData, userAddress);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('skip');
        if (result.error.type === 'skip') {
          expect(result.error.reason).toContain('Contract execution not relevant');
        }
      }
    });

    it('should handle zero fees', () => {
      const rawData: InjectiveTransaction = {
        block_number: 12345,
        block_timestamp: new Date('2025-01-01T12:00:00.000Z'),
        code: 0,
        data: undefined,
        gas_fee: {
          amount: [{ amount: '0', denom: 'inj' }],
          gas_limit: 100000,
        },
        gas_used: 50000,
        gas_wanted: 100000,
        hash: '0xzerofee',
        messages: [
          {
            type: '/cosmos.bank.v1beta1.MsgSend',
            value: {
              amount: [{ amount: '5000000000000000000', denom: 'inj' }],
              from_address: 'inj1sender123',
              to_address: 'inj1user123456789',
            },
          },
        ],
        tx_type: 'bank',
      };

      const result = mapInjectiveExplorerTransaction(rawData, userAddress);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.feeAmount).toBeUndefined();
        expect(result.value.feeCurrency).toBeUndefined();
      }
    });
  });
});
