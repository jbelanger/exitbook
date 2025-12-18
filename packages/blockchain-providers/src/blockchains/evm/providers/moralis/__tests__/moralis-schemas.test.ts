import { describe, expect, it } from 'vitest';

import { MoralisTokenMetadataSchema } from '../moralis.schemas.js';

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
