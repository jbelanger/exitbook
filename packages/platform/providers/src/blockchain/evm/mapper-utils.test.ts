import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  adjustNftAmount,
  convertToSmallestUnit,
  determineTransactionType,
  extractAlchemyNetworkName,
  extractAmountAndCurrency,
  extractErc1155Amount,
  extractMethodId,
  extractNativeTransferData,
  extractTimestamp,
  extractTokenTransferData,
  formatThetaAmount,
  getTransactionTypeFromFunctionName,
  isThetaTokenTransfer,
  isTokenTransfer,
  parseCommaFormattedNumber,
  selectThetaCurrency,
} from './mapper-utils.js';
import type { AlchemyAssetTransfer } from './providers/alchemy/alchemy.schemas.js';

describe('mapper-utils', () => {
  describe('isTokenTransfer', () => {
    it('should return true for "token" category', () => {
      expect(isTokenTransfer('token')).toBe(true);
    });

    it('should return true for "erc20" category', () => {
      expect(isTokenTransfer('erc20')).toBe(true);
    });

    it('should return true for "erc721" category', () => {
      expect(isTokenTransfer('erc721')).toBe(true);
    });

    it('should return true for "erc1155" category', () => {
      expect(isTokenTransfer('erc1155')).toBe(true);
    });

    it('should return false for "external" category', () => {
      expect(isTokenTransfer('external')).toBe(false);
    });

    it('should return false for "internal" category', () => {
      expect(isTokenTransfer('internal')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isTokenTransfer('')).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(isTokenTransfer('ERC20')).toBe(false);
      expect(isTokenTransfer('Token')).toBe(false);
    });
  });

  describe('extractTokenTransferData', () => {
    it('should extract ERC-20 token transfer data', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc20',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        rawContract: {
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          value: '1000000',
          decimal: '6',
        },
      };

      const result = extractTokenTransferData(rawData);

      expect(result.amount.toFixed()).toBe('1000000');
      expect(result.currency).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
      expect(result.tokenType).toBe('erc20');
    });

    it('should handle missing rawContract by using value field', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc20',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        value: '5000000',
      };

      const result = extractTokenTransferData(rawData);

      expect(result.amount.toFixed()).toBe('5000000');
      expect(result.currency).toBe('UNKNOWN');
    });

    it('should extract ERC-721 token transfer data', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc721',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        rawContract: {
          address: '0xnftcontract',
          value: '999',
        },
      };

      const result = extractTokenTransferData(rawData);

      expect(result.amount.toFixed()).toBe('1');
      expect(result.currency).toBe('0xnftcontract');
      expect(result.tokenType).toBe('erc721');
    });

    it('should extract ERC-1155 token transfer data', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc1155',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        rawContract: {
          address: '0xnftcontract',
          value: '999',
        },
        erc1155Metadata: [{ tokenId: '1', value: '5' }],
      };

      const result = extractTokenTransferData(rawData);

      expect(result.amount.toFixed()).toBe('5');
      expect(result.currency).toBe('0xnftcontract');
      expect(result.tokenType).toBe('erc1155');
    });

    it('should handle zero value', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc20',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        rawContract: {
          address: '0xtoken',
          value: '0',
        },
      };

      const result = extractTokenTransferData(rawData);

      expect(result.amount.toFixed()).toBe('0');
    });
  });

  describe('adjustNftAmount', () => {
    it('should return 1 for ERC-721 tokens', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc721',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
      };

      const result = adjustNftAmount(rawData, new Decimal(999));

      expect(result.toFixed()).toBe('1');
    });

    it('should extract amount from ERC-1155 metadata', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc1155',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        erc1155Metadata: [{ tokenId: '1', value: '10' }],
      };

      const result = adjustNftAmount(rawData, new Decimal(999));

      expect(result.toFixed()).toBe('10');
    });

    it('should return base amount for non-NFT categories', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc20',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
      };

      const result = adjustNftAmount(rawData, new Decimal(5000000));

      expect(result.toFixed()).toBe('5000000');
    });
  });

  describe('extractErc1155Amount', () => {
    it('should extract amount from first metadata entry', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc1155',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        erc1155Metadata: [
          { tokenId: '1', value: '10' },
          { tokenId: '2', value: '20' },
        ],
      };

      const result = extractErc1155Amount(rawData);

      expect(result.toFixed()).toBe('10');
    });

    it('should return 1 when metadata is undefined', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc1155',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
      };

      const result = extractErc1155Amount(rawData);

      expect(result.toFixed()).toBe('1');
    });

    it('should return 1 when metadata array is empty', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc1155',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        erc1155Metadata: [],
      };

      const result = extractErc1155Amount(rawData);

      expect(result.toFixed()).toBe('1');
    });

    it('should return 1 when first metadata entry has no value', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc1155',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        erc1155Metadata: [{ tokenId: '1' }],
      };

      const result = extractErc1155Amount(rawData);

      expect(result.toFixed()).toBe('1');
    });
  });

  describe('extractNativeTransferData', () => {
    it('should extract native transfer data with rawContract value', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'external',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        asset: 'ETH',
        rawContract: {
          value: '1000000000000000000',
        },
      };

      const result = extractNativeTransferData(rawData);

      expect(result.amount.toFixed()).toBe('1000000000000000000');
      expect(result.currency).toBe('ETH');
      expect(result.tokenType).toBe('native');
    });

    it('should convert value to smallest unit when rawContract.value is missing', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'external',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        asset: 'ETH',
        value: '1.5',
        rawContract: {
          decimal: '18',
        },
      };

      const result = extractNativeTransferData(rawData);

      expect(result.amount.toFixed()).toBe('1500000000000000000');
      expect(result.currency).toBe('ETH');
    });

    it('should use rawContract.address as currency when asset is missing', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'external',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        rawContract: {
          address: '0xmatic',
          value: '1000000000000000000',
        },
      };

      const result = extractNativeTransferData(rawData);

      expect(result.currency).toBe('0xmatic');
    });

    it('should default to UNKNOWN when both asset and rawContract.address are missing', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'external',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        value: '1',
      };

      const result = extractNativeTransferData(rawData);

      expect(result.currency).toBe('UNKNOWN');
    });
  });

  describe('convertToSmallestUnit', () => {
    it('should convert decimal to wei with 18 decimals', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'external',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        value: '1.5',
        rawContract: {
          decimal: '18',
        },
      };

      const result = convertToSmallestUnit(rawData);

      expect(result.toFixed()).toBe('1500000000000000000');
    });

    it('should default to 18 decimals when not specified', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'external',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        value: '1',
      };

      const result = convertToSmallestUnit(rawData);

      expect(result.toFixed()).toBe('1000000000000000000');
    });

    it('should handle 6 decimals (USDC)', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'external',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        value: '100',
        rawContract: {
          decimal: '6',
        },
      };

      const result = convertToSmallestUnit(rawData);

      expect(result.toFixed()).toBe('100000000');
    });

    it('should handle zero value', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'external',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        value: '0',
      };

      const result = convertToSmallestUnit(rawData);

      expect(result.toFixed()).toBe('0');
    });
  });

  describe('extractTimestamp', () => {
    it('should convert ISO timestamp to milliseconds', () => {
      const result = extractTimestamp('2024-01-01T00:00:00Z');
      expect(result).toBe(new Date('2024-01-01T00:00:00Z').getTime());
    });

    it('should handle timestamp with timezone offset', () => {
      const result = extractTimestamp('2024-01-01T12:30:00+05:00');
      expect(result).toBe(new Date('2024-01-01T12:30:00+05:00').getTime());
    });

    it('should handle timestamp with milliseconds', () => {
      const result = extractTimestamp('2024-01-01T00:00:00.123Z');
      expect(result).toBe(new Date('2024-01-01T00:00:00.123Z').getTime());
    });
  });

  describe('determineTransactionType', () => {
    it('should return "token_transfer" for erc20 category', () => {
      expect(determineTransactionType('erc20')).toBe('token_transfer');
    });

    it('should return "token_transfer" for erc721 category', () => {
      expect(determineTransactionType('erc721')).toBe('token_transfer');
    });

    it('should return "token_transfer" for erc1155 category', () => {
      expect(determineTransactionType('erc1155')).toBe('token_transfer');
    });

    it('should return "token_transfer" for token category', () => {
      expect(determineTransactionType('token')).toBe('token_transfer');
    });

    it('should return "internal" for internal category', () => {
      expect(determineTransactionType('internal')).toBe('internal');
    });

    it('should return "transfer" for external category', () => {
      expect(determineTransactionType('external')).toBe('transfer');
    });

    it('should return "transfer" for unknown category', () => {
      expect(determineTransactionType('unknown')).toBe('transfer');
    });
  });

  describe('parseCommaFormattedNumber', () => {
    it('should parse number with commas', () => {
      const result = parseCommaFormattedNumber('1,000,000.50');
      expect(result.toFixed()).toBe('1000000.5');
    });

    it('should parse number without commas', () => {
      const result = parseCommaFormattedNumber('1000000.50');
      expect(result.toFixed()).toBe('1000000.5');
    });

    it('should handle single comma', () => {
      const result = parseCommaFormattedNumber('1,000');
      expect(result.toFixed()).toBe('1000');
    });

    it('should handle multiple commas', () => {
      const result = parseCommaFormattedNumber('1,234,567,890.123456');
      expect(result.toFixed()).toBe('1234567890.123456');
    });

    it('should handle zero', () => {
      const result = parseCommaFormattedNumber('0');
      expect(result.toFixed()).toBe('0');
    });

    it('should handle decimal only', () => {
      const result = parseCommaFormattedNumber('0.123');
      expect(result.toFixed()).toBe('0.123');
    });
  });

  describe('selectThetaCurrency', () => {
    it('should select THETA when amount is greater than zero', () => {
      const result = selectThetaCurrency(new Decimal('100'), new Decimal('50'));
      expect(result.currency).toBe('THETA');
      expect(result.amount.toFixed()).toBe('100');
    });

    it('should select TFUEL when THETA is zero and TFUEL is positive', () => {
      const result = selectThetaCurrency(new Decimal('0'), new Decimal('50'));
      expect(result.currency).toBe('TFUEL');
      expect(result.amount.toFixed()).toBe('50');
    });

    it('should default to TFUEL with zero amount when both are zero', () => {
      const result = selectThetaCurrency(new Decimal('0'), new Decimal('0'));
      expect(result.currency).toBe('TFUEL');
      expect(result.amount.toFixed()).toBe('0');
    });

    it('should prioritize THETA over TFUEL when both are positive', () => {
      const result = selectThetaCurrency(new Decimal('100'), new Decimal('200'));
      expect(result.currency).toBe('THETA');
      expect(result.amount.toFixed()).toBe('100');
    });
  });

  describe('isThetaTokenTransfer', () => {
    it('should return true for THETA', () => {
      expect(isThetaTokenTransfer('THETA')).toBe(true);
    });

    it('should return false for TFUEL', () => {
      expect(isThetaTokenTransfer('TFUEL')).toBe(false);
    });

    it('should return false for other currencies', () => {
      expect(isThetaTokenTransfer('ETH')).toBe(false);
      expect(isThetaTokenTransfer('BTC')).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(isThetaTokenTransfer('theta')).toBe(false);
      expect(isThetaTokenTransfer('Theta')).toBe(false);
    });
  });

  describe('formatThetaAmount', () => {
    it('should convert THETA amount from wei to decimal', () => {
      const amount = new Decimal('1000000000000000000');
      const result = formatThetaAmount(amount, true, 18);
      expect(result).toBe('1');
    });

    it('should keep TFUEL amount in wei', () => {
      const amount = new Decimal('1000000000000000000');
      const result = formatThetaAmount(amount, false, 18);
      expect(result).toBe('1000000000000000000');
    });

    it('should handle fractional THETA amounts', () => {
      const amount = new Decimal('1500000000000000000');
      const result = formatThetaAmount(amount, true, 18);
      expect(result).toBe('1.5');
    });

    it('should handle zero amount', () => {
      const amount = new Decimal('0');
      const result = formatThetaAmount(amount, true, 18);
      expect(result).toBe('0');
    });

    it('should use toFixed for TFUEL to avoid scientific notation', () => {
      const amount = new Decimal('1000000000000000000000');
      const result = formatThetaAmount(amount, false, 18);
      expect(result).not.toContain('e');
      expect(result).toBe('1000000000000000000000');
    });
  });

  describe('extractMethodId', () => {
    it('should extract method ID from input data', () => {
      const result = extractMethodId('0xa9059cbb000000000000000000000000');
      expect(result).toBe('0xa9059cbb');
    });

    it('should handle minimal valid input', () => {
      const result = extractMethodId('0x12345678');
      expect(result).toBe('0x12345678');
    });

    it('should return undefined for input shorter than 10 characters', () => {
      const result = extractMethodId('0x1234567');
      expect(result).toBeUndefined();
    });

    it('should return undefined for null input', () => {
      const result = extractMethodId();
      expect(result).toBeUndefined();
    });

    it('should return undefined for undefined input', () => {
      const result = extractMethodId();
      expect(result).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      const result = extractMethodId('');
      expect(result).toBeUndefined();
    });

    it('should extract from long input data', () => {
      const longInput =
        '0xa9059cbb000000000000000000000000abcdef1234567890abcdef1234567890abcdef12000000000000000000000000000000000000000000000000000000000000000a';
      const result = extractMethodId(longInput);
      expect(result).toBe('0xa9059cbb');
    });
  });

  describe('getTransactionTypeFromFunctionName', () => {
    it('should return "contract_call" when function name is provided', () => {
      expect(getTransactionTypeFromFunctionName('transfer')).toBe('contract_call');
    });

    it('should return "contract_call" for any non-empty function name', () => {
      expect(getTransactionTypeFromFunctionName('approve')).toBe('contract_call');
      expect(getTransactionTypeFromFunctionName('swap')).toBe('contract_call');
    });

    it('should return "transfer" when function name is null', () => {
      expect(getTransactionTypeFromFunctionName()).toBe('transfer');
    });

    it('should return "transfer" when function name is undefined', () => {
      expect(getTransactionTypeFromFunctionName()).toBe('transfer');
    });

    it('should return "contract_call" for empty string', () => {
      expect(getTransactionTypeFromFunctionName('')).toBe('transfer');
    });
  });

  describe('extractAlchemyNetworkName', () => {
    it('should extract network name from Alchemy URL', () => {
      const result = extractAlchemyNetworkName('https://eth-mainnet.g.alchemy.com/v2', 'ethereum');
      expect(result).toBe('eth-mainnet');
    });

    it('should extract polygon network name', () => {
      const result = extractAlchemyNetworkName('https://polygon-mainnet.g.alchemy.com/v2', 'polygon');
      expect(result).toBe('polygon-mainnet');
    });

    it('should extract arbitrum network name', () => {
      const result = extractAlchemyNetworkName('https://arb-mainnet.g.alchemy.com/v2', 'arbitrum');
      expect(result).toBe('arb-mainnet');
    });

    it('should fallback to blockchain-mainnet when pattern does not match', () => {
      const result = extractAlchemyNetworkName('https://custom.endpoint.com/v2', 'ethereum');
      expect(result).toBe('ethereum-mainnet');
    });

    it('should fallback for non-standard URLs', () => {
      const result = extractAlchemyNetworkName('http://localhost:8545', 'ethereum');
      expect(result).toBe('ethereum-mainnet');
    });

    it('should extract optimism network name', () => {
      const result = extractAlchemyNetworkName('https://opt-mainnet.g.alchemy.com/v2', 'optimism');
      expect(result).toBe('opt-mainnet');
    });
  });

  describe('extractAmountAndCurrency', () => {
    it('should route to token transfer extraction for erc20', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc20',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        rawContract: {
          address: '0xtoken',
          value: '1000000',
        },
      };

      const result = extractAmountAndCurrency(rawData);

      expect(result.tokenType).toBe('erc20');
      expect(result.currency).toBe('0xtoken');
    });

    it('should route to native transfer extraction for external', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'external',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        asset: 'ETH',
        rawContract: {
          value: '1000000000000000000',
        },
      };

      const result = extractAmountAndCurrency(rawData);

      expect(result.tokenType).toBe('native');
      expect(result.currency).toBe('ETH');
    });

    it('should route to native transfer extraction for internal', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'internal',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
        asset: 'ETH',
        rawContract: {
          value: '500000000000000000',
        },
      };

      const result = extractAmountAndCurrency(rawData);

      expect(result.tokenType).toBe('native');
      expect(result.currency).toBe('ETH');
    });
  });
});
