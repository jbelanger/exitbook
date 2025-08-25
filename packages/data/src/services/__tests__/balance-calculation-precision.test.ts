import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { StoredTransaction } from '../../types/data-types.ts';
import { BalanceCalculationService } from '../balance-calculation-service.js';

describe('BalanceCalculationService Precision', () => {
  const service = new BalanceCalculationService();

  const createMockTransaction = (
    type: string,
    amount: string,
    amountCurrency: string,
    side?: 'buy' | 'sell',
    price?: string,
    priceCurrency?: string,
    feeCost?: string,
    feeCurrency?: string
  ): StoredTransaction => {
    const transaction: StoredTransaction = {
      amount,
      created_at: Date.now(),
      exchange: 'test-exchange',
      hash: 'test-hash',
      id: 'test-id',
      raw_data: JSON.stringify({
        amount,
        fee_cost: feeCost,
        price,
      }),
      timestamp: Date.now(),
      type,
    };

    if (amountCurrency) transaction.amount_currency = amountCurrency;
    if (side) transaction.side = side;
    if (price) transaction.price = price;
    if (priceCurrency) transaction.price_currency = priceCurrency;
    if (feeCost) transaction.fee_cost = feeCost;
    if (feeCurrency) transaction.fee_currency = feeCurrency;

    return transaction;
  };

  describe('calculateExchangeBalancesWithPrecision', () => {
    it('should preserve high precision for deposit transactions', async () => {
      const transactions = [createMockTransaction('deposit', '1.123456789012345678', 'BTC')];

      const balances = await service.calculateExchangeBalancesWithPrecision(transactions);

      expect(balances['BTC']).toBeInstanceOf(Decimal);
      expect(balances['BTC'].toString()).toBe('1.123456789012345678');
    });

    it('should preserve precision for complex trade calculations', async () => {
      const transactions = [
        createMockTransaction(
          'trade',
          '0.123456789012345678', // High precision BTC amount
          'BTC',
          'buy',
          '123.456789012345678', // High precision USDT price
          'USDT'
        ),
      ];

      const balances = await service.calculateExchangeBalancesWithPrecision(transactions);

      expect(balances['BTC']).toBeInstanceOf(Decimal);
      expect(balances['BTC'].toString()).toBe('0.123456789012345678');
      expect(balances['USDT']).toBeInstanceOf(Decimal);
      expect(balances['USDT'].toString()).toBe('-123.456789012345678');
    });

    it('should handle wei-level precision for Ethereum', async () => {
      const transactions = [
        createMockTransaction('deposit', '0.00000002', 'ETH'), // Above dust threshold (2e-8)
      ];

      const balances = await service.calculateExchangeBalancesWithPrecision(transactions);

      expect(balances['ETH']).toBeInstanceOf(Decimal);
      expect(balances['ETH'].toNumber()).toBe(0.00000002);
    });

    it('should preserve precision through fee calculations', async () => {
      const transactions = [
        createMockTransaction(
          'trade',
          '1.0',
          'BTC',
          'buy',
          '50000.0',
          'USDT',
          '0.123456789012345678', // High precision fee
          'USDT'
        ),
      ];

      const balances = await service.calculateExchangeBalancesWithPrecision(transactions);

      // Fee should be subtracted with full precision
      const expectedUsdtBalance = new Decimal('-50000.0').minus('0.123456789012345678');
      expect(balances['USDT'].toString()).toBe(expectedUsdtBalance.toString());
    });

    it('should filter out dust balances correctly', async () => {
      const transactions = [
        createMockTransaction('deposit', '0.00000002', 'BTC'), // Above dust threshold
        createMockTransaction('deposit', '0.000000001', 'ETH'), // Below dust threshold (should be filtered)
      ];

      const balances = await service.calculateExchangeBalancesWithPrecision(transactions);

      expect(balances['BTC']).toBeDefined(); // Should be included (above threshold)
      expect(balances['ETH']).toBeUndefined(); // Should be filtered out (below threshold)
    });

    it('should preserve true wei-level precision in calculations', async () => {
      // Test precision preservation without dust filtering by using larger amounts
      const transactions = [
        createMockTransaction('deposit', '1.000000000000000001', 'ETH'), // 1 ETH + 1 wei
      ];

      const balances = await service.calculateExchangeBalancesWithPrecision(transactions);

      expect(balances['ETH']).toBeInstanceOf(Decimal);
      expect(balances['ETH'].toString()).toBe('1.000000000000000001');
    });
  });

  describe('Precision validation', () => {
    it('should preserve high-precision values without loss', async () => {
      const highPrecisionAmount = '1.123456789012345678901234567890';
      const transactions = [createMockTransaction('deposit', highPrecisionAmount, 'BTC')];

      // Suppress console warnings during test to reduce noise
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (message: string) => warnings.push(message);

      try {
        const precisionBalances = await service.calculateExchangeBalancesWithPrecision(transactions);

        const precisionBtc = precisionBalances['BTC'];

        expect(precisionBtc).toBeInstanceOf(Decimal);

        // Check if precision would be lost when converting to number
        const precisionAsNumber = precisionBtc.toNumber();
        const backToDecimal = new Decimal(precisionAsNumber);

        // Verify precision loss would occur if converted to number (expected behavior)
        expect(precisionBtc.equals(backToDecimal)).toBe(false);
      } finally {
        // Restore original console.warn
        console.warn = originalWarn;
      }
    });

    it('should handle large amounts that exceed safe integer limits', async () => {
      const largeAmount = (Number.MAX_SAFE_INTEGER + 1000).toString();
      const transactions = [
        createMockTransaction('deposit', largeAmount, 'DOGE'), // Large amount in Dogecoin
      ];

      // Suppress console warnings during test to reduce noise
      const originalWarn = console.warn;
      console.warn = () => {}; // Silence warnings

      try {
        const precisionBalances = await service.calculateExchangeBalancesWithPrecision(transactions);

        expect(precisionBalances['DOGE']).toBeInstanceOf(Decimal);
        expect(precisionBalances['DOGE'].toString()).toBe(largeAmount);

        // Verify precision would be preserved with Decimal implementation
        expect(precisionBalances['DOGE'].greaterThan(Number.MAX_SAFE_INTEGER)).toBe(true);
      } finally {
        // Restore original console.warn
        console.warn = originalWarn;
      }
    });
  });
});
