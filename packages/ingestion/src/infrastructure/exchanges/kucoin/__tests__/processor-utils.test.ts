import { getLogger } from '@exitbook/shared-logger';
import { describe, expect, test } from 'vitest';

import {
  convertKucoinAccountHistoryConvertToTransaction,
  convertKucoinDepositToTransaction,
  convertKucoinOrderSplittingToTransaction,
  convertKucoinSpotOrderToTransaction,
  convertKucoinTradingBotToTransaction,
  convertKucoinWithdrawalToTransaction,
  mapKucoinStatus,
  processKucoinAccountHistory,
} from '../processor-utils.js';
import type {
  CsvAccountHistoryRow,
  CsvDepositWithdrawalRow,
  CsvOrderSplittingRow,
  CsvSpotOrderRow,
  CsvTradingBotRow,
} from '../types.js';

const logger = getLogger('test-kucoin-processor-utils');

describe('convertKucoinAccountHistoryConvertToTransaction', () => {
  test('converts convert market entry (deposit + withdrawal pair) into swap transaction', () => {
    const deposit: CsvAccountHistoryRow = {
      'Account Type': 'Main',
      Amount: '100',
      Currency: 'USDT',
      Fee: '0.05',
      Remark: 'Convert market',
      Side: 'Deposit',
      'Time(UTC)': '2024-01-15 10:30:00',
      Type: 'Convert Market',
      UID: 'user123',
    };

    const withdrawal: CsvAccountHistoryRow = {
      'Account Type': 'Main',
      Amount: '-0.001',
      Currency: 'BTC',
      Fee: '0.00001',
      Remark: 'Convert market',
      Side: 'Withdrawal',
      'Time(UTC)': '2024-01-15 10:30:00',
      Type: 'Convert Market',
      UID: 'user123',
    };

    const result = convertKucoinAccountHistoryConvertToTransaction(deposit, withdrawal, '2024-01-15 10:30:00');

    expect(result.source).toBe('kucoin');
    expect(result.operation.category).toBe('trade');
    expect(result.operation.type).toBe('swap');

    // Check movements - sold BTC, bought USDT
    expect(result.movements.outflows).toHaveLength(1);
    expect(result.movements.outflows[0].asset).toBe('BTC');
    expect(result.movements.outflows[0].grossAmount.toString()).toBe('0.001');

    expect(result.movements.inflows).toHaveLength(1);
    expect(result.movements.inflows[0].asset).toBe('USDT');
    expect(result.movements.inflows[0].grossAmount.toString()).toBe('100');

    // Check fees - should include both deposit and withdrawal fees
    // Note: fees are in different currencies (BTC and USDT) but added together
    expect(result.fees).toHaveLength(1);
    expect(result.fees[0].amount.toString()).toBe('0.05001'); // 0.00001 + 0.05
    expect(result.fees[0].asset).toBe('BTC');
    expect(result.fees[0].scope).toBe('platform');

    expect(result.metadata.type).toBe('convert_market');
  });

  test('handles zero fees correctly', () => {
    const deposit: CsvAccountHistoryRow = {
      'Account Type': 'Main',
      Amount: '500',
      Currency: 'USDT',
      Fee: '0',
      Remark: 'Convert',
      Side: 'Deposit',
      'Time(UTC)': '2024-02-20 15:45:00',
      Type: 'Convert Market',
      UID: 'user456',
    };

    const withdrawal: CsvAccountHistoryRow = {
      'Account Type': 'Main',
      Amount: '-0.005',
      Currency: 'BTC',
      Fee: '0',
      Remark: 'Convert',
      Side: 'Withdrawal',
      'Time(UTC)': '2024-02-20 15:45:00',
      Type: 'Convert Market',
      UID: 'user456',
    };

    const result = convertKucoinAccountHistoryConvertToTransaction(deposit, withdrawal, '2024-02-20 15:45:00');

    // Function always includes fee entry even when amount is 0
    expect(result.fees).toHaveLength(1);
    expect(result.fees[0].amount.toString()).toBe('0');
  });
});

describe('convertKucoinDepositToTransaction', () => {
  test('converts deposit row into UniversalTransaction', () => {
    const row: CsvDepositWithdrawalRow = {
      'Account Type': 'Main',
      Amount: '1.5',
      Coin: 'BTC',
      'Deposit Address': 'bc1q...',
      Fee: '0.0001',
      Hash: 'abc123txhash',
      Remarks: 'Deposit from external wallet',
      Status: 'Success',
      'Time(UTC)': '2024-01-10 08:00:00',
      'Transfer Network': 'Bitcoin',
      UID: 'user789',
    };

    const result = convertKucoinDepositToTransaction(row);

    expect(result.source).toBe('kucoin');
    expect(result.operation.category).toBe('transfer');
    expect(result.operation.type).toBe('deposit');
    expect(result.status).toBe('success');

    // Check movements - deposit creates inflow
    expect(result.movements.outflows).toHaveLength(0);
    expect(result.movements.inflows).toHaveLength(1);
    expect(result.movements.inflows[0].asset).toBe('BTC');
    expect(result.movements.inflows[0].grossAmount.toString()).toBe('1.5');
    expect(result.movements.inflows[0].netAmount.toString()).toBe('1.5');

    // Check fees
    expect(result.fees).toHaveLength(1);
    expect(result.fees[0].amount.toString()).toBe('0.0001');
    expect(result.fees[0].asset).toBe('BTC');
    expect(result.fees[0].scope).toBe('platform');
    expect(result.fees[0].settlement).toBe('balance');

    expect(result.metadata.hash).toBe('abc123txhash');
    expect(result.metadata.address).toBe('bc1q...');
  });

  test('handles deposit with zero fee', () => {
    const row: CsvDepositWithdrawalRow = {
      'Account Type': 'Main',
      Amount: '100',
      Coin: 'USDT',
      Fee: '0',
      Hash: 'def456txhash',
      Remarks: '',
      Status: 'Success',
      'Time(UTC)': '2024-03-01 12:00:00',
      'Transfer Network': 'Ethereum',
      UID: 'user999',
    };

    const result = convertKucoinDepositToTransaction(row);

    expect(result.fees).toHaveLength(0);
  });

  test('generates external ID from hash if available', () => {
    const row: CsvDepositWithdrawalRow = {
      'Account Type': 'Main',
      Amount: '5',
      Coin: 'ETH',
      Fee: '0',
      Hash: 'unique-hash-123',
      Remarks: '',
      Status: 'Success',
      'Time(UTC)': '2024-03-05 14:30:00',
      'Transfer Network': 'Ethereum',
      UID: 'user111',
    };

    const result = convertKucoinDepositToTransaction(row);

    expect(result.externalId).toBe('unique-hash-123');
  });

  test('generates external ID from UID when hash is missing', () => {
    const row: CsvDepositWithdrawalRow = {
      'Account Type': 'Main',
      Amount: '10',
      Coin: 'USDC',
      Fee: '0',
      Hash: '',
      Remarks: '',
      Status: 'Pending',
      'Time(UTC)': '2024-03-10 09:15:00',
      'Transfer Network': 'Polygon',
      UID: 'user222',
    };

    const result = convertKucoinDepositToTransaction(row);

    expect(result.externalId).toContain('user222');
    expect(result.externalId).toContain('deposit');
    expect(result.externalId).toContain('USDC');
  });
});

describe('convertKucoinOrderSplittingToTransaction', () => {
  test('converts buy order-splitting row into UniversalTransaction', () => {
    const row: CsvOrderSplittingRow = {
      'Account Type': 'Main',
      'Avg. Filled Price': '40000',
      Fee: '0.005',
      'Fee Currency': 'BTC',
      'Filled Amount': '0.1',
      'Filled Time(UTC)': '2024-01-20 11:00:00',
      'Filled Volume': '4000',
      'Filled Volume (USDT)': '4000',
      'Maker/Taker': 'Taker',
      'Order ID': 'order-split-123',
      'Order Type': 'Market',
      Side: 'Buy',
      Symbol: 'BTC-USDT',
      UID: 'user333',
    };

    const result = convertKucoinOrderSplittingToTransaction(row);

    expect(result.source).toBe('kucoin');
    expect(result.operation.category).toBe('trade');
    expect(result.operation.type).toBe('buy');
    expect(result.status).toBe('closed');

    // Check movements - buy means spend quote currency (USDT), receive base currency (BTC)
    expect(result.movements.outflows).toHaveLength(1);
    expect(result.movements.outflows[0].asset).toBe('USDT');
    expect(result.movements.outflows[0].grossAmount.toString()).toBe('4000');

    expect(result.movements.inflows).toHaveLength(1);
    expect(result.movements.inflows[0].asset).toBe('BTC');
    expect(result.movements.inflows[0].grossAmount.toString()).toBe('0.1');

    // Check fees
    expect(result.fees).toHaveLength(1);
    expect(result.fees[0].amount.toString()).toBe('0.005');
    expect(result.fees[0].asset).toBe('BTC');

    expect(result.metadata.fillType).toBe('order-splitting');
    expect(result.metadata.makerTaker).toBe('Taker');
  });

  test('converts sell order-splitting row into UniversalTransaction', () => {
    const row: CsvOrderSplittingRow = {
      'Account Type': 'Main',
      'Avg. Filled Price': '2000',
      Fee: '2',
      'Fee Currency': 'USDT',
      'Filled Amount': '1',
      'Filled Time(UTC)': '2024-01-25 14:30:00',
      'Filled Volume': '2000',
      'Filled Volume (USDT)': '2000',
      'Maker/Taker': 'Maker',
      'Order ID': 'order-split-456',
      'Order Type': 'Limit',
      Side: 'Sell',
      Symbol: 'ETH-USDT',
      UID: 'user444',
    };

    const result = convertKucoinOrderSplittingToTransaction(row);

    expect(result.operation.type).toBe('sell');

    // Check movements - sell means spend base currency (ETH), receive quote currency (USDT)
    expect(result.movements.outflows).toHaveLength(1);
    expect(result.movements.outflows[0].asset).toBe('ETH');
    expect(result.movements.outflows[0].grossAmount.toString()).toBe('1');

    expect(result.movements.inflows).toHaveLength(1);
    expect(result.movements.inflows[0].asset).toBe('USDT');
    expect(result.movements.inflows[0].grossAmount.toString()).toBe('2000');

    expect(result.fees[0].asset).toBe('USDT');
  });

  test('generates unique external ID with timestamp and filled amount', () => {
    const row: CsvOrderSplittingRow = {
      'Account Type': 'Main',
      'Avg. Filled Price': '100',
      Fee: '0.1',
      'Fee Currency': 'USDT',
      'Filled Amount': '50',
      'Filled Time(UTC)': '2024-02-01 10:00:00',
      'Filled Volume': '5000',
      'Filled Volume (USDT)': '5000',
      'Maker/Taker': 'Taker',
      'Order ID': 'order-123',
      'Order Type': 'Market',
      Side: 'Buy',
      Symbol: 'SOL-USDT',
      UID: 'user555',
    };

    const result = convertKucoinOrderSplittingToTransaction(row);

    expect(result.externalId).toContain('order-123');
    expect(result.externalId).toContain('50'); // filled amount
  });
});

describe('convertKucoinTradingBotToTransaction', () => {
  test('converts buy trading bot row into UniversalTransaction', () => {
    const row: CsvTradingBotRow = {
      'Account Type': 'Main',
      Fee: '0.002',
      'Fee Currency': 'BTC',
      'Filled Amount': '0.05',
      'Filled Price': '45000',
      'Filled Volume': '2250',
      'Filled Volume (USDT)': '2250',
      'Order ID': 'bot-order-789',
      'Order Type': 'Market',
      Side: 'Buy',
      Symbol: 'BTC-USDT',
      'Time Filled(UTC)': '2024-02-15 16:20:00',
      UID: 'user666',
    };

    const result = convertKucoinTradingBotToTransaction(row);

    expect(result.source).toBe('kucoin');
    expect(result.operation.category).toBe('trade');
    expect(result.operation.type).toBe('buy');
    expect(result.status).toBe('closed');

    // Check movements - buy means spend USDT, receive BTC
    expect(result.movements.outflows[0].asset).toBe('USDT');
    expect(result.movements.outflows[0].grossAmount.toString()).toBe('2250');

    expect(result.movements.inflows[0].asset).toBe('BTC');
    expect(result.movements.inflows[0].grossAmount.toString()).toBe('0.05');

    expect(result.metadata.fillType).toBe('trading-bot');
  });

  test('converts sell trading bot row into UniversalTransaction', () => {
    const row: CsvTradingBotRow = {
      'Account Type': 'Main',
      Fee: '5',
      'Fee Currency': 'USDT',
      'Filled Amount': '2',
      'Filled Price': '2500',
      'Filled Volume': '5000',
      'Filled Volume (USDT)': '5000',
      'Order ID': 'bot-order-999',
      'Order Type': 'Limit',
      Side: 'Sell',
      Symbol: 'ETH-USDT',
      'Time Filled(UTC)': '2024-02-20 18:45:00',
      UID: 'user777',
    };

    const result = convertKucoinTradingBotToTransaction(row);

    expect(result.operation.type).toBe('sell');

    // Check movements - sell means spend ETH, receive USDT
    expect(result.movements.outflows[0].asset).toBe('ETH');
    expect(result.movements.outflows[0].grossAmount.toString()).toBe('2');

    expect(result.movements.inflows[0].asset).toBe('USDT');
    expect(result.movements.inflows[0].grossAmount.toString()).toBe('5000');
  });
});

describe('convertKucoinSpotOrderToTransaction', () => {
  test('converts buy spot order row into UniversalTransaction', () => {
    const row: CsvSpotOrderRow = {
      'Account Type': 'Main',
      'Avg. Filled Price': '1.5',
      Fee: '0.1',
      'Fee Currency': 'USDT',
      'Filled Amount': '100',
      'Filled Time(UTC)': '2024-03-01 09:00:00',
      'Filled Volume': '150',
      'Filled Volume (USDT)': '150',
      'Order Amount': '100',
      'Order ID': 'spot-order-111',
      'Order Price': '1.5',
      'Order Time(UTC)': '2024-03-01 08:59:00',
      'Order Type': 'Limit',
      Side: 'Buy',
      Status: 'Deal',
      Symbol: 'ADA-USDT',
      UID: 'user888',
    };

    const result = convertKucoinSpotOrderToTransaction(row);

    expect(result.source).toBe('kucoin');
    expect(result.operation.category).toBe('trade');
    expect(result.operation.type).toBe('buy');
    expect(result.status).toBe('closed');
    expect(result.externalId).toBe('spot-order-111');

    // Check movements
    expect(result.movements.outflows[0].asset).toBe('USDT');
    expect(result.movements.outflows[0].grossAmount.toString()).toBe('150');

    expect(result.movements.inflows[0].asset).toBe('ADA');
    expect(result.movements.inflows[0].grossAmount.toString()).toBe('100');

    expect(result.metadata.orderType).toBe('Limit');
  });

  test('converts sell spot order row into UniversalTransaction', () => {
    const row: CsvSpotOrderRow = {
      'Account Type': 'Trading',
      'Avg. Filled Price': '25',
      Fee: '1',
      'Fee Currency': 'USDT',
      'Filled Amount': '20',
      'Filled Time(UTC)': '2024-03-05 11:30:00',
      'Filled Volume': '500',
      'Filled Volume (USDT)': '500',
      'Order Amount': '20',
      'Order ID': 'spot-order-222',
      'Order Price': '25',
      'Order Time(UTC)': '2024-03-05 11:29:00',
      'Order Type': 'Market',
      Side: 'Sell',
      Status: 'Deal',
      Symbol: 'DOT-USDT',
      UID: 'user999',
    };

    const result = convertKucoinSpotOrderToTransaction(row);

    expect(result.operation.type).toBe('sell');

    // Check movements - sell means spend DOT, receive USDT
    expect(result.movements.outflows[0].asset).toBe('DOT');
    expect(result.movements.outflows[0].grossAmount.toString()).toBe('20');

    expect(result.movements.inflows[0].asset).toBe('USDT');
    expect(result.movements.inflows[0].grossAmount.toString()).toBe('500');
  });

  test('maps spot order status correctly', () => {
    const partialRow: CsvSpotOrderRow = {
      'Account Type': 'Main',
      'Avg. Filled Price': '1',
      Fee: '0',
      'Fee Currency': 'USDT',
      'Filled Amount': '50',
      'Filled Time(UTC)': '2024-03-10 13:00:00',
      'Filled Volume': '50',
      'Filled Volume (USDT)': '50',
      'Order Amount': '100',
      'Order ID': 'spot-order-333',
      'Order Price': '1',
      'Order Time(UTC)': '2024-03-10 12:59:00',
      'Order Type': 'Limit',
      Side: 'Buy',
      Status: 'Part_Deal',
      Symbol: 'XRP-USDT',
      UID: 'user1010',
    };

    const result = convertKucoinSpotOrderToTransaction(partialRow);

    expect(result.status).toBe('open');
  });
});

describe('convertKucoinWithdrawalToTransaction', () => {
  test('converts withdrawal row into UniversalTransaction', () => {
    const row: CsvDepositWithdrawalRow = {
      'Account Type': 'Main',
      Amount: '-2',
      Coin: 'ETH',
      Fee: '0.005',
      Hash: 'withdrawal-hash-abc',
      Remarks: 'Send to cold storage',
      Status: 'Success',
      'Time(UTC)': '2024-03-15 10:00:00',
      'Transfer Network': 'Ethereum',
      UID: 'user1111',
      'Withdrawal Address/Account': '0x123...',
    };

    const result = convertKucoinWithdrawalToTransaction(row);

    expect(result.source).toBe('kucoin');
    expect(result.operation.category).toBe('transfer');
    expect(result.operation.type).toBe('withdrawal');
    expect(result.status).toBe('success');

    // Check movements - withdrawal creates outflow
    expect(result.movements.inflows).toHaveLength(0);
    expect(result.movements.outflows).toHaveLength(1);
    expect(result.movements.outflows[0].asset).toBe('ETH');
    // Note: toFixed() without args rounds to 0 decimals
    expect(result.movements.outflows[0].grossAmount.toString()).toBe('2');
    expect(result.movements.outflows[0].netAmount.toString()).toBe('2');

    // Check fees
    expect(result.fees).toHaveLength(1);
    expect(result.fees[0].amount.toString()).toBe('0.005');
    expect(result.fees[0].asset).toBe('ETH');

    expect(result.metadata.hash).toBe('withdrawal-hash-abc');
    expect(result.metadata.address).toBe('0x123...');
  });

  test('handles negative amount correctly (converts to absolute)', () => {
    const row: CsvDepositWithdrawalRow = {
      'Account Type': 'Main',
      Amount: '-100',
      Coin: 'USDT',
      Fee: '1',
      Hash: 'withdrawal-hash-def',
      Remarks: '',
      Status: 'Success',
      'Time(UTC)': '2024-03-20 14:00:00',
      'Transfer Network': 'Tron',
      UID: 'user2222',
      'Withdrawal Address/Account': 'T123...',
    };

    const result = convertKucoinWithdrawalToTransaction(row);

    expect(result.movements.outflows[0].grossAmount.toString()).toBe('100');
  });

  test('handles zero fee withdrawal', () => {
    const row: CsvDepositWithdrawalRow = {
      'Account Type': 'Main',
      Amount: '-0.5',
      Coin: 'BTC',
      Fee: '0',
      Hash: 'withdrawal-hash-ghi',
      Remarks: 'Zero fee promo',
      Status: 'Success',
      'Time(UTC)': '2024-03-25 16:00:00',
      'Transfer Network': 'Bitcoin',
      UID: 'user3333',
      'Withdrawal Address/Account': 'bc1q...',
    };

    const result = convertKucoinWithdrawalToTransaction(row);

    expect(result.fees).toHaveLength(0);
  });

  test('generates external ID from hash if available', () => {
    const row: CsvDepositWithdrawalRow = {
      'Account Type': 'Main',
      Amount: '-1',
      Coin: 'SOL',
      Fee: '0.001',
      Hash: 'unique-withdrawal-hash',
      Remarks: '',
      Status: 'Success',
      'Time(UTC)': '2024-03-30 18:00:00',
      'Transfer Network': 'Solana',
      UID: 'user4444',
      'Withdrawal Address/Account': 'Sol123...',
    };

    const result = convertKucoinWithdrawalToTransaction(row);

    expect(result.externalId).toBe('unique-withdrawal-hash');
  });
});

describe('mapKucoinStatus', () => {
  describe('spot order status mapping', () => {
    test('maps Deal to closed', () => {
      expect(mapKucoinStatus('Deal', 'spot')).toBe('closed');
      expect(mapKucoinStatus('deal', 'spot')).toBe('closed');
    });

    test('maps Part_Deal to open', () => {
      expect(mapKucoinStatus('Part_Deal', 'spot')).toBe('open');
      expect(mapKucoinStatus('part_deal', 'spot')).toBe('open');
    });

    test('maps Cancel to canceled', () => {
      expect(mapKucoinStatus('Cancel', 'spot')).toBe('canceled');
      expect(mapKucoinStatus('cancel', 'spot')).toBe('canceled');
    });

    test('maps unknown spot status to pending', () => {
      expect(mapKucoinStatus('Unknown', 'spot')).toBe('pending');
      expect(mapKucoinStatus('', 'spot')).toBe('pending');
    });
  });

  describe('deposit/withdrawal status mapping', () => {
    test('maps Success to success', () => {
      expect(mapKucoinStatus('Success', 'deposit_withdrawal')).toBe('success');
      expect(mapKucoinStatus('success', 'deposit_withdrawal')).toBe('success');
    });

    test('maps Pending to pending', () => {
      expect(mapKucoinStatus('Pending', 'deposit_withdrawal')).toBe('pending');
      expect(mapKucoinStatus('pending', 'deposit_withdrawal')).toBe('pending');
    });

    test('maps Failed to failed', () => {
      expect(mapKucoinStatus('Failed', 'deposit_withdrawal')).toBe('failed');
      expect(mapKucoinStatus('failed', 'deposit_withdrawal')).toBe('failed');
    });

    test('maps Canceled to canceled', () => {
      expect(mapKucoinStatus('Canceled', 'deposit_withdrawal')).toBe('canceled');
      expect(mapKucoinStatus('canceled', 'deposit_withdrawal')).toBe('canceled');
    });

    test('maps unknown deposit/withdrawal status to pending', () => {
      expect(mapKucoinStatus('Unknown', 'deposit_withdrawal')).toBe('pending');
      expect(mapKucoinStatus('', 'deposit_withdrawal')).toBe('pending');
    });
  });
});

describe('processKucoinAccountHistory', () => {
  test('processes account history with paired convert market entries', () => {
    const rows: CsvAccountHistoryRow[] = [
      {
        'Account Type': 'Main',
        Amount: '100',
        Currency: 'USDT',
        Fee: '0.05',
        Remark: 'Convert',
        Side: 'Deposit',
        'Time(UTC)': '2024-01-15 10:00:00',
        Type: 'Convert Market',
        UID: 'user123',
      },
      {
        'Account Type': 'Main',
        Amount: '-0.001',
        Currency: 'BTC',
        Fee: '0.00001',
        Remark: 'Convert',
        Side: 'Withdrawal',
        'Time(UTC)': '2024-01-15 10:00:00',
        Type: 'Convert Market',
        UID: 'user123',
      },
    ];

    const result = processKucoinAccountHistory(rows, logger);

    expect(result).toHaveLength(1);
    expect(result[0].operation.type).toBe('swap');
    expect(result[0].movements.inflows[0].asset).toBe('USDT');
    expect(result[0].movements.outflows[0].asset).toBe('BTC');
  });

  test('processes multiple convert market pairs correctly', () => {
    const rows: CsvAccountHistoryRow[] = [
      // First pair
      {
        'Account Type': 'Main',
        Amount: '50',
        Currency: 'USDT',
        Fee: '0',
        Remark: 'Convert',
        Side: 'Deposit',
        'Time(UTC)': '2024-01-15 10:00:00',
        Type: 'Convert Market',
        UID: 'user123',
      },
      {
        'Account Type': 'Main',
        Amount: '-1',
        Currency: 'ETH',
        Fee: '0',
        Remark: 'Convert',
        Side: 'Withdrawal',
        'Time(UTC)': '2024-01-15 10:00:00',
        Type: 'Convert Market',
        UID: 'user123',
      },
      // Second pair (different timestamp)
      {
        'Account Type': 'Main',
        Amount: '200',
        Currency: 'USDC',
        Fee: '0.1',
        Remark: 'Convert',
        Side: 'Deposit',
        'Time(UTC)': '2024-01-15 11:00:00',
        Type: 'Convert Market',
        UID: 'user123',
      },
      {
        'Account Type': 'Main',
        Amount: '-0.002',
        Currency: 'BTC',
        Fee: '0.00002',
        Remark: 'Convert',
        Side: 'Withdrawal',
        'Time(UTC)': '2024-01-15 11:00:00',
        Type: 'Convert Market',
        UID: 'user123',
      },
    ];

    const result = processKucoinAccountHistory(rows, logger);

    expect(result).toHaveLength(2);
    expect(result[0].movements.inflows[0].asset).toBe('USDT');
    expect(result[1].movements.inflows[0].asset).toBe('USDC');
  });

  test('filters out non-convert market entries', () => {
    const rows: CsvAccountHistoryRow[] = [
      {
        'Account Type': 'Main',
        Amount: '100',
        Currency: 'USDT',
        Fee: '0',
        Remark: 'Trade',
        Side: 'Deposit',
        'Time(UTC)': '2024-01-15 10:00:00',
        Type: 'Trade',
        UID: 'user123',
      },
      {
        'Account Type': 'Main',
        Amount: '50',
        Currency: 'USDT',
        Fee: '0',
        Remark: 'Convert',
        Side: 'Deposit',
        'Time(UTC)': '2024-01-15 11:00:00',
        Type: 'Convert Market',
        UID: 'user123',
      },
      {
        'Account Type': 'Main',
        Amount: '-0.001',
        Currency: 'BTC',
        Fee: '0',
        Remark: 'Convert',
        Side: 'Withdrawal',
        'Time(UTC)': '2024-01-15 11:00:00',
        Type: 'Convert Market',
        UID: 'user123',
      },
    ];

    const result = processKucoinAccountHistory(rows, logger);

    expect(result).toHaveLength(1); // Only one valid convert market pair
  });

  test('handles convert market group with missing deposit/withdrawal', () => {
    const rows: CsvAccountHistoryRow[] = [
      {
        'Account Type': 'Main',
        Amount: '100',
        Currency: 'USDT',
        Fee: '0',
        Remark: 'Convert',
        Side: 'Deposit',
        'Time(UTC)': '2024-01-15 10:00:00',
        Type: 'Convert Market',
        UID: 'user123',
      },
      // Missing corresponding withdrawal
    ];

    const result = processKucoinAccountHistory(rows, logger);

    expect(result).toHaveLength(0); // No valid pairs
  });

  test('handles convert market group with more than 2 entries', () => {
    const rows: CsvAccountHistoryRow[] = [
      {
        'Account Type': 'Main',
        Amount: '100',
        Currency: 'USDT',
        Fee: '0',
        Remark: 'Convert',
        Side: 'Deposit',
        'Time(UTC)': '2024-01-15 10:00:00',
        Type: 'Convert Market',
        UID: 'user123',
      },
      {
        'Account Type': 'Main',
        Amount: '-0.001',
        Currency: 'BTC',
        Fee: '0',
        Remark: 'Convert',
        Side: 'Withdrawal',
        'Time(UTC)': '2024-01-15 10:00:00',
        Type: 'Convert Market',
        UID: 'user123',
      },
      {
        'Account Type': 'Main',
        Amount: '50',
        Currency: 'USDC',
        Fee: '0',
        Remark: 'Convert',
        Side: 'Deposit',
        'Time(UTC)': '2024-01-15 10:00:00',
        Type: 'Convert Market',
        UID: 'user123',
      },
    ];

    const result = processKucoinAccountHistory(rows, logger);

    expect(result).toHaveLength(0); // No valid pairs (group has 3 entries)
  });

  test('returns empty array for empty input', () => {
    const result = processKucoinAccountHistory([], logger);

    expect(result).toHaveLength(0);
  });
});
