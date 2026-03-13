import { describe, expect, test } from 'vitest';

import {
  formatKuCoinValidationErrors,
  validateKuCoinAccountHistory,
  validateKuCoinDepositsWithdrawals,
  validateKuCoinOrderSplitting,
  validateKuCoinSpotOrders,
  validateKuCoinTradingBot,
} from '../utils.js';

function makeSpotOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    UID: 'user-1',
    'Account Type': 'trade',
    'Order ID': 'ORDER-1',
    'Order Time(UTC)': '2024-01-01 10:00:00',
    Symbol: 'BTC-USDT',
    Side: 'buy',
    'Order Type': 'limit',
    'Order Price': '42000',
    'Order Amount': '0.1',
    'Avg. Filled Price': '42000',
    'Filled Amount': '0.1',
    'Filled Volume': '4200',
    'Filled Volume (USDT)': '4200',
    'Filled Time(UTC)': '2024-01-01 10:01:00',
    Fee: '0.42',
    'Fee Currency': 'USDT',
    Tax: '',
    Status: 'deal',
    ...overrides,
  };
}

function makeDepositWithdrawalRow(overrides: Record<string, unknown> = {}) {
  return {
    UID: 'user-1',
    'Account Type': 'main',
    'Time(UTC)': '2024-01-01 09:00:00',
    Coin: 'BTC',
    Amount: '1.25',
    Fee: '0.001',
    Hash: 'hash-1',
    'Deposit Address': 'bc1qdeposit',
    'Withdrawal Address/Account': '',
    'Transfer Network': 'Bitcoin',
    Status: 'success',
    Remarks: '',
    ...overrides,
  };
}

function makeAccountHistoryRow(overrides: Record<string, unknown> = {}) {
  return {
    UID: 'user-1',
    'Account Type': 'trade',
    'Time(UTC)': '2024-01-01 11:00:00',
    Currency: 'USDT',
    Amount: '-20',
    Fee: '-0.2',
    Remark: 'trading fee',
    Side: 'out',
    Type: 'trading fee',
    ...overrides,
  };
}

function makeOrderSplittingRow(overrides: Record<string, unknown> = {}) {
  return {
    UID: 'user-1',
    'Account Type': 'trade',
    'Order ID': 'ORDER-1',
    Symbol: 'BTC-USDT',
    Side: 'sell',
    'Order Type': 'limit',
    'Avg. Filled Price': '43000',
    'Filled Amount': '0.05',
    'Filled Volume': '2150',
    'Filled Volume (USDT)': '2150',
    'Filled Time(UTC)': '2024-01-01 10:05:00',
    Fee: '0.2',
    'Fee Currency': 'USDT',
    Tax: '',
    'Maker/Taker': 'maker',
    ...overrides,
  };
}

function makeTradingBotRow(overrides: Record<string, unknown> = {}) {
  return {
    UID: 'user-1',
    'Account Type': 'subAccount',
    'Order ID': 'BOT-1',
    Symbol: 'ETH-USDT',
    Side: 'buy',
    'Order Type': 'market',
    'Filled Price': '3100',
    'Filled Amount': '0.5',
    'Filled Volume': '1550',
    'Filled Volume (USDT)': '1550',
    'Time Filled(UTC)': '2024-01-01 12:00:00',
    Fee: '1.55',
    'Fee Currency': 'USDT',
    Tax: '',
    ...overrides,
  };
}

describe('KuCoin CSV validation utilities', () => {
  test('validates spot orders and normalizes empty tax fields', () => {
    const result = validateKuCoinSpotOrders([makeSpotOrderRow()]);

    expect(result.section).toBe('spot-orders');
    expect(result.totalRows).toBe(1);
    expect(result.invalid).toEqual([]);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]?.Tax).toBeUndefined();
  });

  test('reports invalid deposit and withdrawal rows with their original index', () => {
    const result = validateKuCoinDepositsWithdrawals([
      makeDepositWithdrawalRow(),
      makeDepositWithdrawalRow({ Status: 'unknown-status' }),
    ]);

    expect(result.section).toBe('deposits-withdrawals');
    expect(result.totalRows).toBe(2);
    expect(result.valid).toHaveLength(1);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]?.rowIndex).toBe(1);
    expect(result.invalid[0]?.errors.issues[0]?.message).toContain('valid KuCoin transaction status');
  });

  test('accepts negative amounts for account history rows', () => {
    const result = validateKuCoinAccountHistory([makeAccountHistoryRow()]);

    expect(result.section).toBe('account-history');
    expect(result.invalid).toEqual([]);
    expect(result.valid[0]?.Amount).toBe('-20');
    expect(result.valid[0]?.Type).toBe('trading fee');
  });

  test('keeps valid and invalid order-splitting rows in separate buckets', () => {
    const result = validateKuCoinOrderSplitting([
      makeOrderSplittingRow(),
      makeOrderSplittingRow({ 'Maker/Taker': 'liquidity' }),
    ]);

    expect(result.section).toBe('order-splitting');
    expect(result.valid).toHaveLength(1);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]?.rowIndex).toBe(1);
  });

  test('validates trading bot fills with their dedicated field names', () => {
    const result = validateKuCoinTradingBot([makeTradingBotRow()]);

    expect(result.section).toBe('trading-bot');
    expect(result.totalRows).toBe(1);
    expect(result.invalid).toEqual([]);
    expect(result.valid[0]?.['Filled Price']).toBe('3100');
  });

  test('formats both success and truncated error summaries', () => {
    const successSummary = formatKuCoinValidationErrors(validateKuCoinTradingBot([makeTradingBotRow()]));
    expect(successSummary).toBe('All 1 KuCoin trading-bot rows validated successfully');

    const errorSummary = formatKuCoinValidationErrors(
      validateKuCoinSpotOrders([
        makeSpotOrderRow({ Side: 'hold' }),
        makeSpotOrderRow({ Status: 'open' }),
        makeSpotOrderRow({ 'Order Time(UTC)': 'bad-timestamp' }),
        makeSpotOrderRow({ 'Filled Amount': 'not-a-number' }),
      ])
    );

    expect(errorSummary).toContain('4 invalid KuCoin spot-orders rows out of 4. Valid: 0.');
    expect(errorSummary).toContain('Row 1:');
    expect(errorSummary).toContain('Row 2:');
    expect(errorSummary).toContain('Row 3:');
    expect(errorSummary).toContain('and 1 more');
  });
});
