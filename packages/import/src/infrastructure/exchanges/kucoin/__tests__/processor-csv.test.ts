import { describe, expect, test } from 'vitest';

import { KucoinProcessor } from '../processor-csv.ts';
import type {
  CsvAccountHistoryRow,
  CsvDepositWithdrawalRow,
  CsvOrderSplittingRow,
  CsvSpotOrderRow,
  CsvTradingBotRow,
} from '../types.js';

function createProcessor() {
  return new KucoinProcessor();
}

describe('KucoinProcessor (CSV) - Spot Order Handling', () => {
  test('processes spot buy order', async () => {
    const processor = createProcessor();

    const spotOrder: CsvSpotOrderRow & { _rowType: 'spot_order' } = {
      _rowType: 'spot_order',
      UID: 'user123',
      'Account Type': 'Trading Account',
      'Order ID': 'ORDER001',
      'Order Time(UTC)': '2024-01-01 10:00:00',
      Symbol: 'BTC-USDT',
      Side: 'buy',
      'Order Type': 'limit',
      'Order Price': '42000.00',
      'Order Amount': '0.1',
      'Avg. Filled Price': '42000.00',
      'Filled Amount': '0.1',
      'Filled Volume': '4200.00',
      'Filled Volume (USDT)': '4200.00',
      'Filled Time(UTC)': '2024-01-01 10:01:00',
      Fee: '0.42',
      'Fee Currency': 'USDT',
      Status: 'deal',
    };

    const result = await processor.process([spotOrder], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();

    if (!transaction) return;

    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('buy');
    expect(transaction.status).toBe('closed');

    // Verify movements: buy means we spent USDT (outflow) and received BTC (inflow)
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows[0]?.asset).toBe('USDT');
    expect(transaction.movements.outflows[0]?.amount.toString()).toBe('4200');

    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows[0]?.asset).toBe('BTC');
    expect(transaction.movements.inflows[0]?.amount.toString()).toBe('0.1');

    expect(transaction.fees.platform?.amount.toString()).toBe('0.42');
    expect(transaction.fees.platform?.currency.toString()).toBe('USDT');
  });

  test('processes spot sell order', async () => {
    const processor = createProcessor();

    const spotOrder: CsvSpotOrderRow & { _rowType: 'spot_order' } = {
      _rowType: 'spot_order',
      UID: 'user123',
      'Account Type': 'Trading Account',
      'Order ID': 'ORDER002',
      'Order Time(UTC)': '2024-01-01 11:00:00',
      Symbol: 'ETH-USDT',
      Side: 'sell',
      'Order Type': 'market',
      'Order Price': '0',
      'Order Amount': '1.0',
      'Avg. Filled Price': '2200.00',
      'Filled Amount': '1.0',
      'Filled Volume': '2200.00',
      'Filled Volume (USDT)': '2200.00',
      'Filled Time(UTC)': '2024-01-01 11:00:30',
      Fee: '2.2',
      'Fee Currency': 'USDT',
      Status: 'deal',
    };

    const result = await processor.process([spotOrder], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('sell');

    // Verify movements: sell means we spent ETH (outflow) and received USDT (inflow)
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows[0]?.asset).toBe('ETH');
    expect(transaction.movements.outflows[0]?.amount.toString()).toBe('1');

    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows[0]?.asset).toBe('USDT');
    expect(transaction.movements.inflows[0]?.amount.toString()).toBe('2200');
  });
});

describe('KucoinProcessor (CSV) - Order Splitting Handling', () => {
  test('processes order splitting buy', async () => {
    const processor = createProcessor();

    const orderSplitting: CsvOrderSplittingRow & { _rowType: 'order_splitting' } = {
      _rowType: 'order_splitting',
      UID: 'user123',
      'Account Type': 'Trading Account',
      'Order ID': 'ORDER003',
      Symbol: 'BTC-USDT',
      Side: 'buy',
      'Order Type': 'limit',
      'Avg. Filled Price': '42100.00',
      'Filled Amount': '0.05',
      'Filled Volume': '2105.00',
      'Filled Volume (USDT)': '2105.00',
      'Filled Time(UTC)': '2024-01-01 12:00:00',
      Fee: '0.21',
      'Fee Currency': 'USDT',
      'Maker/Taker': 'taker',
    };

    const result = await processor.process([orderSplitting], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();

    if (!transaction) return;

    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('buy');

    // Verify metadata includes maker/taker
    expect(transaction.metadata?.makerTaker).toBe('taker');
    expect(transaction.metadata?.fillType).toBe('order-splitting');
  });
});

describe('KucoinProcessor (CSV) - Deposit/Withdrawal Handling', () => {
  test('processes deposit with fee', async () => {
    const processor = createProcessor();

    const deposit: CsvDepositWithdrawalRow & { _rowType: 'deposit' } = {
      _rowType: 'deposit',
      UID: 'user123',
      'Account Type': 'Funding Account',
      Coin: 'BTC',
      Amount: '1.0',
      Fee: '0.0005',
      'Time(UTC)': '2024-01-01 08:00:00',
      'Transfer Network': 'BTC',
      Status: 'success',
      Hash: 'txhash123',
      'Deposit Address': 'bc1q...',
      Remarks: '',
    };

    const result = await processor.process([deposit], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
    expect(transaction.status).toBe('ok');

    // Verify net amount (gross - fee)
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows[0]?.asset).toBe('BTC');
    expect(transaction.movements.inflows[0]?.amount.toString()).toBe('0.9995');

    expect(transaction.fees.platform?.amount.toString()).toBe('0.0005');
    expect(transaction.fees.platform?.currency.toString()).toBe('BTC');

    expect(transaction.metadata?.hash).toBe('txhash123');
    expect(transaction.metadata?.address).toBe('bc1q...');
    expect(transaction.metadata?.transferNetwork).toBe('BTC');
  });

  test('processes withdrawal', async () => {
    const processor = createProcessor();

    const withdrawal: CsvDepositWithdrawalRow & { _rowType: 'withdrawal' } = {
      _rowType: 'withdrawal',
      UID: 'user123',
      'Account Type': 'Funding Account',
      Coin: 'ETH',
      Amount: '2.0',
      Fee: '0.01',
      'Time(UTC)': '2024-01-01 09:00:00',
      'Transfer Network': 'ETH',
      Status: 'success',
      Hash: 'txhash456',
      'Withdrawal Address/Account': '0x123...',
      Remarks: 'withdrawal to wallet',
    };

    const result = await processor.process([withdrawal], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');

    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows[0]?.asset).toBe('ETH');
    expect(transaction.movements.outflows[0]?.amount.toString()).toBe('2');

    expect(transaction.fees.platform?.amount.toString()).toBe('0.01');
  });
});

describe('KucoinProcessor (CSV) - Account History Handling', () => {
  test('processes convert market transaction pair', async () => {
    const processor = createProcessor();

    const deposit: CsvAccountHistoryRow & { _rowType: 'account_history' } = {
      _rowType: 'account_history',
      UID: 'user123',
      'Account Type': 'Trading Account',
      'Time(UTC)': '2024-01-01 13:00:00',
      Type: 'Convert Market',
      Currency: 'BTC',
      Amount: '0.1',
      Fee: '0',
      Side: 'Deposit',
      Remark: 'Convert Market',
    };

    const withdrawal: CsvAccountHistoryRow & { _rowType: 'account_history' } = {
      _rowType: 'account_history',
      UID: 'user123',
      'Account Type': 'Trading Account',
      'Time(UTC)': '2024-01-01 13:00:00',
      Type: 'Convert Market',
      Currency: 'USDT',
      Amount: '-4200',
      Fee: '0',
      Side: 'Withdrawal',
      Remark: 'Convert Market',
    };

    const result = await processor.process([deposit, withdrawal], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('swap');

    // Verify movements: swapped USDT for BTC
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows[0]?.asset).toBe('USDT');
    expect(transaction.movements.outflows[0]?.amount.toString()).toBe('4200');

    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows[0]?.asset).toBe('BTC');
    expect(transaction.movements.inflows[0]?.amount.toString()).toBe('0.1');

    expect(transaction.metadata?.type).toBe('convert_market');
  });

  test('skips non-convert account history entries', async () => {
    const processor = createProcessor();

    const transfer: CsvAccountHistoryRow & { _rowType: 'account_history' } = {
      _rowType: 'account_history',
      UID: 'user123',
      'Account Type': 'Trading Account',
      'Time(UTC)': '2024-01-01 14:00:00',
      Type: 'Transfer',
      Currency: 'USDT',
      Amount: '100',
      Fee: '0',
      Side: 'Deposit',
      Remark: 'Internal transfer',
    };

    const result = await processor.process([transfer], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Non-convert account history entries should be skipped
    expect(result.value).toHaveLength(0);
  });
});

describe('KucoinProcessor (CSV) - Trading Bot Handling', () => {
  test('processes trading bot buy order', async () => {
    const processor = createProcessor();

    const tradingBot: CsvTradingBotRow & { _rowType: 'trading_bot' } = {
      _rowType: 'trading_bot',
      UID: 'user123',
      'Account Type': 'Trading Account',
      'Order ID': 'BOT001',
      Symbol: 'BTC-USDT',
      Side: 'buy',
      'Order Type': 'limit',
      'Filled Price': '41000.00',
      'Filled Amount': '0.02',
      'Filled Volume': '820.00',
      'Filled Volume (USDT)': '820.00',
      'Time Filled(UTC)': '2024-01-01 15:00:00',
      Fee: '0.82',
      'Fee Currency': 'USDT',
    };

    const result = await processor.process([tradingBot], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('buy');

    expect(transaction.metadata?.fillType).toBe('trading-bot');
  });
});

describe('KucoinProcessor (CSV) - Error Handling', () => {
  test('handles malformed row gracefully', async () => {
    const processor = createProcessor();

    const malformedRow = {
      _rowType: 'spot_order',
      // Missing required fields
      Symbol: 'BTC-USDT',
    };

    const result = await processor.process([malformedRow], {});

    // Should not throw, but should skip the malformed row
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(0);
  });

  test('handles unknown row type', async () => {
    const processor = createProcessor();

    const unknownRow = {
      _rowType: 'unknown_type',
      data: 'test',
    };

    const result = await processor.process([unknownRow], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Unknown rows should be skipped
    expect(result.value).toHaveLength(0);
  });
});

describe('KucoinProcessor (CSV) - Mixed Transaction Types', () => {
  test('processes multiple transaction types in one batch', async () => {
    const processor = createProcessor();

    const spotOrder: CsvSpotOrderRow & { _rowType: 'spot_order' } = {
      _rowType: 'spot_order',
      UID: 'user123',
      'Account Type': 'Trading Account',
      'Order ID': 'ORDER004',
      'Order Time(UTC)': '2024-01-01 16:00:00',
      Symbol: 'BTC-USDT',
      Side: 'buy',
      'Order Type': 'limit',
      'Order Price': '40000.00',
      'Order Amount': '0.1',
      'Avg. Filled Price': '40000.00',
      'Filled Amount': '0.1',
      'Filled Volume': '4000.00',
      'Filled Volume (USDT)': '4000.00',
      'Filled Time(UTC)': '2024-01-01 16:01:00',
      Fee: '0.4',
      'Fee Currency': 'USDT',
      Status: 'deal',
    };

    const deposit: CsvDepositWithdrawalRow & { _rowType: 'deposit' } = {
      _rowType: 'deposit',
      UID: 'user123',
      'Account Type': 'Funding Account',
      Coin: 'USDT',
      Amount: '10000',
      Fee: '0',
      'Time(UTC)': '2024-01-01 15:00:00',
      'Transfer Network': 'TRC20',
      Status: 'success',
      Hash: 'txhash789',
      'Deposit Address': 'TR7...',
      Remarks: '',
    };

    const result = await processor.process([deposit, spotOrder], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Should process both transactions
    expect(result.value).toHaveLength(2);

    // Verify first is deposit
    expect(result.value[0]?.operation.type).toBe('deposit');

    // Verify second is buy
    expect(result.value[1]?.operation.type).toBe('buy');
  });
});
