import { describe, expect, it } from 'vitest';

import type { AlchemyAssetTransfer, AlchemyTransactionReceipt } from '../providers/alchemy/alchemy.schemas.ts';
import {
  calculateGasFee,
  calculateGasFeeBigInt,
  deduplicateTransactionHashes,
  mergeReceiptsIntoTransfers,
} from '../receipt-utils.ts';

describe('receipt-utils', () => {
  describe('calculateGasFee', () => {
    it('should calculate gas fee correctly', () => {
      const gasUsed = '21000';
      const effectiveGasPrice = '50000000000'; // 50 gwei

      const result = calculateGasFee(gasUsed, effectiveGasPrice);

      expect(result.toFixed()).toBe('1050000000000000'); // 0.00105 ETH in wei
    });

    it('should handle zero gas used', () => {
      const result = calculateGasFee('0', '50000000000');
      expect(result.toFixed()).toBe('0');
    });

    it('should handle zero gas price', () => {
      const result = calculateGasFee('21000', '0');
      expect(result.toFixed()).toBe('0');
    });

    it('should handle hex inputs', () => {
      const gasUsed = '0x5208'; // 21000 in hex
      const effectiveGasPrice = '0xba43b7400'; // 50000000000 in hex

      const result = calculateGasFee(gasUsed, effectiveGasPrice);

      expect(result.toFixed()).toBe('1050000000000000');
    });

    it('should handle large gas amounts', () => {
      const gasUsed = '500000';
      const effectiveGasPrice = '100000000000'; // 100 gwei

      const result = calculateGasFee(gasUsed, effectiveGasPrice);

      expect(result.toFixed()).toBe('50000000000000000'); // 0.05 ETH in wei
    });

    it('should handle very high gas prices', () => {
      const gasUsed = '21000';
      const effectiveGasPrice = '500000000000'; // 500 gwei

      const result = calculateGasFee(gasUsed, effectiveGasPrice);

      expect(result.toFixed()).toBe('10500000000000000'); // 0.0105 ETH in wei
    });

    it('should preserve precision for large numbers', () => {
      const gasUsed = '999999';
      const effectiveGasPrice = '999999999999'; // ~1000 gwei

      const result = calculateGasFee(gasUsed, effectiveGasPrice);

      expect(result.toFixed()).toBe('999998999999000001');
    });

    it('should handle string decimal inputs', () => {
      const result = calculateGasFee('21000', '50000000000');
      expect(result.toFixed()).toBe('1050000000000000');
    });
  });

  describe('calculateGasFeeBigInt', () => {
    it('should calculate gas fee using BigInt', () => {
      const gasUsed = '21000';
      const effectiveGasPrice = '50000000000'; // 50 gwei

      const result = calculateGasFeeBigInt(gasUsed, effectiveGasPrice);

      expect(result).toBe('1050000000000000');
    });

    it('should handle zero gas used', () => {
      const result = calculateGasFeeBigInt('0', '50000000000');
      expect(result).toBe('0');
    });

    it('should handle zero gas price', () => {
      const result = calculateGasFeeBigInt('21000', '0');
      expect(result).toBe('0');
    });

    it('should handle large gas amounts', () => {
      const gasUsed = '500000';
      const effectiveGasPrice = '100000000000'; // 100 gwei

      const result = calculateGasFeeBigInt(gasUsed, effectiveGasPrice);

      expect(result).toBe('50000000000000000');
    });

    it('should handle very large numbers', () => {
      const gasUsed = '999999';
      const effectiveGasPrice = '999999999999';

      const result = calculateGasFeeBigInt(gasUsed, effectiveGasPrice);

      expect(result).toBe('999998999999000001');
    });

    it('should match Decimal calculation for normal values', () => {
      const gasUsed = '21000';
      const effectiveGasPrice = '50000000000';

      const decimalResult = calculateGasFee(gasUsed, effectiveGasPrice);
      const bigIntResult = calculateGasFeeBigInt(gasUsed, effectiveGasPrice);

      expect(bigIntResult).toBe(decimalResult.toFixed());
    });
  });

  describe('deduplicateTransactionHashes', () => {
    it('should remove duplicate transaction hashes', () => {
      const hashes = ['0xabc', '0xdef', '0xabc', '0x123', '0xdef'];

      const result = deduplicateTransactionHashes(hashes);

      expect(result).toHaveLength(3);
      expect(result).toEqual(['0xabc', '0xdef', '0x123']);
    });

    it('should handle array with no duplicates', () => {
      const hashes = ['0xabc', '0xdef', '0x123'];

      const result = deduplicateTransactionHashes(hashes);

      expect(result).toHaveLength(3);
      expect(result).toEqual(['0xabc', '0xdef', '0x123']);
    });

    it('should handle empty array', () => {
      const result = deduplicateTransactionHashes([]);
      expect(result).toHaveLength(0);
    });

    it('should handle array with all duplicates', () => {
      const hashes = ['0xabc', '0xabc', '0xabc'];

      const result = deduplicateTransactionHashes(hashes);

      expect(result).toHaveLength(1);
      expect(result).toEqual(['0xabc']);
    });

    it('should handle single hash', () => {
      const hashes = ['0xabc'];

      const result = deduplicateTransactionHashes(hashes);

      expect(result).toHaveLength(1);
      expect(result).toEqual(['0xabc']);
    });

    it('should preserve order of first occurrence', () => {
      const hashes = ['0x111', '0x222', '0x333', '0x222', '0x111'];

      const result = deduplicateTransactionHashes(hashes);

      expect(result).toEqual(['0x111', '0x222', '0x333']);
    });

    it('should be case-sensitive', () => {
      const hashes = ['0xabc', '0xABC', '0xAbC'];

      const result = deduplicateTransactionHashes(hashes);

      expect(result).toHaveLength(3);
      expect(result).toEqual(['0xabc', '0xABC', '0xAbC']);
    });
  });

  describe('mergeReceiptsIntoTransfers', () => {
    it('should merge receipt data into transfers', () => {
      const transfers: AlchemyAssetTransfer[] = [
        {
          blockNum: '0x123456',
          category: 'external',
          from: '0xsender',
          hash: '0xhash1',
          metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        },
        {
          blockNum: '0x123457',
          category: 'erc20',
          from: '0xsender',
          hash: '0xhash2',
          metadata: { blockTimestamp: new Date('2024-01-01T00:01:00Z') },
        },
      ];

      const receipts = new Map<string, AlchemyTransactionReceipt>([
        [
          '0xhash1',
          {
            blockHash: '0xblock1',
            blockNumber: '0x123456',
            contractAddress: undefined,
            cumulativeGasUsed: '21000',
            effectiveGasPrice: '50000000000',
            from: '0xsender',
            gasUsed: '21000',
            status: '0x1',
            to: '0xrecipient',
            transactionHash: '0xhash1',
            transactionIndex: '0x0',
          },
        ],
        [
          '0xhash2',
          {
            blockHash: '0xblock2',
            blockNumber: '0x123457',
            contractAddress: undefined,
            cumulativeGasUsed: '65000',
            effectiveGasPrice: '60000000000',
            from: '0xsender',
            gasUsed: '45000',
            status: '0x1',
            to: '0xtoken',
            transactionHash: '0xhash2',
            transactionIndex: '0x1',
          },
        ],
      ]);

      mergeReceiptsIntoTransfers(transfers, receipts, 'ETH');

      expect(transfers[0]?._gasUsed).toBe('21000');
      expect(transfers[0]?._effectiveGasPrice).toBe('50000000000');
      expect(transfers[0]?._nativeCurrency).toBe('ETH');

      expect(transfers[1]?._gasUsed).toBe('45000');
      expect(transfers[1]?._effectiveGasPrice).toBe('60000000000');
      expect(transfers[1]?._nativeCurrency).toBe('ETH');
    });

    it('should not modify transfers without matching receipts', () => {
      const transfers: AlchemyAssetTransfer[] = [
        {
          blockNum: '0x123456',
          category: 'external',
          from: '0xsender',
          hash: '0xhash1',
          metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        },
        {
          blockNum: '0x123457',
          category: 'erc20',
          from: '0xsender',
          hash: '0xhash2',
          metadata: { blockTimestamp: new Date('2024-01-01T00:01:00Z') },
        },
      ];

      const receipts = new Map<string, AlchemyTransactionReceipt>([
        [
          '0xhash1',
          {
            blockHash: '0xblock1',
            blockNumber: '0x123456',
            contractAddress: undefined,
            cumulativeGasUsed: '21000',
            effectiveGasPrice: '50000000000',
            from: '0xsender',
            gasUsed: '21000',
            status: '0x1',
            to: '0xrecipient',
            transactionHash: '0xhash1',
            transactionIndex: '0x0',
          },
        ],
      ]);

      mergeReceiptsIntoTransfers(transfers, receipts, 'ETH');

      expect(transfers[0]?._gasUsed).toBe('21000');
      expect(transfers[0]?._nativeCurrency).toBe('ETH');

      expect(transfers[1]?._gasUsed).toBeUndefined();
      expect(transfers[1]?._effectiveGasPrice).toBeUndefined();
      expect(transfers[1]?._nativeCurrency).toBeUndefined();
    });

    it('should handle empty receipts map', () => {
      const transfers: AlchemyAssetTransfer[] = [
        {
          blockNum: '0x123456',
          category: 'external',
          from: '0xsender',
          hash: '0xhash1',
          metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        },
      ];

      const receipts = new Map<string, AlchemyTransactionReceipt>();

      mergeReceiptsIntoTransfers(transfers, receipts, 'ETH');

      expect(transfers[0]?._gasUsed).toBeUndefined();
      expect(transfers[0]?._effectiveGasPrice).toBeUndefined();
      expect(transfers[0]?._nativeCurrency).toBeUndefined();
    });

    it('should handle empty transfers array', () => {
      const transfers: AlchemyAssetTransfer[] = [];
      const receipts = new Map<string, AlchemyTransactionReceipt>();

      expect(() => mergeReceiptsIntoTransfers(transfers, receipts, 'ETH')).not.toThrow();
    });

    it('should default effectiveGasPrice to 0 when not available', () => {
      const transfers: AlchemyAssetTransfer[] = [
        {
          blockNum: '0x123456',
          category: 'external',
          from: '0xsender',
          hash: '0xhash1',
          metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        },
      ];

      const receipts = new Map<string, AlchemyTransactionReceipt>([
        [
          '0xhash1',
          {
            blockHash: '0xblock1',
            blockNumber: '0x123456',
            contractAddress: undefined,
            cumulativeGasUsed: '21000',
            from: '0xsender',
            gasUsed: '21000',
            status: '0x1',
            to: '0xrecipient',
            transactionHash: '0xhash1',
            transactionIndex: '0x0',
          },
        ],
      ]);

      mergeReceiptsIntoTransfers(transfers, receipts, 'ETH');

      expect(transfers[0]?._gasUsed).toBe('21000');
      expect(transfers[0]?._effectiveGasPrice).toBe('0');
      expect(transfers[0]?._nativeCurrency).toBe('ETH');
    });

    it('should handle different native currencies', () => {
      const transfers: AlchemyAssetTransfer[] = [
        {
          blockNum: '0x123456',
          category: 'external',
          from: '0xsender',
          hash: '0xhash1',
          metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        },
      ];

      const receipts = new Map<string, AlchemyTransactionReceipt>([
        [
          '0xhash1',
          {
            blockHash: '0xblock1',
            blockNumber: '0x123456',
            contractAddress: undefined,
            cumulativeGasUsed: '21000',
            effectiveGasPrice: '50000000000',
            from: '0xsender',
            gasUsed: '21000',
            status: '0x1',
            to: '0xrecipient',
            transactionHash: '0xhash1',
            transactionIndex: '0x0',
          },
        ],
      ]);

      mergeReceiptsIntoTransfers(transfers, receipts, 'MATIC');

      expect(transfers[0]?._nativeCurrency).toBe('MATIC');
    });

    it('should modify transfers in place', () => {
      const transfers: AlchemyAssetTransfer[] = [
        {
          blockNum: '0x123456',
          category: 'external',
          from: '0xsender',
          hash: '0xhash1',
          metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        },
      ];

      const originalTransfer = transfers[0];

      const receipts = new Map<string, AlchemyTransactionReceipt>([
        [
          '0xhash1',
          {
            blockHash: '0xblock1',
            blockNumber: '0x123456',
            contractAddress: undefined,
            cumulativeGasUsed: '21000',
            effectiveGasPrice: '50000000000',
            from: '0xsender',
            gasUsed: '21000',
            status: '0x1',
            to: '0xrecipient',
            transactionHash: '0xhash1',
            transactionIndex: '0x0',
          },
        ],
      ]);

      mergeReceiptsIntoTransfers(transfers, receipts, 'ETH');

      expect(transfers[0]).toBe(originalTransfer);
      expect(originalTransfer?._gasUsed).toBe('21000');
    });

    it('should handle multiple transfers with same hash', () => {
      const transfers: AlchemyAssetTransfer[] = [
        {
          blockNum: '0x123456',
          category: 'external',
          from: '0xsender1',
          hash: '0xhash1',
          metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        },
        {
          blockNum: '0x123456',
          category: 'internal',
          from: '0xsender2',
          hash: '0xhash1',
          metadata: { blockTimestamp: new Date('2024-01-01T00:00:00Z') },
        },
      ];

      const receipts = new Map<string, AlchemyTransactionReceipt>([
        [
          '0xhash1',
          {
            blockHash: '0xblock1',
            blockNumber: '0x123456',
            contractAddress: undefined,
            cumulativeGasUsed: '21000',
            effectiveGasPrice: '50000000000',
            from: '0xsender',
            gasUsed: '21000',
            status: '0x1',
            to: '0xrecipient',
            transactionHash: '0xhash1',
            transactionIndex: '0x0',
          },
        ],
      ]);

      mergeReceiptsIntoTransfers(transfers, receipts, 'ETH');

      expect(transfers[0]?._gasUsed).toBe('21000');
      expect(transfers[1]?._gasUsed).toBe('21000');
      expect(transfers[0]?._nativeCurrency).toBe('ETH');
      expect(transfers[1]?._nativeCurrency).toBe('ETH');
    });
  });
});
