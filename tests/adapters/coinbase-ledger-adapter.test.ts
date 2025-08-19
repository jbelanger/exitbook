import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { Decimal } from 'decimal.js';
import { CoinbaseCCXTAdapter } from '../../src/adapters/coinbase-ccxt-adapter';
import type { ExchangeConfig, ExchangeTransaction } from '../../src/types/index';

describe('CoinbaseCCXTAdapter', () => {
  let adapter: CoinbaseCCXTAdapter;
  let mockConfig: ExchangeConfig;

  beforeEach(() => {
    mockConfig = {
      id: 'coinbase',
      adapterType: 'ccxt',
      enabled: true,
      credentials: {
        apiKey: process.env.COINBASE_API_KEY || 'test-api-key',
        secret: process.env.COINBASE_SECRET || 'test-secret',
        password: process.env.COINBASE_PASSPHRASE || 'test-passphrase'
      },
      options: {}
    };
  });

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
    }
  });

  describe('Unit Tests - Core Logic', () => {
    beforeEach(() => {
      adapter = new CoinbaseCCXTAdapter(mockConfig, false);
    });

    describe('Fee Deduplication', () => {
      test('should deduplicate identical fees from same order', () => {
        // Mock entries with duplicate fees (same order ID)
        const entries: ExchangeTransaction[] = [
          {
            id: 'entry1',
            type: 'trade',
            timestamp: 1640995200000,
            datetime: '2022-01-01T00:00:00.000Z',
            symbol: 'BTC-USD',
            amount: { amount: new Decimal('0.01'), currency: 'BTC' },
            side: 'buy',
            status: 'closed',
            info: {
              direction: 'in',
              currency: 'BTC',
              info: {
                buy: {
                  id: 'order-123',
                  fee: { amount: '10.00', currency: 'USD' },
                  total: { amount: '1000.00', currency: 'USD' }
                }
              }
            }
          },
          {
            id: 'entry2',
            type: 'trade',
            timestamp: 1640995200000,
            datetime: '2022-01-01T00:00:00.000Z',
            symbol: 'BTC-USD',
            amount: { amount: new Decimal('1000'), currency: 'USD' },
            side: 'buy',
            status: 'closed',
            info: {
              direction: 'out',
              currency: 'USD',
              info: {
                buy: {
                  id: 'order-123', // Same order ID
                  fee: { amount: '10.00', currency: 'USD' }, // Same fee
                  total: { amount: '1000.00', currency: 'USD' }
                }
              }
            }
          }
        ];

        const result = (adapter as any).combineMultipleLedgerEntries('order-123', entries);

        expect(result).toBeDefined();
        expect(result.fee).toBeDefined();
        expect(result.fee.amount).toEqual(new Decimal('10.00')); // Should be 10, not 20
        expect(result.fee.currency).toBe('USD');
      });

      test('should handle entries with no fees', () => {
        const entries: ExchangeTransaction[] = [
          {
            id: 'entry1',
            type: 'trade',
            timestamp: 1640995200000,
            datetime: '2022-01-01T00:00:00.000Z',
            symbol: 'BTC-USD',
            amount: { amount: new Decimal('0.01'), currency: 'BTC' },
            side: 'buy',
            status: 'closed',
            info: {
              direction: 'in',
              currency: 'BTC',
              info: {}
            }
          }
        ];

        const result = (adapter as any).combineMultipleLedgerEntries('order-123', entries);

        expect(result).toBeDefined();
        expect(result.fee).toBeUndefined();
      });
    });

    describe('Buy/Sell Direction Logic', () => {
      test('should correctly handle BUY trade directions', () => {
        const entries: ExchangeTransaction[] = [
          {
            id: 'btc-in',
            type: 'trade',
            timestamp: 1640995200000,
            datetime: '2022-01-01T00:00:00.000Z',
            symbol: 'BTC-USD',
            amount: { amount: new Decimal('0.02'), currency: 'BTC' },
            side: 'buy',
            status: 'closed',
            info: {
              direction: 'in', // Receiving BTC
              currency: 'BTC',
              info: {
                advanced_trade_fill: {
                  order_side: 'buy',
                  product_id: 'BTC-USD'
                }
              }
            }
          },
          {
            id: 'usd-out',
            type: 'trade',
            timestamp: 1640995200000,
            datetime: '2022-01-01T00:00:00.000Z',
            symbol: 'BTC-USD',
            amount: { amount: new Decimal('2000'), currency: 'USD' },
            side: 'buy',
            status: 'closed',
            info: {
              direction: 'out', // Spending USD
              currency: 'USD',
              info: {
                advanced_trade_fill: {
                  order_side: 'buy',
                  product_id: 'BTC-USD'
                }
              }
            }
          }
        ];

        const result = (adapter as any).combineMultipleLedgerEntries('buy-order-123', entries);

        expect(result).toBeDefined();
        expect(result.side).toBe('buy');
        expect(result.amount.currency).toBe('BTC'); // Base currency
        expect(result.amount.amount).toEqual(new Decimal('0.02'));
        expect(result.price.currency).toBe('USD'); // Quote currency
        expect(result.price.amount).toEqual(new Decimal('2000'));
      });

      test('should correctly handle SELL trade directions', () => {
        const entries: ExchangeTransaction[] = [
          {
            id: 'btc-out',
            type: 'trade',
            timestamp: 1640995200000,
            datetime: '2022-01-01T00:00:00.000Z',
            symbol: 'BTC-USD',
            amount: { amount: new Decimal('0.05'), currency: 'BTC' },
            side: 'sell',
            status: 'closed',
            info: {
              direction: 'out', // Sending BTC
              currency: 'BTC',
              info: {
                advanced_trade_fill: {
                  order_side: 'sell',
                  product_id: 'BTC-USD'
                }
              }
            }
          },
          {
            id: 'usd-in',
            type: 'trade',
            timestamp: 1640995200000,
            datetime: '2022-01-01T00:00:00.000Z',
            symbol: 'BTC-USD',
            amount: { amount: new Decimal('5000'), currency: 'USD' },
            side: 'sell',
            status: 'closed',
            info: {
              direction: 'in', // Receiving USD
              currency: 'USD',
              info: {
                advanced_trade_fill: {
                  order_side: 'sell',
                  product_id: 'BTC-USD'
                }
              }
            }
          }
        ];

        const result = (adapter as any).combineMultipleLedgerEntries('sell-order-456', entries);

        expect(result).toBeDefined();
        expect(result.side).toBe('sell');
        expect(result.amount.currency).toBe('BTC'); // Base currency being sold
        expect(result.amount.amount).toEqual(new Decimal('0.05'));
        expect(result.price.currency).toBe('USD'); // Quote currency received
        expect(result.price.amount).toEqual(new Decimal('5000'));
      });
    });

    describe('Price Calculation (Excluding Fees)', () => {
      test('should subtract fees from price when currencies match', () => {
        const entries: ExchangeTransaction[] = [
          {
            id: 'entry1',
            type: 'trade',
            timestamp: 1640995200000,
            datetime: '2022-01-01T00:00:00.000Z',
            symbol: 'BTC-USD',
            amount: { amount: new Decimal('0.01'), currency: 'BTC' },
            side: 'buy',
            status: 'closed',
            info: {
              direction: 'in',
              currency: 'BTC',
              info: {
                buy: {
                  id: 'order-123',
                  fee: { amount: '25.00', currency: 'USD' },
                  total: { amount: '1025.00', currency: 'USD' }
                },
                advanced_trade_fill: {
                  order_side: 'buy',
                  product_id: 'BTC-USD'
                }
              }
            }
          },
          {
            id: 'entry2',
            type: 'trade',
            timestamp: 1640995200000,
            datetime: '2022-01-01T00:00:00.000Z',
            symbol: 'BTC-USD',
            amount: { amount: new Decimal('1025'), currency: 'USD' },
            side: 'buy',
            status: 'closed',
            info: {
              direction: 'out',
              currency: 'USD',
              info: {
                buy: {
                  id: 'order-123',
                  fee: { amount: '25.00', currency: 'USD' },
                  total: { amount: '1025.00', currency: 'USD' }
                },
                advanced_trade_fill: {
                  order_side: 'buy',
                  product_id: 'BTC-USD'
                }
              }
            }
          }
        ];

        const result = (adapter as any).combineMultipleLedgerEntries('order-123', entries);

        expect(result).toBeDefined();
        expect(result.price.amount).toEqual(new Decimal('1000.00')); // 1025 - 25 fee
        expect(result.fee.amount).toEqual(new Decimal('25.00'));
      });
    });

    describe('Transaction Type Detection', () => {
      test('should detect send+in as deposit', () => {
        const info = {
          type: 'transaction',
          direction: 'in',
          info: { type: 'send' }
        };

        const result = (adapter as any).extractTransactionType(info);
        expect(result).toBe('deposit');
      });

      test('should detect send+out as withdrawal', () => {
        const info = {
          type: 'transaction',
          direction: 'out',
          info: { type: 'send' }
        };

        const result = (adapter as any).extractTransactionType(info);
        expect(result).toBe('withdrawal');
      });
    });

    describe('Price Extraction Rules', () => {
      test('should not extract price for deposits', () => {
        const info = { type: 'deposit' };
        const result = (adapter as any).extractPriceFromInfo(info, undefined, 'deposit');
        expect(result).toBeUndefined();
      });

      test('should not extract price for withdrawals', () => {
        const info = { type: 'withdrawal' };
        const result = (adapter as any).extractPriceFromInfo(info, undefined, 'withdrawal');
        expect(result).toBeUndefined();
      });

      test('should extract price for trades', () => {
        const info = {
          info: {
            buy: {
              total: { amount: '1000.50', currency: 'USD' }
            }
          }
        };
        const result = (adapter as any).extractPriceFromInfo(info, undefined, 'trade');
        expect(result).toBeDefined();
        expect(result.amount).toEqual(new Decimal('1000.50'));
        expect(result.currency).toBe('USD');
      });
    });
  });

  describe('E2E Tests - Real Coinbase API', () => {
    beforeEach(() => {
      // Skip E2E tests if no credentials
      if (!process.env.COINBASE_API_KEY || !process.env.COINBASE_SECRET || !process.env.COINBASE_PASSPHRASE) {
        console.warn('Skipping E2E tests - Coinbase API credentials not found');
        return;
      }
      adapter = new CoinbaseCCXTAdapter(mockConfig, true);
    });

    test('should connect to Coinbase API', async () => {
      if (!process.env.COINBASE_API_KEY) {
        console.warn('Skipping E2E test - no credentials');
        return;
      }

      const connected = await adapter.testConnection();
      expect(connected).toBe(true);
    }, 30000);

    test('should fetch and process real ledger data', async () => {
      if (!process.env.COINBASE_API_KEY) {
        console.warn('Skipping E2E test - no credentials');
        return;
      }

      // Fetch last 30 days of data
      const since = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const transactions = await adapter.fetchAllTransactions(since);

      expect(Array.isArray(transactions)).toBe(true);

      // Verify structure of returned transactions
      for (const tx of transactions.slice(0, 5)) { // Test first 5
        expect(tx).toHaveProperty('id');
        expect(tx).toHaveProperty('type');
        expect(tx).toHaveProperty('timestamp');
        expect(typeof tx.timestamp).toBe('number');

        if (tx.type === 'trade') {
          expect(tx).toHaveProperty('symbol');
          expect(tx).toHaveProperty('side');
          expect(['buy', 'sell']).toContain(tx.side);
          expect(tx).toHaveProperty('amount');
          expect(tx.amount).toHaveProperty('amount');
          expect(tx.amount).toHaveProperty('currency');

          // Price should be present for trades
          expect(tx).toHaveProperty('price');
          if (tx.price) {
            expect(tx.price).toHaveProperty('amount');
            expect(tx.price).toHaveProperty('currency');
          }
        }

        if (tx.type === 'deposit' || tx.type === 'withdrawal') {
          // Deposits/withdrawals should NOT have price
          expect(tx.price).toBeUndefined();
          expect(tx).toHaveProperty('amount');
          expect(tx.amount).toHaveProperty('currency');
        }
      }
    }, 60000);

    test('should properly combine trade entries', async () => {
      if (!process.env.COINBASE_API_KEY) {
        console.warn('Skipping E2E test - no credentials');
        return;
      }

      const since = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const transactions = await adapter.fetchAllTransactions(since);

      const trades = transactions.filter(tx => tx.type === 'trade');

      if (trades.length > 0) {
        const trade = trades[0];

        // Verify combined trade structure
        expect(trade?.id).toMatch(/-combined$/);
        expect(trade?.symbol).toMatch(/^[A-Z]+-[A-Z]+$/);
        expect(['buy', 'sell']).toContain(trade?.side);

        // Verify amounts are positive
        expect(trade?.amount?.amount?.greaterThan(0)).toBe(true);
        if (trade?.price) {
          expect(trade.price.amount.greaterThan(0)).toBe(true);
        }

        // Verify fee deduplication worked (no impossibly high fees)
        if (trade?.fee) {
          expect(trade.fee.amount.greaterThan(0)).toBe(true);
          // Fee should be reasonable (less than 10% of trade value)
          if (trade.price) {
            const feePercentage = trade.fee.amount.dividedBy(trade.price.amount).mul(100);
            expect(feePercentage.lessThan(10)).toBe(true);
          }
        }
      }
    }, 60000);

    test('should handle API errors gracefully', async () => {
      if (!process.env.COINBASE_API_KEY) {
        console.warn('Skipping E2E test - no credentials');
        return;
      }

      // Test with invalid since date (should handle gracefully)
      const invalidSince = Date.now() + (365 * 24 * 60 * 60 * 1000); // Future date

      await expect(async () => {
        await adapter.fetchAllTransactions(invalidSince);
      }).not.toThrow();
    }, 30000);
  });

  describe('API Regression Tests', () => {
    test('should verify Coinbase API response structure has not changed', async () => {
      if (!process.env.COINBASE_API_KEY) {
        console.warn('Skipping regression test - no credentials');
        return;
      }

      adapter = new CoinbaseCCXTAdapter(mockConfig, true);

      // Test that we can still access the nested structures we depend on
      const since = Date.now() - (7 * 24 * 60 * 60 * 1000); // Last week
      const rawLedger = await (adapter as any).fetchLedger(since);

      if (rawLedger.length > 0) {
        const entry = rawLedger[0];

        // Verify the double-nested structure still exists
        expect(entry).toHaveProperty('info');
        if (entry.info && typeof entry.info === 'object') {
          // This is the critical structure we depend on
          expect(entry.info).toHaveProperty('info');

          const nestedInfo = entry.info.info;
          if (nestedInfo && typeof nestedInfo === 'object') {
            // Check that at least one expected field exists
            const hasExpectedFields =
              nestedInfo.hasOwnProperty('buy') ||
              nestedInfo.hasOwnProperty('sell') ||
              nestedInfo.hasOwnProperty('advanced_trade_fill') ||
              nestedInfo.hasOwnProperty('type');

            expect(hasExpectedFields).toBe(true);
          }
        }
      }
    }, 30000);
  });
});