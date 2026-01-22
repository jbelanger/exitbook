import { describe, expect, it } from 'vitest';

import { createRawBalanceData } from '../balance-utils.ts';
import { calculateSimpleBalance } from '../providers/blockcypher/utils.ts';
import type { BlockstreamAddressInfo } from '../providers/blockstream/blockstream.schemas.ts';
import { calculateBlockstreamBalance } from '../providers/blockstream/utils.ts';
import type { MempoolAddressInfo } from '../providers/mempool-space/mempool-space.schemas.ts';
import { calculateMempoolSpaceBalance } from '../providers/mempool-space/utils.ts';
import { calculateTatumBalance } from '../providers/tatum/utils.ts';
import { satoshisToBtcString } from '../utils.ts';

describe('balance-utils', () => {
  describe('satoshisToBtcString', () => {
    it('should convert satoshis to BTC correctly', () => {
      expect(satoshisToBtcString(100000000)).toBe('1');
      expect(satoshisToBtcString(50000000)).toBe('0.5');
      expect(satoshisToBtcString(1000)).toBe('0.00001');
      expect(satoshisToBtcString(1)).toBe('0.00000001');
    });

    it('should handle zero satoshis', () => {
      expect(satoshisToBtcString(0)).toBe('0');
    });

    it('should handle large amounts', () => {
      expect(satoshisToBtcString(2100000000000000)).toBe('21000000');
    });

    it('should handle fractional satoshis in conversion', () => {
      expect(satoshisToBtcString(123456789)).toBe('1.23456789');
    });
  });

  describe('calculateBlockstreamBalance', () => {
    it('should calculate balance with only chain stats', () => {
      const addressInfo: BlockstreamAddressInfo = {
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        chain_stats: {
          funded_txo_count: 10,
          funded_txo_sum: 5000000000, // 50 BTC
          spent_txo_count: 5,
          spent_txo_sum: 1000000000, // 10 BTC
          tx_count: 15,
        },
        mempool_stats: {
          funded_txo_count: 0,
          funded_txo_sum: 0,
          spent_txo_count: 0,
          spent_txo_sum: 0,
          tx_count: 0,
        },
      };

      const result = calculateBlockstreamBalance(addressInfo);

      expect(result.balanceBTC).toBe('40');
      expect(result.totalBalanceSats).toBe(4000000000);
      expect(result.txCount).toBe(15);
      expect(result.hasTransactions).toBe(true);
    });

    it('should calculate balance with chain and mempool stats', () => {
      const addressInfo: BlockstreamAddressInfo = {
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        chain_stats: {
          funded_txo_count: 10,
          funded_txo_sum: 5000000000, // 50 BTC
          spent_txo_count: 5,
          spent_txo_sum: 1000000000, // 10 BTC
          tx_count: 15,
        },
        mempool_stats: {
          funded_txo_count: 2,
          funded_txo_sum: 500000000, // 5 BTC
          spent_txo_count: 1,
          spent_txo_sum: 100000000, // 1 BTC
          tx_count: 3,
        },
      };

      const result = calculateBlockstreamBalance(addressInfo);

      expect(result.balanceBTC).toBe('44');
      expect(result.totalBalanceSats).toBe(4400000000);
      expect(result.txCount).toBe(18);
      expect(result.hasTransactions).toBe(true);
    });

    it('should handle zero balance', () => {
      const addressInfo: BlockstreamAddressInfo = {
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        chain_stats: {
          funded_txo_count: 5,
          funded_txo_sum: 1000000000,
          spent_txo_count: 5,
          spent_txo_sum: 1000000000,
          tx_count: 10,
        },
        mempool_stats: {
          funded_txo_count: 0,
          funded_txo_sum: 0,
          spent_txo_count: 0,
          spent_txo_sum: 0,
          tx_count: 0,
        },
      };

      const result = calculateBlockstreamBalance(addressInfo);

      expect(result.balanceBTC).toBe('0');
      expect(result.totalBalanceSats).toBe(0);
      expect(result.txCount).toBe(10);
      expect(result.hasTransactions).toBe(true);
    });

    it('should indicate no transactions when address is unused', () => {
      const addressInfo: BlockstreamAddressInfo = {
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        chain_stats: {
          funded_txo_count: 0,
          funded_txo_sum: 0,
          spent_txo_count: 0,
          spent_txo_sum: 0,
          tx_count: 0,
        },
        mempool_stats: {
          funded_txo_count: 0,
          funded_txo_sum: 0,
          spent_txo_count: 0,
          spent_txo_sum: 0,
          tx_count: 0,
        },
      };

      const result = calculateBlockstreamBalance(addressInfo);

      expect(result.balanceBTC).toBe('0');
      expect(result.totalBalanceSats).toBe(0);
      expect(result.txCount).toBe(0);
      expect(result.hasTransactions).toBe(false);
    });

    it('should handle negative balance (more spent than funded)', () => {
      const addressInfo: BlockstreamAddressInfo = {
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        chain_stats: {
          funded_txo_count: 5,
          funded_txo_sum: 1000000000, // 10 BTC
          spent_txo_count: 10,
          spent_txo_sum: 5000000000, // 50 BTC
          tx_count: 15,
        },
        mempool_stats: {
          funded_txo_count: 0,
          funded_txo_sum: 0,
          spent_txo_count: 0,
          spent_txo_sum: 0,
          tx_count: 0,
        },
      };

      const result = calculateBlockstreamBalance(addressInfo);

      expect(result.balanceBTC).toBe('-40');
      expect(result.totalBalanceSats).toBe(-4000000000);
      expect(result.txCount).toBe(15);
      expect(result.hasTransactions).toBe(true);
    });

    it('should handle very small balance (dust)', () => {
      const addressInfo: BlockstreamAddressInfo = {
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        chain_stats: {
          funded_txo_count: 1,
          funded_txo_sum: 1000, // 0.00001 BTC
          spent_txo_count: 1,
          spent_txo_sum: 500, // 0.000005 BTC
          tx_count: 2,
        },
        mempool_stats: {
          funded_txo_count: 0,
          funded_txo_sum: 0,
          spent_txo_count: 0,
          spent_txo_sum: 0,
          tx_count: 0,
        },
      };

      const result = calculateBlockstreamBalance(addressInfo);

      expect(result.balanceBTC).toBe('0.000005');
      expect(result.totalBalanceSats).toBe(500);
      expect(result.txCount).toBe(2);
      expect(result.hasTransactions).toBe(true);
    });
  });

  describe('calculateMempoolSpaceBalance', () => {
    it('should calculate balance with only chain stats', () => {
      const addressInfo: MempoolAddressInfo = {
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        chain_stats: {
          funded_txo_count: 10,
          funded_txo_sum: 5000000000, // 50 BTC
          spent_txo_count: 5,
          spent_txo_sum: 1000000000, // 10 BTC
          tx_count: 15,
        },
        mempool_stats: {
          funded_txo_count: 0,
          funded_txo_sum: 0,
          spent_txo_count: 0,
          spent_txo_sum: 0,
          tx_count: 0,
        },
      };

      const result = calculateMempoolSpaceBalance(addressInfo);

      expect(result.balanceBTC).toBe('40');
      expect(result.totalBalanceSats).toBe(4000000000);
      expect(result.txCount).toBe(15);
      expect(result.hasTransactions).toBe(true);
    });

    it('should calculate balance with chain and mempool stats', () => {
      const addressInfo: MempoolAddressInfo = {
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        chain_stats: {
          funded_txo_count: 10,
          funded_txo_sum: 5000000000, // 50 BTC
          spent_txo_count: 5,
          spent_txo_sum: 1000000000, // 10 BTC
          tx_count: 15,
        },
        mempool_stats: {
          funded_txo_count: 2,
          funded_txo_sum: 500000000, // 5 BTC
          spent_txo_count: 1,
          spent_txo_sum: 100000000, // 1 BTC
          tx_count: 3,
        },
      };

      const result = calculateMempoolSpaceBalance(addressInfo);

      expect(result.balanceBTC).toBe('44');
      expect(result.totalBalanceSats).toBe(4400000000);
      expect(result.txCount).toBe(18);
      expect(result.hasTransactions).toBe(true);
    });

    it('should handle zero balance', () => {
      const addressInfo: MempoolAddressInfo = {
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        chain_stats: {
          funded_txo_count: 5,
          funded_txo_sum: 1000000000,
          spent_txo_count: 5,
          spent_txo_sum: 1000000000,
          tx_count: 10,
        },
        mempool_stats: {
          funded_txo_count: 0,
          funded_txo_sum: 0,
          spent_txo_count: 0,
          spent_txo_sum: 0,
          tx_count: 0,
        },
      };

      const result = calculateMempoolSpaceBalance(addressInfo);

      expect(result.balanceBTC).toBe('0');
      expect(result.totalBalanceSats).toBe(0);
      expect(result.txCount).toBe(10);
      expect(result.hasTransactions).toBe(true);
    });

    it('should indicate no transactions when address is unused', () => {
      const addressInfo: MempoolAddressInfo = {
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        chain_stats: {
          funded_txo_count: 0,
          funded_txo_sum: 0,
          spent_txo_count: 0,
          spent_txo_sum: 0,
          tx_count: 0,
        },
        mempool_stats: {
          funded_txo_count: 0,
          funded_txo_sum: 0,
          spent_txo_count: 0,
          spent_txo_sum: 0,
          tx_count: 0,
        },
      };

      const result = calculateMempoolSpaceBalance(addressInfo);

      expect(result.balanceBTC).toBe('0');
      expect(result.totalBalanceSats).toBe(0);
      expect(result.txCount).toBe(0);
      expect(result.hasTransactions).toBe(false);
    });
  });

  describe('calculateTatumBalance', () => {
    it('should calculate balance from incoming and outgoing strings', () => {
      const result = calculateTatumBalance('5000000000', '1000000000');

      expect(result.balanceBTC).toBe('40');
      expect(result.balanceSats).toBe(4000000000);
    });

    it('should handle zero balance', () => {
      const result = calculateTatumBalance('1000000000', '1000000000');

      expect(result.balanceBTC).toBe('0');
      expect(result.balanceSats).toBe(0);
    });

    it('should handle zero incoming', () => {
      const result = calculateTatumBalance('0', '0');

      expect(result.balanceBTC).toBe('0');
      expect(result.balanceSats).toBe(0);
    });

    it('should handle negative balance', () => {
      const result = calculateTatumBalance('1000000000', '5000000000');

      expect(result.balanceBTC).toBe('-40');
      expect(result.balanceSats).toBe(-4000000000);
    });

    it('should handle large amounts', () => {
      const result = calculateTatumBalance('2100000000000000', '100000000000000');

      expect(result.balanceBTC).toBe('20000000');
      expect(result.balanceSats).toBe(2000000000000000);
    });

    it('should handle fractional satoshis in string format', () => {
      const result = calculateTatumBalance('123456789', '23456789');

      expect(result.balanceBTC).toBe('1');
      expect(result.balanceSats).toBe(100000000);
    });
  });

  describe('calculateSimpleBalance', () => {
    it('should calculate balance from final balance number', () => {
      const result = calculateSimpleBalance(4000000000);

      expect(result.balanceBTC).toBe('40');
      expect(result.balanceSats).toBe(4000000000);
    });

    it('should handle zero balance', () => {
      const result = calculateSimpleBalance(0);

      expect(result.balanceBTC).toBe('0');
      expect(result.balanceSats).toBe(0);
    });

    it('should handle small balance', () => {
      const result = calculateSimpleBalance(1000);

      expect(result.balanceBTC).toBe('0.00001');
      expect(result.balanceSats).toBe(1000);
    });

    it('should handle large balance', () => {
      const result = calculateSimpleBalance(2100000000000000);

      expect(result.balanceBTC).toBe('21000000');
      expect(result.balanceSats).toBe(2100000000000000);
    });

    it('should handle one satoshi', () => {
      const result = calculateSimpleBalance(1);

      expect(result.balanceBTC).toBe('0.00000001');
      expect(result.balanceSats).toBe(1);
    });
  });

  describe('createRawBalanceData', () => {
    it('should create RawBalanceData with correct structure', () => {
      const result = createRawBalanceData(4000000000, '40', 'BTC');

      expect(result).toEqual({
        symbol: 'BTC',
        rawAmount: '4000000000',
        decimalAmount: '40',
        decimals: 8,
      });
    });

    it('should handle zero balance', () => {
      const result = createRawBalanceData(0, '0', 'BTC');

      expect(result).toEqual({
        symbol: 'BTC',
        rawAmount: '0',
        decimalAmount: '0',
        decimals: 8,
      });
    });

    it('should handle large balance', () => {
      const result = createRawBalanceData(2100000000000000, '21000000', 'BTC');

      expect(result).toEqual({
        symbol: 'BTC',
        rawAmount: '2100000000000000',
        decimalAmount: '21000000',
        decimals: 8,
      });
    });

    it('should handle fractional BTC amounts', () => {
      const result = createRawBalanceData(123456789, '1.23456789', 'BTC');

      expect(result).toEqual({
        symbol: 'BTC',
        rawAmount: '123456789',
        decimalAmount: '1.23456789',
        decimals: 8,
      });
    });

    it('should always set decimals to 8 for BTC', () => {
      const result = createRawBalanceData(100000000, '1', 'BTC');

      expect(result.decimals).toBe(8);
    });

    it('should always set symbol to BTC', () => {
      const result = createRawBalanceData(100000000, '1', 'BTC');

      expect(result.symbol).toBe('BTC');
    });
  });
});
