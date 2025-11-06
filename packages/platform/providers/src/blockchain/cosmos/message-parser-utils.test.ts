import { describe, expect, it } from 'vitest';

import {
  parseBankSendMessage,
  parseCosmwasmExecuteMessage,
  parseIbcTransferMessage,
  parsePeggyDepositClaimMessage,
  parsePeggySendToEthMessage,
  parseWasmxExecuteMessage,
  shouldSkipMessage,
} from './message-parser-utils.js';
import type { InjectiveMessage } from './providers/injective-explorer/injective-explorer.schemas.js';

describe('message-parser-utils', () => {
  describe('shouldSkipMessage', () => {
    it('should skip Injective DEX operations', () => {
      const result = shouldSkipMessage('/injective.exchange.v1.MsgDeposit');
      expect(result).toContain('Injective DEX operation');
      expect(result).toContain('not an asset transfer');
    });

    it('should skip Injective oracle operations', () => {
      const result = shouldSkipMessage('/injective.oracle.v1.MsgRelayPriceFeedPrice');
      expect(result).toContain('Injective oracle operation');
      expect(result).toContain('not an asset transfer');
    });

    it('should skip governance vote messages', () => {
      const result = shouldSkipMessage('/cosmos.gov.v1beta1.MsgVote');
      expect(result).toContain('Governance/authz operation');
    });

    it('should skip weighted vote messages', () => {
      const result = shouldSkipMessage('/cosmos.gov.v1beta1.MsgVoteWeighted');
      expect(result).toContain('Governance/authz operation');
    });

    it('should skip authz grant messages', () => {
      const result = shouldSkipMessage('/cosmos.authz.v1beta1.MsgGrant');
      expect(result).toContain('Governance/authz operation');
    });

    it('should skip authz revoke messages', () => {
      const result = shouldSkipMessage('/cosmos.authz.v1beta1.MsgRevoke');
      expect(result).toContain('Governance/authz operation');
    });

    it('should skip slashing unjail messages', () => {
      const result = shouldSkipMessage('/cosmos.slashing.v1beta1.MsgUnjail');
      expect(result).toContain('Governance/authz operation');
    });

    it('should not skip bank send messages', () => {
      const result = shouldSkipMessage('/cosmos.bank.v1beta1.MsgSend');
      expect(result).toBeUndefined();
    });

    it('should not skip IBC transfer messages', () => {
      const result = shouldSkipMessage('/ibc.applications.transfer.v1.MsgTransfer');
      expect(result).toBeUndefined();
    });
  });

  describe('parseBankSendMessage', () => {
    it('should parse valid bank send message', () => {
      const message: InjectiveMessage = {
        type: '/cosmos.bank.v1beta1.MsgSend',
        value: {
          from_address: 'inj1abc',
          to_address: 'inj1xyz',
          amount: [{ amount: '1000000000000000000', denom: 'inj' }],
        },
      };

      const result = parseBankSendMessage(message);

      expect(result).toEqual({
        from: 'inj1abc',
        to: 'inj1xyz',
        amount: '1',
        currency: 'inj',
        tokenType: 'native',
        tokenSymbol: 'inj',
      });
    });

    it('should return undefined for non-bank-send messages', () => {
      const message: InjectiveMessage = {
        type: '/ibc.applications.transfer.v1.MsgTransfer',
        value: {},
      };

      const result = parseBankSendMessage(message);
      expect(result).toBeUndefined();
    });

    it('should return undefined when amount array is empty', () => {
      const message: InjectiveMessage = {
        type: '/cosmos.bank.v1beta1.MsgSend',
        value: {
          from_address: 'inj1abc',
          to_address: 'inj1xyz',
          amount: [],
        },
      };

      const result = parseBankSendMessage(message);
      expect(result).toBeUndefined();
    });

    it('should handle missing addresses', () => {
      const message: InjectiveMessage = {
        type: '/cosmos.bank.v1beta1.MsgSend',
        value: {
          amount: [{ amount: '1000000000000000000', denom: 'inj' }],
        },
      };

      const result = parseBankSendMessage(message);

      expect(result).toEqual({
        from: '',
        to: '',
        amount: '1',
        currency: 'inj',
        tokenType: 'native',
        tokenSymbol: 'inj',
      });
    });
  });

  describe('parseIbcTransferMessage', () => {
    it('should parse valid IBC transfer message', () => {
      const message: InjectiveMessage = {
        type: '/ibc.applications.transfer.v1.MsgTransfer',
        value: {
          sender: 'inj1abc',
          receiver: 'cosmos1xyz',
          token: { amount: '2000000000000000000', denom: 'inj' },
          source_channel: 'channel-1',
          source_port: 'transfer',
        },
      };

      const result = parseIbcTransferMessage(message);

      expect(result).toEqual({
        from: 'inj1abc',
        to: 'cosmos1xyz',
        amount: '2',
        currency: 'inj',
        tokenType: 'ibc',
        tokenSymbol: 'inj',
        sourceChannel: 'channel-1',
        sourcePort: 'transfer',
      });
    });

    it('should return undefined for non-IBC messages', () => {
      const message: InjectiveMessage = {
        type: '/cosmos.bank.v1beta1.MsgSend',
        value: {},
      };

      const result = parseIbcTransferMessage(message);
      expect(result).toBeUndefined();
    });

    it('should return undefined when token is missing', () => {
      const message: InjectiveMessage = {
        type: '/ibc.applications.transfer.v1.MsgTransfer',
        value: {
          sender: 'inj1abc',
          receiver: 'cosmos1xyz',
        },
      };

      const result = parseIbcTransferMessage(message);
      expect(result).toBeUndefined();
    });
  });

  describe('parseCosmwasmExecuteMessage', () => {
    it('should parse CosmWasm message with funds', () => {
      const message: InjectiveMessage = {
        type: '/cosmwasm.wasm.v1.MsgExecuteContract',
        value: {
          sender: 'inj1abc',
          contract: 'inj1contract',
          funds: [{ amount: '500000000000000000', denom: 'inj' }],
        },
      };

      const result = parseCosmwasmExecuteMessage(message);

      expect(result).toEqual({
        from: 'inj1abc',
        to: 'inj1contract',
        amount: '0.5',
        currency: 'inj',
        tokenType: 'native',
        tokenSymbol: 'inj',
      });
    });

    it('should parse CosmWasm message without funds', () => {
      const message: InjectiveMessage = {
        type: '/cosmwasm.wasm.v1.MsgExecuteContract',
        value: {
          sender: 'inj1abc',
          contract: 'inj1contract',
        },
      };

      const result = parseCosmwasmExecuteMessage(message);

      expect(result).toEqual({
        from: 'inj1abc',
        to: 'inj1contract',
        amount: '0',
        currency: 'INJ',
        tokenType: 'native',
        tokenSymbol: 'INJ',
      });
    });

    it('should return undefined for non-CosmWasm messages', () => {
      const message: InjectiveMessage = {
        type: '/cosmos.bank.v1beta1.MsgSend',
        value: {},
      };

      const result = parseCosmwasmExecuteMessage(message);
      expect(result).toBeUndefined();
    });
  });

  describe('parseWasmxExecuteMessage', () => {
    it('should parse wasmx message with funds', () => {
      const message: InjectiveMessage = {
        type: '/injective.wasmx.v1.MsgExecuteContractCompat',
        value: {
          sender: 'inj1abc',
          contract: 'inj1contract',
          funds: '1000000000000000000',
        },
      };

      const result = parseWasmxExecuteMessage(message);

      expect(result).toEqual({
        from: 'inj1abc',
        to: 'inj1contract',
        amount: '1',
        currency: 'INJ',
        tokenType: 'native',
        tokenSymbol: 'INJ',
      });
    });

    it('should parse wasmx message without funds', () => {
      const message: InjectiveMessage = {
        type: '/injective.wasmx.v1.MsgExecuteContractCompat',
        value: {
          sender: 'inj1abc',
          contract: 'inj1contract',
        },
      };

      const result = parseWasmxExecuteMessage(message);

      expect(result).toEqual({
        from: 'inj1abc',
        to: 'inj1contract',
        amount: '0',
        currency: 'INJ',
        tokenType: 'native',
        tokenSymbol: 'INJ',
      });
    });

    it('should return undefined for non-wasmx messages', () => {
      const message: InjectiveMessage = {
        type: '/cosmwasm.wasm.v1.MsgExecuteContract',
        value: {},
      };

      const result = parseWasmxExecuteMessage(message);
      expect(result).toBeUndefined();
    });
  });

  describe('parsePeggySendToEthMessage', () => {
    it('should parse Peggy withdrawal message', () => {
      const message: InjectiveMessage = {
        type: '/injective.peggy.v1.MsgSendToEth',
        value: {
          sender: 'inj1abc',
          eth_dest: '0x123',
          amount: { amount: '3000000000000000000', denom: 'inj' },
        },
      };

      const result = parsePeggySendToEthMessage(message);

      expect(result).toEqual({
        bridgeType: 'peggy',
        from: 'inj1abc',
        to: '0x123',
        amount: '3',
        currency: 'inj',
        tokenType: 'native',
        tokenSymbol: 'inj',
        ethereumReceiver: '0x123',
      });
    });

    it('should return undefined for non-Peggy-withdrawal messages', () => {
      const message: InjectiveMessage = {
        type: '/cosmos.bank.v1beta1.MsgSend',
        value: {},
      };

      const result = parsePeggySendToEthMessage(message);
      expect(result).toBeUndefined();
    });

    it('should return undefined when amount is missing', () => {
      const message: InjectiveMessage = {
        type: '/injective.peggy.v1.MsgSendToEth',
        value: {
          sender: 'inj1abc',
          eth_dest: '0x123',
        },
      };

      const result = parsePeggySendToEthMessage(message);
      expect(result).toBeUndefined();
    });
  });

  describe('parsePeggyDepositClaimMessage', () => {
    it('should parse Peggy deposit with cosmos_receiver', () => {
      const message: InjectiveMessage = {
        type: '/injective.peggy.v1.MsgDepositClaim',
        value: {
          cosmos_receiver: 'inj1xyz',
          ethereum_sender: '0xabc',
          amount: '5000000000000000000',
          token_contract: '0xtoken',
          event_nonce: '123',
        },
      };

      const result = parsePeggyDepositClaimMessage(message, 'inj1xyz');

      expect(result).toEqual({
        bridgeType: 'peggy',
        from: '0xabc',
        to: 'inj1xyz',
        amount: '5',
        currency: 'INJ',
        tokenType: 'native',
        tokenSymbol: 'INJ',
        eventNonce: '123',
        ethereumSender: '0xabc',
        ethereumReceiver: undefined,
        tokenAddress: '0xtoken',
      });
    });

    it('should parse Peggy deposit with ethereum_receiver', () => {
      const message: InjectiveMessage = {
        type: '/injective.peggy.v1.MsgDepositClaim',
        value: {
          ethereum_receiver: 'inj1xyz',
          ethereum_sender: '0xabc',
          amount: { amount: '1000000000000000000', denom: 'inj' },
          token_contract: '0xtoken',
        },
      };

      const result = parsePeggyDepositClaimMessage(message, 'inj1xyz');

      expect(result).toEqual({
        bridgeType: 'peggy',
        from: '0xabc',
        to: 'inj1xyz',
        amount: '1',
        currency: 'INJ',
        tokenType: 'native',
        tokenSymbol: 'INJ',
        eventNonce: undefined,
        ethereumSender: '0xabc',
        ethereumReceiver: 'inj1xyz',
        tokenAddress: '0xtoken',
      });
    });

    it('should return undefined when address is not relevant', () => {
      const message: InjectiveMessage = {
        type: '/injective.peggy.v1.MsgDepositClaim',
        value: {
          cosmos_receiver: 'inj1different',
          ethereum_sender: '0xabc',
          amount: '1000000000000000000',
          token_contract: '0xtoken',
        },
      };

      const result = parsePeggyDepositClaimMessage(message, 'inj1xyz');
      expect(result).toBeUndefined();
    });

    it('should return undefined for non-Peggy-deposit messages', () => {
      const message: InjectiveMessage = {
        type: '/cosmos.bank.v1beta1.MsgSend',
        value: {},
      };

      const result = parsePeggyDepositClaimMessage(message, 'inj1xyz');
      expect(result).toBeUndefined();
    });

    it('should handle amount as array', () => {
      const message: InjectiveMessage = {
        type: '/injective.peggy.v1.MsgDepositClaim',
        value: {
          cosmos_receiver: 'inj1xyz',
          ethereum_sender: '0xabc',
          amount: [{ amount: '2000000000000000000', denom: 'inj' }],
          token_contract: '0xtoken',
        },
      };

      const result = parsePeggyDepositClaimMessage(message, 'inj1xyz');

      expect(result?.amount).toBe('2');
    });
  });
});
