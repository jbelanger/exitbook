/* eslint-disable unicorn/no-null -- null accepted here */
import { describe, expect, it } from 'vitest';

import { MoralisTokenMetadataSchema, MoralisWalletHistoryResponseSchema } from '../moralis.schemas.js';

describe('MoralisTokenMetadataSchema', () => {
  describe('spam detection fields', () => {
    it('should parse possibleSpam as boolean true', () => {
      const input = {
        address: '0x123',
        decimals: '18',
        name: 'Token',
        possible_spam: true,
        symbol: 'TKN',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.possible_spam).toBe(true);
    });

    it('should parse possibleSpam as boolean false', () => {
      const input = {
        address: '0x123',
        decimals: '18',
        name: 'Token',
        possible_spam: false,
        symbol: 'TKN',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.possible_spam).toBe(false);
    });

    it('should transform possibleSpam string "true" to boolean true', () => {
      const input = {
        address: '0x123',
        decimals: '18',
        name: 'Token',
        possible_spam: 'true',
        symbol: 'TKN',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.possible_spam).toBe(true);
    });

    it('should transform possibleSpam string "false" to boolean false', () => {
      const input = {
        address: '0x123',
        decimals: '18',
        name: 'Token',
        possible_spam: 'false',
        symbol: 'TKN',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.possible_spam).toBe(false);
    });

    it('should handle possibleSpam as undefined', () => {
      const input = {
        address: '0x123',
        decimals: '18',
        name: 'Token',
        symbol: 'TKN',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.possible_spam).toBeUndefined();
    });

    it('should parse verifiedContract as boolean true', () => {
      const input = {
        address: '0x123',
        decimals: '18',
        name: 'Token',
        symbol: 'TKN',
        verified_contract: true,
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.verified_contract).toBe(true);
    });

    it('should parse verifiedContract as boolean false', () => {
      const input = {
        address: '0x123',
        decimals: '18',
        name: 'Token',
        symbol: 'TKN',
        verified_contract: false,
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.verified_contract).toBe(false);
    });

    it('should transform verifiedContract string "true" to boolean true', () => {
      const input = {
        address: '0x123',
        decimals: '18',
        name: 'Token',
        symbol: 'TKN',
        verified_contract: 'true',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.verified_contract).toBe(true);
    });

    it('should transform verifiedContract string "1" to boolean true', () => {
      const input = {
        address: '0x123',
        decimals: '18',
        name: 'Token',
        symbol: 'TKN',
        verified_contract: '1',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.verified_contract).toBe(true);
    });

    it('should transform verifiedContract string "false" to boolean false', () => {
      const input = {
        address: '0x123',
        decimals: '18',
        name: 'Token',
        symbol: 'TKN',
        verified_contract: 'false',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.verified_contract).toBe(false);
    });

    it('should transform verifiedContract string "0" to boolean false', () => {
      const input = {
        address: '0x123',
        decimals: '18',
        name: 'Token',
        symbol: 'TKN',
        verified_contract: '0',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.verified_contract).toBe(false);
    });

    it('should handle verifiedContract as undefined', () => {
      const input = {
        address: '0x123',
        decimals: '18',
        name: 'Token',
        symbol: 'TKN',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.verified_contract).toBeUndefined();
    });

    it('should handle verifiedContract with invalid string value', () => {
      const input = {
        address: '0x123',
        decimals: '18',
        name: 'Token',
        symbol: 'TKN',
        verified_contract: 'invalid',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.verified_contract).toBeUndefined();
    });
  });

  describe('additional metadata fields', () => {
    it('should parse totalSupply', () => {
      const input = {
        address: '0x123',
        decimals: '18',
        name: 'Token',
        symbol: 'TKN',
        total_supply: '1000000000000000000',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.total_supply).toBe('1000000000000000000');
    });

    it('should parse createdAt', () => {
      const input = {
        address: '0x123',
        created_at: '2024-01-01T00:00:00Z',
        decimals: '18',
        name: 'Token',
        symbol: 'TKN',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.created_at).toBe('2024-01-01T00:00:00Z');
    });

    it('should transform blockNumber from string to number', () => {
      const input = {
        address: '0x123',
        block_number: '12345678',
        decimals: '18',
        name: 'Token',
        symbol: 'TKN',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.block_number).toBe(12345678);
      expect(typeof result.block_number).toBe('number');
    });

    it('should parse blockNumber as number', () => {
      const input = {
        address: '0x123',
        block_number: 12345678,
        decimals: '18',
        name: 'Token',
        symbol: 'TKN',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.block_number).toBe(12345678);
    });

    it('should handle empty blockNumber string as undefined', () => {
      const input = {
        address: '0x123',
        block_number: '',
        decimals: '18',
        name: 'Token',
        symbol: 'TKN',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.block_number).toBeUndefined();
    });

    it('should handle blockNumber as undefined', () => {
      const input = {
        address: '0x123',
        decimals: '18',
        name: 'Token',
        symbol: 'TKN',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.block_number).toBeUndefined();
    });
  });

  describe('complete metadata with all spam detection fields', () => {
    it('should parse complete metadata with all new fields', () => {
      const input = {
        address: '0x123',
        block_number: '12345678',
        created_at: '2024-01-01T00:00:00Z',
        decimals: '18',
        logo: 'https://example.com/logo.png',
        name: 'Complete Token',
        possible_spam: false,
        symbol: 'CMP',
        total_supply: '1000000000000000000',
        verified_contract: true,
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.address).toBe('0x123');
      expect(result.name).toBe('Complete Token');
      expect(result.symbol).toBe('CMP');
      expect(result.decimals).toBe(18);
      expect(result.logo).toBe('https://example.com/logo.png');
      expect(result.possible_spam).toBe(false);
      expect(result.verified_contract).toBe(true);
      expect(result.total_supply).toBe('1000000000000000000');
      expect(result.created_at).toBe('2024-01-01T00:00:00Z');
      expect(result.block_number).toBe(12345678);
    });

    it('should parse scam token metadata', () => {
      const input = {
        address: '0xscam',
        decimals: '18',
        name: '🎁 Visit ClaimRewards.com',
        possible_spam: true,
        symbol: 'SCAM',
        verified_contract: false,
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.possible_spam).toBe(true);
      expect(result.verified_contract).toBe(false);
      expect(result.name).toBe('🎁 Visit ClaimRewards.com');
    });
  });

  describe('decimal transformations', () => {
    it('should transform decimals from string to number', () => {
      const input = {
        address: '0x123',
        decimals: '18',
        name: 'Token',
        symbol: 'TKN',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.decimals).toBe(18);
      expect(typeof result.decimals).toBe('number');
    });

    it('should keep decimals as number', () => {
      const input = {
        address: '0x123',
        decimals: 18,
        name: 'Token',
        symbol: 'TKN',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.decimals).toBe(18);
    });

    it('should handle decimals as undefined', () => {
      const input = {
        address: '0x123',
        name: 'Token',
        symbol: 'TKN',
      };

      const result = MoralisTokenMetadataSchema.parse(input);

      expect(result.decimals).toBeUndefined();
    });
  });
});

describe('MoralisWalletHistoryResponseSchema', () => {
  it('parses documented wallet history scalar variants', () => {
    const result = MoralisWalletHistoryResponseSchema.parse({
      cursor: '<cursor>',
      page: '2',
      page_size: '100',
      result: [
        {
          block_hash: '0x9b559aef7ea858608c2e554246fe4a24287e7aeeb976848df2b9a2531f4b9171',
          block_number: '12386788',
          block_timestamp: '2021-05-07T11:08:35.000Z',
          category: 'send',
          erc20_transfers: [
            {
              address: '0x057Ec652A4F150f7FF94f089A38008f49a0DF88e',
              direction: 'outgoing',
              from_address: '0xd4a3BebD824189481FC45363602b83C9c7e9cbDf',
              from_address_label: 'Binance 1',
              log_index: 2,
              possible_spam: 'false',
              security_score: null,
              to_address: '0x62AED87d21Ad0F3cdE4D147Fdcc9245401Af0044',
              to_address_label: 'Binance 2',
              token_decimals: null,
              token_logo: 'https://cdn.moralis.io/images/325/large/Tether-logo.png',
              token_name: 'Tether USD',
              token_symbol: 'USDT',
              value: 6500000,
              value_formatted: '1.033',
              verified_contract: 'false',
            },
          ],
          from_address: '0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0',
          gas_price: '52500000000',
          hash: '0x1ed85b3757a6d31d01a4d6677fc52fd3911d649a0af21fe5ca3f886b153773ed',
          internal_transactions: [],
          method_label: 'transfer',
          native_transfers: [
            {
              direction: 'outgoing',
              from_address: '0x057Ec652A4F150f7FF94f089A38008f49a0DF88e',
              from_address_label: 'Binance 1',
              internal_transaction: 'false',
              to_address: '0x057Ec652A4F150f7FF94f089A38008f49a0DF88e',
              to_address_label: 'Binance 2',
              token_symbol: 'ETH',
              value: '1000000000000000',
              value_formatted: '0.1',
            },
          ],
          nonce: '1848059',
          possible_spam: 'false',
          receipt_gas_used: '21000',
          receipt_status: '1',
          summary: 'transfer',
          to_address: '0x003dde3494f30d861d063232c6a8c04394b686ff',
          transaction_fee: '0.00000000000000063',
          value: '115580000000000000',
        },
      ],
    });

    expect(result.page).toBe(2);
    expect(result.page_size).toBe(100);
    expect(result.result[0]!.possible_spam).toBe(false);
    expect(result.result[0]!.erc20_transfers[0]!.possible_spam).toBe(false);
    expect(result.result[0]!.erc20_transfers[0]!.token_decimals).toBeUndefined();
    expect(result.result[0]!.erc20_transfers[0]!.verified_contract).toBe(false);
    expect(result.result[0]!.native_transfers[0]!.internal_transaction).toBe(false);
  });
});
