import type { KrakenLedgerEntry } from '@exitbook/exchanges';
import { describe, expect, test } from 'vitest';

import { KrakenProcessor } from '../processor.ts';

function createProcessor() {
  return new KrakenProcessor();
}

describe('KrakenProcessor - Deposit Handling', () => {
  test('processes normal CAD deposit with fee (gross amount)', async () => {
    const processor = createProcessor();

    const ledgerEntry: KrakenLedgerEntry = {
      id: 'LEDGER1',
      refid: 'REF001',
      time: 1704067200, // 2024-01-01 00:00:00
      type: 'deposit',
      aclass: 'currency',
      asset: 'ZCAD',
      amount: '700.00', // Gross amount
      fee: '3.49',
      balance: '696.51',
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

    // Verify gross amount in inflows (not net)
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows[0]?.asset).toBe('CAD');
    expect(transaction.movements.inflows[0]?.amount.amount.toString()).toBe('700');

    // Verify fee is separate (balance calc will subtract it)
    expect(transaction.fees.platform?.amount.toString()).toBe('3.49');
    expect(transaction.fees.total?.amount.toString()).toBe('3.49');

    // Verify primary movement
    expect(transaction.movements.primary.direction).toBe('in');
    expect(transaction.movements.primary.amount.amount.toString()).toBe('700');
    expect(transaction.movements.primary.asset).toBe('CAD');

    // Verify no outflows
    expect(transaction.movements.outflows).toHaveLength(0);

    // Verify metadata
    expect(transaction.metadata?.refid).toBe('REF001');
    expect(transaction.metadata?.ledgerId).toBe('LEDGER1');
  });

  test('processes deposit reversal (negative amount)', async () => {
    const processor = createProcessor();

    const ledgerEntry: KrakenLedgerEntry = {
      id: 'LEDGER2',
      refid: 'REF002',
      time: 1704067201,
      type: 'deposit',
      aclass: 'currency',
      asset: 'ZCAD',
      amount: '-700.00', // Negative = reversal
      fee: '-3.49', // Fee refund
      balance: '0.00',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Deposit reversal becomes withdrawal
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');

    // Money goes out
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows[0]?.amount.amount.toString()).toBe('700');
    expect(transaction.movements.inflows).toHaveLength(0);

    // Verify reversal flag
    expect(transaction.metadata?.isReversal).toBe(true);
  });

  test('processes BTC deposit with asset normalization', async () => {
    const processor = createProcessor();

    const ledgerEntry: KrakenLedgerEntry = {
      id: 'LEDGER3',
      refid: 'REF003',
      time: 1704067202,
      type: 'deposit',
      aclass: 'currency',
      asset: 'XXBT', // Kraken uses XXBT for BTC
      amount: '0.5',
      fee: '0.0001',
      balance: '0.4999',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Verify asset normalization (XXBT → BTC)
    expect(transaction.movements.inflows[0]?.asset).toBe('BTC');
    expect(transaction.movements.primary.asset).toBe('BTC');
  });
});

describe('KrakenProcessor - Withdrawal Handling', () => {
  test('processes normal withdrawal with fee', async () => {
    const processor = createProcessor();

    const ledgerEntry: KrakenLedgerEntry = {
      id: 'LEDGER4',
      refid: 'REF004',
      time: 1704067203,
      type: 'withdrawal',
      aclass: 'currency',
      asset: 'ZCAD',
      amount: '-385.155', // Negative = actual withdrawal
      fee: '0.5',
      balance: '311.345',
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

    // Verify outflow
    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows[0]?.amount.amount.toString()).toBe('385.155');
    expect(transaction.movements.inflows).toHaveLength(0);

    // Verify fee
    expect(transaction.fees.platform?.amount.toString()).toBe('0.5');

    // Verify primary movement
    expect(transaction.movements.primary.direction).toBe('out');
    expect(transaction.movements.primary.amount.amount.toString()).toBe('-385.155');
  });

  test('processes withdrawal reversal (failed withdrawal refund)', async () => {
    const processor = createProcessor();

    const ledgerEntry: KrakenLedgerEntry = {
      id: 'LEDGER5',
      refid: 'REF005',
      time: 1704067204,
      type: 'withdrawal',
      aclass: 'currency',
      asset: 'ZCAD',
      amount: '385.155', // Positive = reversal/refund
      fee: '-0.5', // Fee refund
      balance: '696.51',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Withdrawal reversal becomes deposit
    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');

    // Money comes back in
    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows[0]?.amount.amount.toString()).toBe('385.155');
    expect(transaction.movements.outflows).toHaveLength(0);

    // Fee is refunded (negative fee)
    expect(transaction.fees.platform?.amount.toString()).toBe('-0.5');

    // Verify reversal flag
    expect(transaction.metadata?.isReversal).toBe(true);
  });

  test('processes withdrawal retry sequence (fail + refund + success)', async () => {
    const processor = createProcessor();

    const ledgerEntries: KrakenLedgerEntry[] = [
      {
        id: 'LEDGER6A',
        refid: 'REF006',
        time: 1704067205,
        type: 'withdrawal',
        amount: '-385.155',
        fee: '0.5',
        asset: 'ZCAD',
        aclass: 'currency',
        balance: '311.345',
      },
      {
        id: 'LEDGER6B',
        refid: 'REF006',
        time: 1704067206,
        type: 'withdrawal',
        amount: '385.155', // Refund
        fee: '-0.5',
        asset: 'ZCAD',
        aclass: 'currency',
        balance: '696.51',
      },
      {
        id: 'LEDGER6C',
        refid: 'REF007',
        time: 1704067207,
        type: 'withdrawal',
        amount: '-384.5', // Success (less fee)
        fee: '0.5',
        asset: 'ZCAD',
        aclass: 'currency',
        balance: '311.51',
      },
    ];

    const result = await processor.process(ledgerEntries, {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(3);

    // First attempt - withdrawal
    expect(transactions[0]?.operation.type).toBe('withdrawal');
    expect(transactions[0]?.movements.outflows[0]?.amount.amount.toString()).toBe('385.155');

    // Refund - becomes deposit
    expect(transactions[1]?.operation.type).toBe('deposit');
    expect(transactions[1]?.movements.inflows[0]?.amount.amount.toString()).toBe('385.155');

    // Success - withdrawal
    expect(transactions[2]?.operation.type).toBe('withdrawal');
    expect(transactions[2]?.movements.outflows[0]?.amount.amount.toString()).toBe('384.5');
  });
});

describe('KrakenProcessor - Trade/Conversion Handling', () => {
  test('processes currency conversion (CAD→USD)', async () => {
    const processor = createProcessor();

    const ledgerEntries: KrakenLedgerEntry[] = [
      {
        id: 'LEDGER7A',
        refid: 'REF008',
        time: 1704067208,
        type: 'trade',
        subtype: 'tradespot',
        asset: 'ZCAD',
        amount: '-700.00', // Spent CAD
        fee: '0.00',
        aclass: 'currency',
        balance: '0.00',
      },
      {
        id: 'LEDGER7B',
        refid: 'REF008',
        time: 1704067208,
        type: 'trade',
        subtype: 'tradespot',
        asset: 'ZUSD',
        amount: '527.50', // Received USD
        fee: '0.00',
        aclass: 'currency',
        balance: '527.50',
      },
    ];

    const result = await processor.process(ledgerEntries, {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(2);

    // First entry - sell CAD
    expect(transactions[0]?.operation.category).toBe('trade');
    expect(transactions[0]?.operation.type).toBe('sell');
    expect(transactions[0]?.movements.outflows[0]?.asset).toBe('CAD');
    expect(transactions[0]?.movements.outflows[0]?.amount.amount.toString()).toBe('700');

    // Second entry - buy USD
    expect(transactions[1]?.operation.category).toBe('trade');
    expect(transactions[1]?.operation.type).toBe('buy');
    expect(transactions[1]?.movements.inflows[0]?.asset).toBe('USD');
    expect(transactions[1]?.movements.inflows[0]?.amount.amount.toString()).toBe('527.5');

    // Both share same refid
    expect(transactions[0]?.metadata?.refid).toBe('REF008');
    expect(transactions[1]?.metadata?.refid).toBe('REF008');
  });

  test('processes spend/receive pair for crypto buy', async () => {
    const processor = createProcessor();

    const ledgerEntries: KrakenLedgerEntry[] = [
      {
        id: 'LEDGER8A',
        refid: 'REF009',
        time: 1704067209,
        type: 'spend',
        asset: 'ZUSD',
        amount: '-1000.00', // Spent USD
        fee: '2.50',
        aclass: 'currency',
        balance: '527.50',
      },
      {
        id: 'LEDGER8B',
        refid: 'REF009',
        time: 1704067209,
        type: 'receive',
        asset: 'XXBT',
        amount: '0.025', // Received BTC
        fee: '0.00',
        aclass: 'currency',
        balance: '0.025',
      },
    ];

    const result = await processor.process(ledgerEntries, {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(2);

    // Spend entry - sell USD
    expect(transactions[0]?.operation.type).toBe('sell');
    expect(transactions[0]?.movements.outflows[0]?.asset).toBe('USD');
    expect(transactions[0]?.movements.outflows[0]?.amount.amount.toString()).toBe('1000');

    // Receive entry - buy BTC
    expect(transactions[1]?.operation.type).toBe('buy');
    expect(transactions[1]?.movements.inflows[0]?.asset).toBe('BTC');
    expect(transactions[1]?.movements.inflows[0]?.amount.amount.toString()).toBe('0.025');
  });

  test('handles trade with fee correctly', async () => {
    const processor = createProcessor();

    const ledgerEntry: KrakenLedgerEntry = {
      id: 'LEDGER9',
      refid: 'REF010',
      time: 1704067210,
      type: 'trade',
      asset: 'XXBT',
      amount: '0.1',
      fee: '0.0001',
      aclass: 'currency',
      balance: '0.0999',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Fee is stored separately
    expect(transaction.fees.platform?.amount.toString()).toBe('0.0001');
    expect(transaction.fees.platform?.currency).toBe('BTC');
  });
});

describe('KrakenProcessor - Transfer Handling', () => {
  test('processes token migration (RNDR→RENDER)', async () => {
    const processor = createProcessor();

    const ledgerEntries: KrakenLedgerEntry[] = [
      {
        id: 'LEDGER10A',
        refid: 'REF011',
        time: 1704067211,
        type: 'transfer',
        subtype: 'spotfromspot',
        asset: 'RNDR',
        amount: '-100.00', // RNDR out
        fee: '0.00',
        aclass: 'currency',
        balance: '0.00',
      },
      {
        id: 'LEDGER10B',
        refid: 'REF011',
        time: 1704067211,
        type: 'transfer',
        subtype: 'spotfromspot',
        asset: 'RENDER',
        amount: '100.00', // RENDER in
        fee: '0.00',
        aclass: 'currency',
        balance: '100.00',
      },
    ];

    const result = await processor.process(ledgerEntries, {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(2);

    // RNDR out
    expect(transactions[0]?.operation.category).toBe('transfer');
    expect(transactions[0]?.operation.type).toBe('withdrawal');
    expect(transactions[0]?.movements.outflows[0]?.asset).toBe('RNDR');

    // RENDER in
    expect(transactions[1]?.operation.category).toBe('transfer');
    expect(transactions[1]?.operation.type).toBe('deposit');
    expect(transactions[1]?.movements.inflows[0]?.asset).toBe('RENDER');
  });

  test('processes spot to futures transfer', async () => {
    const processor = createProcessor();

    const ledgerEntries: KrakenLedgerEntry[] = [
      {
        id: 'LEDGER11A',
        refid: 'REF012',
        time: 1704067212,
        type: 'transfer',
        subtype: 'spottofutures',
        asset: 'ZUSD',
        amount: '-500.00', // Out of spot
        fee: '0.00',
        aclass: 'currency',
        balance: '27.50',
      },
      {
        id: 'LEDGER11B',
        refid: 'REF012',
        time: 1704067212,
        type: 'transfer',
        subtype: 'spottofutures',
        asset: 'ZUSD',
        amount: '500.00', // Into futures
        fee: '0.00',
        aclass: 'currency',
        balance: '500.00',
      },
    ];

    const result = await processor.process(ledgerEntries, {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(2);

    // Verify both transactions processed
    expect(transactions[0]?.movements.outflows[0]?.amount.amount.toString()).toBe('500');
    expect(transactions[1]?.movements.inflows[0]?.amount.amount.toString()).toBe('500');
  });
});

describe('KrakenProcessor - Asset Normalization', () => {
  test('normalizes Kraken asset symbols correctly', async () => {
    const processor = createProcessor();

    const testCases: { expected: string; krakenAsset: string }[] = [
      { krakenAsset: 'XXBT', expected: 'BTC' },
      { krakenAsset: 'XBT', expected: 'BTC' },
      { krakenAsset: 'XETH', expected: 'ETH' },
      { krakenAsset: 'XXRP', expected: 'XRP' },
      { krakenAsset: 'ZUSD', expected: 'USD' },
      { krakenAsset: 'ZEUR', expected: 'EUR' },
      { krakenAsset: 'ZCAD', expected: 'CAD' },
      { krakenAsset: 'XXDG', expected: 'DOGE' },
    ];

    for (const { krakenAsset, expected } of testCases) {
      const ledgerEntry: KrakenLedgerEntry = {
        id: `LEDGER_${krakenAsset}`,
        refid: 'REFTEST',
        time: 1704067213,
        type: 'deposit',
        asset: krakenAsset,
        amount: '1.0',
        fee: '0.0',
        aclass: 'currency',
        balance: '1.0',
      };

      const result = await processor.process([ledgerEntry], {});

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) continue;

      const [transaction] = result.value;
      expect(transaction?.movements.inflows[0]?.asset).toBe(expected);
    }
  });
});

describe('KrakenProcessor - Edge Cases', () => {
  test('handles zero amount ledger entry', async () => {
    const processor = createProcessor();

    const ledgerEntry: KrakenLedgerEntry = {
      id: 'LEDGER12',
      refid: 'REF013',
      time: 1704067214,
      type: 'trade',
      asset: 'ZUSD',
      amount: '0.00',
      fee: '0.00',
      aclass: 'currency',
      balance: '527.50',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
  });

  test('handles unknown ledger type gracefully', async () => {
    const processor = createProcessor();

    const ledgerEntry: KrakenLedgerEntry = {
      id: 'LEDGER13',
      refid: 'REF014',
      time: 1704067215,
      type: 'unknown_type',
      asset: 'ZUSD',
      amount: '100.00',
      fee: '0.00',
      aclass: 'currency',
      balance: '627.50',
    };

    const result = await processor.process([ledgerEntry], {});

    // Should still succeed but may skip unknown type
    expect(result.isOk()).toBe(true);
  });

  test('processes multiple ledger entries in sequence', async () => {
    const processor = createProcessor();

    const ledgerEntries: KrakenLedgerEntry[] = [
      {
        id: 'LEDGER14A',
        refid: 'REF015',
        time: 1704067216,
        type: 'deposit',
        asset: 'ZCAD',
        amount: '1000.00',
        fee: '5.00',
        aclass: 'currency',
        balance: '995.00',
      },
      {
        id: 'LEDGER14B',
        refid: 'REF016',
        time: 1704067217,
        type: 'withdrawal',
        asset: 'ZCAD',
        amount: '-500.00',
        fee: '2.50',
        aclass: 'currency',
        balance: '492.50',
      },
      {
        id: 'LEDGER14C',
        refid: 'REF017',
        time: 1704067218,
        type: 'trade',
        asset: 'ZCAD',
        amount: '-492.50',
        fee: '0.00',
        aclass: 'currency',
        balance: '0.00',
      },
    ];

    const result = await processor.process(ledgerEntries, {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const transactions = result.value;
    expect(transactions).toHaveLength(3);
    expect(transactions[0]?.operation.type).toBe('deposit');
    expect(transactions[1]?.operation.type).toBe('withdrawal');
    expect(transactions[2]?.operation.type).toBe('sell');
  });
});

describe('KrakenProcessor - Fee Handling', () => {
  test('stores fee in correct currency', async () => {
    const processor = createProcessor();

    const ledgerEntry: KrakenLedgerEntry = {
      id: 'LEDGER15',
      refid: 'REF018',
      time: 1704067219,
      type: 'trade',
      asset: 'XXBT',
      amount: '0.1',
      fee: '0.0005',
      aclass: 'currency',
      balance: '0.0995',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Fee should be in same currency as the ledger entry
    expect(transaction.fees.platform?.currency).toBe('BTC');
    expect(transaction.fees.platform?.amount.toString()).toBe('0.0005');
    expect(transaction.fees.total?.currency).toBe('BTC');
  });

  test('handles negative fees (refunds)', async () => {
    const processor = createProcessor();

    const ledgerEntry: KrakenLedgerEntry = {
      id: 'LEDGER16',
      refid: 'REF019',
      time: 1704067220,
      type: 'withdrawal',
      asset: 'ZCAD',
      amount: '500.00', // Refund
      fee: '-2.50', // Fee refund
      aclass: 'currency',
      balance: '502.50',
    };

    const result = await processor.process([ledgerEntry], {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Negative fee should be stored as-is
    expect(transaction.fees.platform?.amount.toString()).toBe('-2.5');
  });
});
