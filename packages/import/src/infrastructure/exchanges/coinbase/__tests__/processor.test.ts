import type { CoinbaseLedgerEntry } from '@exitbook/exchanges';
import { describe, expect, test } from 'vitest';

import { CoinbaseProcessor } from '../processor.ts';

function createProcessor() {
  return new CoinbaseProcessor();
}

describe('CoinbaseProcessor - Deposit Handling', () => {
  test('processes normal deposit (transaction type with direction in)', async () => {
    const processor = createProcessor();

    const ledgerEntry: CoinbaseLedgerEntry = {
      id: 'LEDGER1',
      referenceId: 'REF001',
      timestamp: 1704067200000, // 2024-01-01 00:00:00
      datetime: '2024-01-01T00:00:00.000Z',
      type: 'transaction',
      currency: 'USD',
      amount: 1000,
      direction: 'in',
      fee: { cost: 0, currency: 'USD' },
      status: 'ok',
      before: 0,
      after: 1000,
      account: 'spot-account',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify deposit classification
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');

    // Verify inflow
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows[0]?.asset).toBe('USD');
    expect(transaction.movements.inflows[0]?.amount.amount.toString()).toBe('1000');

    // Verify fee
    expect(transaction.fees.platform?.amount.toString()).toBe('0');
    expect(transaction.fees.total?.amount.toString()).toBe('0');

    // Verify primary movement
    expect(transaction.movements.primary.direction).toBe('in');
    expect(transaction.movements.primary.amount.amount.toString()).toBe('1000');
    expect(transaction.movements.primary.asset).toBe('USD');

    // Verify no outflows
    expect(transaction.movements.outflows).toHaveLength(0);

    // Verify metadata
    expect(transaction.metadata?.referenceId).toBe('REF001');
    expect(transaction.metadata?.ledgerId).toBe('LEDGER1');
  });
});

describe('CoinbaseProcessor - Withdrawal Handling', () => {
  test('processes normal withdrawal (transaction type with direction out)', async () => {
    const processor = createProcessor();

    const ledgerEntry: CoinbaseLedgerEntry = {
      id: 'LEDGER2',
      referenceId: 'REF002',
      timestamp: 1704067201000,
      datetime: '2024-01-01T00:00:01.000Z',
      type: 'transaction',
      currency: 'USD',
      amount: -100,
      direction: 'out',
      fee: { cost: 2.5, currency: 'USD' },
      status: 'ok',
      before: 1000,
      after: 897.5,
      account: 'spot-account',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify withdrawal classification
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');

    // Verify outflow (net amount = amount - fee = 100 - 2.5 = 97.5)
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows[0]?.amount.amount.toString()).toBe('97.5');
    expect(transaction.movements.inflows).toHaveLength(0);

    // Verify fee
    expect(transaction.fees.platform?.amount.toString()).toBe('2.5');

    // Verify primary movement (negative value for withdrawals)
    expect(transaction.movements.primary.direction).toBe('out');
    expect(transaction.movements.primary.amount.amount.toString()).toBe('-97.5');

    // Verify metadata includes gross amount
    expect(transaction.metadata?.grossAmount).toBe('100');
  });

  test('processes withdrawal with crypto', async () => {
    const processor = createProcessor();

    const ledgerEntry: CoinbaseLedgerEntry = {
      id: 'LEDGER3',
      referenceId: 'REF003',
      timestamp: 1704067202000,
      datetime: '2024-01-01T00:00:02.000Z',
      type: 'transaction',
      currency: 'BTC',
      amount: -0.1,
      direction: 'out',
      fee: { cost: 0.0001, currency: 'BTC' },
      status: 'ok',
      before: 1,
      after: 0.8999,
      account: 'spot-account',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify outflow is net amount (0.1 - 0.0001 = 0.0999)
    expect(transaction.movements.outflows[0]?.amount.amount.toString()).toBe('0.0999');
    expect(transaction.fees.platform?.amount.toString()).toBe('0.0001');
  });
});

describe('CoinbaseProcessor - Trade Handling', () => {
  test('processes buy trade (trade type with direction in)', async () => {
    const processor = createProcessor();

    const ledgerEntry: CoinbaseLedgerEntry = {
      id: 'LEDGER4',
      referenceId: 'REF004',
      timestamp: 1704067203000,
      datetime: '2024-01-01T00:00:03.000Z',
      type: 'trade',
      currency: 'BTC',
      amount: 0.05,
      direction: 'in',
      fee: { cost: 1.5, currency: 'USD' },
      status: 'ok',
      before: 0,
      after: 0.05,
      account: 'spot-account',
      referenceAccount: 'spot-account',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify trade classification
    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('buy');

    // Verify inflow
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows[0]?.asset).toBe('BTC');
    expect(transaction.movements.inflows[0]?.amount.amount.toString()).toBe('0.05');

    // Verify fee
    expect(transaction.fees.platform?.amount.toString()).toBe('1.5');
    expect(transaction.fees.platform?.currency.toString()).toBe('USD');
  });

  test('processes sell trade (trade type with direction out)', async () => {
    const processor = createProcessor();

    const ledgerEntry: CoinbaseLedgerEntry = {
      id: 'LEDGER5',
      referenceId: 'REF005',
      timestamp: 1704067204000,
      datetime: '2024-01-01T00:00:04.000Z',
      type: 'trade',
      currency: 'BTC',
      amount: -0.025,
      direction: 'out',
      fee: { cost: 1.0, currency: 'USD' },
      status: 'ok',
      before: 0.05,
      after: 0.025,
      account: 'spot-account',
      referenceAccount: 'spot-account',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify trade classification
    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('sell');

    // Verify outflow
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows[0]?.asset).toBe('BTC');
    expect(transaction.movements.outflows[0]?.amount.amount.toString()).toBe('0.025');

    // Verify primary movement (negative for sales)
    expect(transaction.movements.primary.direction).toBe('out');
    expect(transaction.movements.primary.amount.amount.toString()).toBe('-0.025');
  });

  test('processes advanced trade fill (buy)', async () => {
    const processor = createProcessor();

    const ledgerEntry: CoinbaseLedgerEntry = {
      id: 'LEDGER6',
      referenceId: 'REF006',
      timestamp: 1704067205000,
      datetime: '2024-01-01T00:00:05.000Z',
      type: 'advanced_trade_fill',
      currency: 'ETH',
      amount: 1.5,
      direction: 'in',
      fee: { cost: 0.002, currency: 'ETH' },
      status: 'ok',
      before: 0,
      after: 1.5,
      account: 'advanced-account',
      referenceAccount: 'advanced-account',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify trade classification
    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('buy');

    // Verify metadata includes ledger type
    expect(transaction.metadata?.ledgerType).toBe('advanced_trade_fill');
  });

  test('processes advanced trade fill (sell)', async () => {
    const processor = createProcessor();

    const ledgerEntry: CoinbaseLedgerEntry = {
      id: 'LEDGER7',
      referenceId: 'REF007',
      timestamp: 1704067206000,
      datetime: '2024-01-01T00:00:06.000Z',
      type: 'advanced_trade_fill',
      currency: 'ETH',
      amount: -0.5,
      direction: 'out',
      fee: { cost: 0.001, currency: 'ETH' },
      status: 'ok',
      before: 1.5,
      after: 1.0,
      account: 'advanced-account',
      referenceAccount: 'advanced-account',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify trade classification
    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('sell');
  });
});

describe('CoinbaseProcessor - Fee Handling', () => {
  test('processes standalone fee entry', async () => {
    const processor = createProcessor();

    const ledgerEntry: CoinbaseLedgerEntry = {
      id: 'LEDGER8',
      referenceId: 'REF008',
      timestamp: 1704067207000,
      datetime: '2024-01-01T00:00:07.000Z',
      type: 'fee',
      currency: 'USD',
      amount: -2.5,
      direction: 'out',
      status: 'ok',
      before: 1000,
      after: 997.5,
      account: 'spot-account',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify fee classification
    expect(transaction.operation.category).toBe('fee');
    expect(transaction.operation.type).toBe('fee');

    // Fee entry should not create outflow (to avoid double-counting)
    expect(transaction.movements.outflows).toHaveLength(0);
    expect(transaction.movements.inflows).toHaveLength(0);

    // Fee is recorded in fees section
    expect(transaction.fees.platform?.amount.toString()).toBe('2.5');
    expect(transaction.fees.total?.amount.toString()).toBe('2.5');
  });
});

describe('CoinbaseProcessor - Rebate Handling', () => {
  test('processes rebate (fee refund)', async () => {
    const processor = createProcessor();

    const ledgerEntry: CoinbaseLedgerEntry = {
      id: 'LEDGER9',
      referenceId: 'REF009',
      timestamp: 1704067208000,
      datetime: '2024-01-01T00:00:08.000Z',
      type: 'rebate',
      currency: 'USD',
      amount: 1.25,
      direction: 'in',
      status: 'ok',
      before: 997.5,
      after: 998.75,
      account: 'spot-account',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify rebate classification
    expect(transaction.operation.category).toBe('fee');
    expect(transaction.operation.type).toBe('refund');

    // Rebate is an inflow
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows[0]?.amount.amount.toString()).toBe('1.25');
    expect(transaction.movements.outflows).toHaveLength(0);

    // No fee on rebate
    expect(transaction.fees.platform?.amount.toString()).toBe('0');
  });
});

describe('CoinbaseProcessor - Interest Handling', () => {
  test('processes interest earned', async () => {
    const processor = createProcessor();

    const ledgerEntry: CoinbaseLedgerEntry = {
      id: 'LEDGER10',
      referenceId: 'REF010',
      timestamp: 1704067209000,
      datetime: '2024-01-01T00:00:09.000Z',
      type: 'interest',
      currency: 'USDC',
      amount: 5.0,
      direction: 'in',
      status: 'ok',
      before: 1000,
      after: 1005,
      account: 'spot-account',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify interest classification (maps to staking reward)
    expect(transaction.operation.category).toBe('staking');
    expect(transaction.operation.type).toBe('reward');

    // Interest is an inflow
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows[0]?.asset).toBe('USDC');
    expect(transaction.movements.inflows[0]?.amount.amount.toString()).toBe('5');
    expect(transaction.movements.outflows).toHaveLength(0);

    // Verify metadata
    expect(transaction.metadata?.ledgerType).toBe('interest');
  });
});

describe('CoinbaseProcessor - Dust Conversion Handling', () => {
  test('processes dust conversion (receive)', async () => {
    const processor = createProcessor();

    const ledgerEntry: CoinbaseLedgerEntry = {
      id: 'LEDGER11',
      referenceId: 'REF011',
      timestamp: 1704067210000,
      datetime: '2024-01-01T00:00:10.000Z',
      type: 'retail_simple_dust',
      currency: 'USDC',
      amount: 0.5,
      direction: 'in',
      status: 'ok',
      before: 1005,
      after: 1005.5,
      account: 'spot-account',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify dust conversion classification
    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('swap');

    // Dust conversion received
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows[0]?.amount.amount.toString()).toBe('0.5');
    expect(transaction.movements.outflows).toHaveLength(0);

    // Verify metadata
    expect(transaction.metadata?.ledgerType).toBe('retail_simple_dust');
  });

  test('processes dust conversion (spend)', async () => {
    const processor = createProcessor();

    const ledgerEntry: CoinbaseLedgerEntry = {
      id: 'LEDGER12',
      referenceId: 'REF012',
      timestamp: 1704067211000,
      datetime: '2024-01-01T00:00:11.000Z',
      type: 'retail_simple_dust',
      currency: 'SHIB',
      amount: -1000,
      direction: 'out',
      status: 'ok',
      before: 1000,
      after: 0,
      account: 'spot-account',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify dust conversion classification
    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('swap');

    // Dust conversion spent
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows[0]?.amount.amount.toString()).toBe('1000');
    expect(transaction.movements.inflows).toHaveLength(0);
  });
});

describe('CoinbaseProcessor - Subscription Handling', () => {
  test('processes subscription payment (outflow)', async () => {
    const processor = createProcessor();

    const ledgerEntry: CoinbaseLedgerEntry = {
      id: 'LEDGER13',
      referenceId: 'REF013',
      timestamp: 1704067212000,
      datetime: '2024-01-01T00:00:12.000Z',
      type: 'subscription',
      currency: 'USD',
      amount: -9.99,
      direction: 'out',
      status: 'ok',
      before: 1000,
      after: 990.01,
      account: 'spot-account',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify subscription classification
    expect(transaction.operation.category).toBe('fee');
    expect(transaction.operation.type).toBe('fee');

    // Subscription payment should not create outflow (to avoid double-counting)
    expect(transaction.movements.outflows).toHaveLength(0);
    expect(transaction.movements.inflows).toHaveLength(0);

    // Fee is recorded in fees section
    expect(transaction.fees.platform?.amount.toString()).toBe('9.99');
    expect(transaction.fees.total?.amount.toString()).toBe('9.99');

    // Verify metadata
    expect(transaction.metadata?.ledgerType).toBe('subscription');
  });

  test('processes subscription credit (inflow)', async () => {
    const processor = createProcessor();

    const ledgerEntry: CoinbaseLedgerEntry = {
      id: 'LEDGER14',
      referenceId: 'REF014',
      timestamp: 1704067213000,
      datetime: '2024-01-01T00:00:13.000Z',
      type: 'subscription',
      currency: 'USD',
      amount: 9.99,
      direction: 'in',
      status: 'ok',
      before: 990.01,
      after: 1000,
      account: 'spot-account',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify subscription credit classification
    expect(transaction.operation.category).toBe('fee');
    expect(transaction.operation.type).toBe('refund');

    // Subscription credit is an inflow
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows[0]?.amount.amount.toString()).toBe('9.99');
    expect(transaction.movements.outflows).toHaveLength(0);
  });
});

describe('CoinbaseProcessor - Status Mapping', () => {
  test('maps various status values correctly', async () => {
    const processor = createProcessor();

    const testCases: { coinbaseStatus: string; expected: string }[] = [
      { coinbaseStatus: 'pending', expected: 'pending' },
      { coinbaseStatus: 'ok', expected: 'ok' },
      { coinbaseStatus: 'completed', expected: 'ok' },
      { coinbaseStatus: 'success', expected: 'ok' },
      { coinbaseStatus: 'canceled', expected: 'canceled' },
      { coinbaseStatus: 'cancelled', expected: 'canceled' },
      { coinbaseStatus: 'failed', expected: 'failed' },
    ];

    for (const { coinbaseStatus, expected } of testCases) {
      const ledgerEntry: CoinbaseLedgerEntry = {
        id: `LEDGER_${coinbaseStatus}`,
        referenceId: 'REFTEST',
        timestamp: 1704067214000,
        datetime: '2024-01-01T00:00:14.000Z',
        type: 'transaction',
        currency: 'USD',
        amount: 100,
        direction: 'in',
        status: coinbaseStatus,
        before: 0,
        after: 100,
        account: 'spot-account',
      };

      const result = await processor.process([ledgerEntry], {});

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) continue;

      const [transaction] = result.value;
      expect(transaction?.status).toBe(expected);
    }
  });
});

describe('CoinbaseProcessor - Edge Cases', () => {
  test('handles ledger entry with no fee', async () => {
    const processor = createProcessor();

    const ledgerEntry: CoinbaseLedgerEntry = {
      id: 'LEDGER15',
      referenceId: 'REF015',
      timestamp: 1704067215000,
      datetime: '2024-01-01T00:00:15.000Z',
      type: 'transaction',
      currency: 'USD',
      amount: 500,
      direction: 'in',
      status: 'ok',
      before: 1000,
      after: 1500,
      account: 'spot-account',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify zero fee handling
    expect(transaction.fees.platform?.amount.toString()).toBe('0');
    expect(transaction.fees.total?.amount.toString()).toBe('0');
  });

  test('processes multiple ledger entries in sequence', async () => {
    const processor = createProcessor();

    const ledgerEntries: CoinbaseLedgerEntry[] = [
      {
        id: 'LEDGER16A',
        referenceId: 'REF016',
        timestamp: 1704067216000,
        datetime: '2024-01-01T00:00:16.000Z',
        type: 'transaction',
        currency: 'USD',
        amount: 1000,
        direction: 'in',
        status: 'ok',
        before: 0,
        after: 1000,
        account: 'spot-account',
      },
      {
        id: 'LEDGER16B',
        referenceId: 'REF017',
        timestamp: 1704067217000,
        datetime: '2024-01-01T00:00:17.000Z',
        type: 'trade',
        currency: 'BTC',
        amount: 0.1,
        direction: 'in',
        fee: { cost: 5, currency: 'USD' },
        status: 'ok',
        before: 0,
        after: 0.1,
        account: 'spot-account',
        referenceAccount: 'spot-account',
      },
      {
        id: 'LEDGER16C',
        referenceId: 'REF018',
        timestamp: 1704067218000,
        datetime: '2024-01-01T00:00:18.000Z',
        type: 'transaction',
        currency: 'BTC',
        amount: -0.05,
        direction: 'out',
        fee: { cost: 0.0001, currency: 'BTC' },
        status: 'ok',
        before: 0.1,
        after: 0.0499,
        account: 'spot-account',
      },
    ];

    const result = await processor.process(ledgerEntries, {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(3);
    expect(transactions[0]?.operation.type).toBe('deposit');
    expect(transactions[1]?.operation.type).toBe('buy');
    expect(transactions[2]?.operation.type).toBe('withdrawal');
  });

  test('handles unknown ledger type gracefully', async () => {
    const processor = createProcessor();

    const ledgerEntry: CoinbaseLedgerEntry = {
      id: 'LEDGER17',
      referenceId: 'REF019',
      timestamp: 1704067219000,
      datetime: '2024-01-01T00:00:19.000Z',
      type: 'unknown_type',
      currency: 'USD',
      amount: 100,
      direction: 'in',
      status: 'ok',
      before: 1000,
      after: 1100,
      account: 'spot-account',
    };

    const result = await processor.process([ledgerEntry], {});

    // Should still succeed (processor logs warning but continues)
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    // Unknown type should be skipped
    expect(result.value).toHaveLength(0);
  });
});
