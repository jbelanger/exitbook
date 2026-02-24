import type { RawCoinbaseLedgerEntry } from '@exitbook/exchange-providers';
import { describe, expect, test } from 'vitest';

import type { DeepPartial } from '../../../../shared/test-utils/index.js';
import type { RawExchangeInput } from '../../shared/strategies/index.js';
import { CoinbaseProcessor } from '../processor.js';

const CREATED_AT = '2026-01-01T14:36:55.000Z';

function buildEntry(overrides?: DeepPartial<RawCoinbaseLedgerEntry>): RawExchangeInput<RawCoinbaseLedgerEntry> {
  const base: RawCoinbaseLedgerEntry = {
    id: 'entry-1',
    type: 'advanced_trade_fill',
    created_at: CREATED_AT,
    status: 'ok',
    amount: { amount: '100.00', currency: 'USDC' },
  };

  const raw = {
    ...base,
    ...(overrides || {}),
    amount: {
      ...base.amount,
      ...(overrides?.amount || {}),
    },
  } as RawCoinbaseLedgerEntry;

  return { raw, eventId: raw.id };
}

function createProcessor() {
  return new CoinbaseProcessor();
}

describe('CoinbaseProcessor - Interest/Staking Rewards', () => {
  test('classifies interest transactions as staking rewards', async () => {
    const processor = createProcessor();

    const interestEntry = buildEntry({
      id: 'interest-1',
      type: 'interest',
      amount: { amount: '0.000798', currency: 'USDC' },
    });

    const result = await processor.process([interestEntry]);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('staking');
    expect(transaction.operation.type).toBe('reward');

    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows![0]?.assetSymbol).toBe('USDC');
    expect(transaction.movements.inflows![0]?.grossAmount.toFixed()).toBe('0.000798');

    expect(transaction.movements.outflows).toHaveLength(0);
  });

  test('classifies multiple interest entries as staking rewards', async () => {
    const processor = createProcessor();

    const entries = [
      buildEntry({
        id: 'interest-1',
        type: 'interest',
        amount: { amount: '0.000798', currency: 'USDC' },
      }),
      buildEntry({
        id: 'interest-2',
        type: 'interest',
        amount: { amount: '0.0001', currency: 'ETH' },
      }),
    ];

    const result = await processor.process(entries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(2);

    result.value.forEach((transaction) => {
      expect(transaction.operation.category).toBe('staking');
      expect(transaction.operation.type).toBe('reward');
      expect(transaction.movements.inflows!.length).toBeGreaterThan(0);
      expect(transaction.movements.outflows).toHaveLength(0);
    });
  });
});

describe('CoinbaseProcessor - Regular Deposits', () => {
  test('classifies fiat deposits as transfers', async () => {
    const processor = createProcessor();

    const depositEntry = buildEntry({
      id: 'deposit-1',
      type: 'fiat_deposit',
      amount: { amount: '100.00', currency: 'USD' },
    });

    const result = await processor.process([depositEntry]);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');

    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows![0]?.assetSymbol).toBe('USD');
    expect(transaction.movements.outflows).toHaveLength(0);
  });

  test('classifies crypto deposits as transfers', async () => {
    const processor = createProcessor();

    const depositEntry = buildEntry({
      id: 'deposit-2',
      type: 'send',
      amount: { amount: '0.01', currency: 'BTC' },
    });

    const result = await processor.process([depositEntry]);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('deposit');
  });
});

describe('CoinbaseProcessor - Withdrawals', () => {
  test('classifies fiat withdrawals correctly', async () => {
    const processor = createProcessor();

    const withdrawalEntry = buildEntry({
      id: 'withdrawal-1',
      type: 'fiat_withdrawal',
      amount: { amount: '-50.00', currency: 'USD' },
    });

    const result = await processor.process([withdrawalEntry]);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');

    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.inflows).toHaveLength(0);

    const outflow = transaction.movements.outflows![0];
    expect(outflow?.assetSymbol).toBe('USD');
    expect(outflow?.grossAmount.toFixed()).toBe('50');
  });

  test('classifies crypto withdrawals correctly', async () => {
    const processor = createProcessor();

    const withdrawalEntry = buildEntry({
      id: 'withdrawal-2',
      type: 'transaction',
      amount: { amount: '-1.5', currency: 'ETH' },
    });

    const result = await processor.process([withdrawalEntry]);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('transfer');
    expect(transaction.operation.type).toBe('withdrawal');

    expect(transaction.movements.outflows).toHaveLength(1);
    const outflow = transaction.movements.outflows![0];
    expect(outflow?.assetSymbol).toBe('ETH');
    expect(outflow?.grossAmount.toFixed()).toBe('1.5');
  });
});

describe('CoinbaseProcessor - Swaps/Trades', () => {
  test('classifies advanced trade fills as swaps', async () => {
    const processor = createProcessor();

    // Both entries must share the same order_id so byCorrelationId groups them together
    const tradeEntries = [
      buildEntry({
        id: 'trade-1-out',
        type: 'advanced_trade_fill',
        amount: { amount: '-100.00', currency: 'USDC' },
        advanced_trade_fill: { order_id: 'ORDER-001' } as RawCoinbaseLedgerEntry['advanced_trade_fill'],
      }),
      buildEntry({
        id: 'trade-1-in',
        type: 'advanced_trade_fill',
        amount: { amount: '0.04', currency: 'ETH' },
        advanced_trade_fill: { order_id: 'ORDER-001' } as RawCoinbaseLedgerEntry['advanced_trade_fill'],
      }),
    ];

    const result = await processor.process(tradeEntries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.operation.category).toBe('trade');
    expect(transaction.operation.type).toBe('swap');

    expect(transaction.movements.outflows).toHaveLength(1);
    expect(transaction.movements.outflows![0]?.assetSymbol).toBe('USDC');
    expect(transaction.movements.outflows![0]?.grossAmount.toFixed()).toBe('100');

    expect(transaction.movements.inflows).toHaveLength(1);
    expect(transaction.movements.inflows![0]?.assetSymbol).toBe('ETH');
    expect(transaction.movements.inflows![0]?.grossAmount.toFixed()).toBe('0.04');
  });

  test('extracts commission as fee for advanced trade fills', async () => {
    const processor = createProcessor();

    const tradeEntries = [
      buildEntry({
        id: 'trade-fee-out',
        type: 'advanced_trade_fill',
        amount: { amount: '-100.00', currency: 'USDC' },
        advanced_trade_fill: {
          order_id: 'ORDER-FEE',
          commission: '0.60',
          product_id: 'ETH-USDC',
        } as RawCoinbaseLedgerEntry['advanced_trade_fill'],
      }),
      buildEntry({
        id: 'trade-fee-in',
        type: 'advanced_trade_fill',
        amount: { amount: '0.04', currency: 'ETH' },
        advanced_trade_fill: {
          order_id: 'ORDER-FEE',
          commission: '0.60',
          product_id: 'ETH-USDC',
        } as RawCoinbaseLedgerEntry['advanced_trade_fill'],
      }),
    ];

    const result = await processor.process(tradeEntries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    // Fee should be present and deduplicated (only counted once despite appearing on both entries)
    expect(transaction.fees).toHaveLength(1);
    expect(transaction.fees[0]?.assetSymbol).toBe('USDC');
    expect(transaction.fees[0]?.amount.toFixed()).toBe('0.6');
    expect(transaction.fees[0]?.settlement).toBe('balance');
  });
});

describe('CoinbaseProcessor - Mixed Transaction Batch', () => {
  test('processes mixed transaction types correctly', async () => {
    const processor = createProcessor();

    const mixedEntries = [
      buildEntry({
        id: 'interest-1',
        type: 'interest',
        amount: { amount: '0.5', currency: 'USDC' },
      }),
      buildEntry({
        id: 'deposit-1',
        type: 'fiat_deposit',
        amount: { amount: '100', currency: 'USD' },
      }),
      buildEntry({
        id: 'withdrawal-1',
        type: 'fiat_withdrawal',
        amount: { amount: '-50', currency: 'USD' },
      }),
    ];

    const result = await processor.process(mixedEntries);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(3);

    const [interest, deposit, withdrawal] = result.value;

    expect(interest?.operation).toEqual({ category: 'staking', type: 'reward' });
    expect(deposit?.operation).toEqual({ category: 'transfer', type: 'deposit' });
    expect(withdrawal?.operation).toEqual({ category: 'transfer', type: 'withdrawal' });
  });
});

describe('CoinbaseProcessor - Blockchain Hash Extraction', () => {
  test('populates blockchain field when hash is present and status is success', async () => {
    const processor = createProcessor();

    const depositEntry = buildEntry({
      id: 'deposit-with-hash',
      type: 'send',
      amount: { amount: '0.01', currency: 'BTC' },
      network: { hash: '0xabc123def456', network_name: 'bitcoin', status: 'confirmed' },
      to: { address: 'bc1q...', resource: 'address' },
    } as DeepPartial<RawCoinbaseLedgerEntry>);

    const result = await processor.process([depositEntry]);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.blockchain).toBeDefined();
    expect(transaction.blockchain?.name).toBe('bitcoin');
    expect(transaction.blockchain?.transaction_hash).toBe('0xabc123def456');
    expect(transaction.blockchain?.is_confirmed).toBe(true);
    expect(transaction.to).toBe('bc1q...');
  });

  test('sets blockchain is_confirmed to false when status is not success', async () => {
    const processor = createProcessor();

    const depositEntry = buildEntry({
      id: 'pending-deposit',
      type: 'send',
      status: 'pending',
      amount: { amount: '1.5', currency: 'ETH' },
      network: { hash: '0xpending123', network_name: 'ethereum', status: 'pending' },
    } as DeepPartial<RawCoinbaseLedgerEntry>);

    const result = await processor.process([depositEntry]);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.blockchain).toBeDefined();
    expect(transaction.blockchain?.transaction_hash).toBe('0xpending123');
    expect(transaction.blockchain?.is_confirmed).toBe(false);
  });

  test('uses unknown blockchain name when network_name is not provided', async () => {
    const processor = createProcessor();

    const depositEntry = buildEntry({
      id: 'deposit-no-network',
      type: 'send',
      amount: { amount: '100', currency: 'USDC' },
      network: { hash: '0xhash456', network_name: '', status: 'confirmed' },
    } as DeepPartial<RawCoinbaseLedgerEntry>);

    const result = await processor.process([depositEntry]);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.blockchain).toBeDefined();
    expect(transaction.blockchain?.name).toBe('unknown');
    expect(transaction.blockchain?.transaction_hash).toBe('0xhash456');
  });

  test('does not populate blockchain field when hash is empty', async () => {
    const processor = createProcessor();

    const depositEntry = buildEntry({
      id: 'deposit-no-hash',
      type: 'send',
      amount: { amount: '0.01', currency: 'BTC' },
      network: { hash: '', network_name: 'bitcoin', status: 'confirmed' },
    } as DeepPartial<RawCoinbaseLedgerEntry>);

    const result = await processor.process([depositEntry]);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.blockchain).toBeUndefined();
  });

  test('does not populate blockchain field when hash is missing', async () => {
    const processor = createProcessor();

    const depositEntry = buildEntry({
      id: 'fiat-deposit',
      type: 'fiat_deposit',
      amount: { amount: '100', currency: 'USD' },
    });

    const result = await processor.process([depositEntry]);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const [transaction] = result.value;
    expect(transaction).toBeDefined();
    if (!transaction) return;

    expect(transaction.blockchain).toBeUndefined();
  });
});
