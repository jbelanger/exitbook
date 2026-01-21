import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  adjustNftAmount,
  convertToSmallestUnit,
  determineTransactionType,
  extractAlchemyNetworkName,
  extractAmountAndCurrency,
  extractErc1155Amount,
  extractNativeTransferData,
  extractTokenTransferData,
  isTokenTransfer,
  mapAlchemyTransaction,
} from '../alchemy.mapper-utils.js';
import type { AlchemyAssetTransfer } from '../alchemy.schemas.js';

describe('alchemy/mapper-utils', () => {
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
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        rawContract: {
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          value: '1000000',
          decimal: '6',
        },
      };

      const result = extractTokenTransferData(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.amount.toFixed()).toBe('1000000');
        expect(result.value.currency).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
        expect(result.value.tokenType).toBe('erc20');
      }
    });

    it('should fail when contract address is missing', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc20',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        value: '5000000',
      };

      const result = extractTokenTransferData(rawData);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('error');
        if (result.error.type === 'error') {
          expect(result.error.message).toContain('Missing contract address');
        }
      }
    });

    it('should extract ERC-721 token transfer data', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc721',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        rawContract: {
          address: '0xnftcontract',
          value: '999',
        },
      };

      const result = extractTokenTransferData(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.amount.toFixed()).toBe('1');
        expect(result.value.currency).toBe('0xnftcontract');
        expect(result.value.tokenType).toBe('erc721');
      }
    });

    it('should extract ERC-1155 token transfer data', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc1155',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        rawContract: {
          address: '0xnftcontract',
          value: '999',
        },
        erc1155Metadata: [{ tokenId: '1', value: '5' }],
      };

      const result = extractTokenTransferData(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.amount.toFixed()).toBe('5');
        expect(result.value.currency).toBe('0xnftcontract');
        expect(result.value.tokenType).toBe('erc1155');
      }
    });

    it('should handle zero value', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc20',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        rawContract: {
          address: '0xtoken',
          value: '0',
        },
      };

      const result = extractTokenTransferData(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.amount.toFixed()).toBe('0');
      }
    });
  });

  describe('adjustNftAmount', () => {
    it('should return 1 for ERC-721 tokens', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'erc721',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
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
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
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
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
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
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
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
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
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
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
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
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
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
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        asset: 'ETH',
        rawContract: {
          value: '1000000000000000000',
        },
      };

      const result = extractNativeTransferData(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.amount.toFixed()).toBe('1000000000000000000');
        expect(result.value.currency).toBe('ETH');
        expect(result.value.tokenType).toBe('native');
      }
    });

    it('should convert value to smallest unit when rawContract.value is missing', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'external',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        asset: 'ETH',
        value: '1.5',
        rawContract: {
          decimal: '18',
        },
      };

      const result = extractNativeTransferData(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.amount.toFixed()).toBe('1500000000000000000');
        expect(result.value.currency).toBe('ETH');
      }
    });

    it('should fail when asset field is missing', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'external',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        rawContract: {
          address: '0xmatic',
          value: '1000000000000000000',
        },
      };

      const result = extractNativeTransferData(rawData);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('error');
        if (result.error.type === 'error') {
          expect(result.error.message).toContain('Missing asset field');
        }
      }
    });
  });

  describe('convertToSmallestUnit', () => {
    it('should convert decimal to wei with 18 decimals', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'external',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
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
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
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
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
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
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        value: '0',
      };

      const result = convertToSmallestUnit(rawData);

      expect(result.toFixed()).toBe('0');
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
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        rawContract: {
          address: '0xtoken',
          value: '1000000',
        },
      };

      const result = extractAmountAndCurrency(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.tokenType).toBe('erc20');
        expect(result.value.currency).toBe('0xtoken');
      }
    });

    it('should route to native transfer extraction for external', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'external',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        asset: 'ETH',
        rawContract: {
          value: '1000000000000000000',
        },
      };

      const result = extractAmountAndCurrency(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.tokenType).toBe('native');
        expect(result.value.currency).toBe('ETH');
      }
    });

    it('should route to native transfer extraction for internal', () => {
      const rawData: AlchemyAssetTransfer = {
        blockNum: '0x123456',
        category: 'internal',
        from: '0xsender',
        hash: '0xhash',
        metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        asset: 'ETH',
        rawContract: {
          value: '500000000000000000',
        },
      };

      const result = extractAmountAndCurrency(rawData);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.tokenType).toBe('native');
        expect(result.value.currency).toBe('ETH');
      }
    });
  });

  describe('mapAlchemyTransaction', () => {
    describe('edge cases and validation', () => {
      it('should fail when blockTimestamp is missing', () => {
        const rawData: AlchemyAssetTransfer = {
          blockNum: '0x123456',
          category: 'external',
          from: '0xsender',
          hash: '0xhash',
          metadata: { blockTimestamp: undefined },
          asset: 'ETH',
          rawContract: {
            value: '1000000000000000000',
          },
        };

        const result = mapAlchemyTransaction(rawData);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.type).toBe('error');
          if (result.error.type === 'error') {
            expect(result.error.message).toContain('Missing blockTimestamp');
          }
        }
      });

      it('should use zero address sentinel when from is null (minting)', () => {
        const rawData: AlchemyAssetTransfer = {
          blockNum: '0x123456',
          category: 'erc721',
          from: undefined,
          to: '0xrecipient',
          hash: '0xhash',
          metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
          rawContract: {
            address: '0xnftcontract',
            value: '1',
          },
        };

        const result = mapAlchemyTransaction(rawData);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.from).toBe('0x0000000000000000000000000000000000000000');
          expect(result.value.to).toBe('0xrecipient');
        }
      });

      it('should fail when asset is missing for native transfer', () => {
        const rawData: AlchemyAssetTransfer = {
          blockNum: '0x123456',
          category: 'external',
          from: '0xsender',
          hash: '0xhash',
          metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
          rawContract: {
            value: '1000000000000000000',
          },
          // asset field is missing
        };

        const result = mapAlchemyTransaction(rawData);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.type).toBe('error');
          if (result.error.type === 'error') {
            expect(result.error.message).toContain('Missing asset field');
          }
        }
      });

      it('should fail when contract address is missing for token transfer', () => {
        const rawData: AlchemyAssetTransfer = {
          blockNum: '0x123456',
          category: 'erc20',
          from: '0xsender',
          hash: '0xhash',
          metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
          value: '1000000',
          // rawContract.address is missing
        };

        const result = mapAlchemyTransaction(rawData);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.type).toBe('error');
          if (result.error.type === 'error') {
            expect(result.error.message).toContain('Missing contract address');
          }
        }
      });

      it('should handle transactions with gas fees', () => {
        const rawData: AlchemyAssetTransfer = {
          blockNum: '0x123456',
          category: 'external',
          from: '0xsender',
          to: '0xrecipient',
          hash: '0xhash',
          metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
          asset: 'ETH',
          rawContract: {
            value: '1000000000000000000',
          },
          _gasUsed: '21000',
          _effectiveGasPrice: '50000000000',
          _nativeCurrency: 'ETH',
        };

        const result = mapAlchemyTransaction(rawData);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.gasUsed).toBe('21000');
          expect(result.value.gasPrice).toBe('50000000000');
          expect(result.value.feeAmount).toBe('1050000000000000');
          expect(result.value.feeCurrency).toBe('ETH');
        }
      });

      it('should handle transactions without gas fees (internal or gas fetch failed)', () => {
        const rawData: AlchemyAssetTransfer = {
          blockNum: '0x123456',
          category: 'internal',
          from: '0xsender',
          to: '0xrecipient',
          hash: '0xhash',
          metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
          asset: 'ETH',
          rawContract: {
            value: '1000000000000000000',
          },
          // No gas data - internal transactions don't pay gas
        };

        const result = mapAlchemyTransaction(rawData);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.gasUsed).toBeUndefined();
          expect(result.value.gasPrice).toBeUndefined();
          expect(result.value.feeAmount).toBeUndefined();
          expect(result.value.feeCurrency).toBeUndefined();
        }
      });

      it('should handle transactions with partial gas data (missing effectiveGasPrice)', () => {
        const rawData: AlchemyAssetTransfer = {
          blockNum: '0x123456',
          category: 'external',
          from: '0xsender',
          to: '0xrecipient',
          hash: '0xhash',
          metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
          asset: 'ETH',
          rawContract: {
            value: '1000000000000000000',
          },
          _gasUsed: '21000',
          // _effectiveGasPrice is missing (pre-EIP-1559 or partial receipt)
          _nativeCurrency: 'ETH',
        };

        const result = mapAlchemyTransaction(rawData);

        // Should succeed but without gas fees
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.gasUsed).toBeUndefined();
          expect(result.value.gasPrice).toBeUndefined();
          expect(result.value.feeAmount).toBeUndefined();
          expect(result.value.feeCurrency).toBeUndefined();
        }
      });

      it('should fail when gas data is present but native currency is missing', () => {
        const rawData: AlchemyAssetTransfer = {
          blockNum: '0x123456',
          category: 'external',
          from: '0xsender',
          to: '0xrecipient',
          hash: '0xhash',
          metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
          asset: 'ETH',
          rawContract: {
            value: '1000000000000000000',
          },
          _gasUsed: '21000',
          _effectiveGasPrice: '50000000000',
          // _nativeCurrency is missing - this should fail
        };

        const result = mapAlchemyTransaction(rawData);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.type).toBe('error');
          if (result.error.type === 'error') {
            expect(result.error.message).toContain('Missing native currency');
          }
        }
      });
    });
  });
});
