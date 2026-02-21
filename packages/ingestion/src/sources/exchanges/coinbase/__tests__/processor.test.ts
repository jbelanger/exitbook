import type { Currency } from '@exitbook/core';
import type { CoinbaseLedgerEntry } from '@exitbook/exchange-providers';
import { describe, expect, test } from 'vitest';

import type { RawTransactionWithMetadata } from '../../shared/strategies/index.js';
import { CoinbaseProcessor } from '../processor.js';

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

function buildEntry(
  overrides?: DeepPartial<RawTransactionWithMetadata<CoinbaseLedgerEntry>>
): RawTransactionWithMetadata<CoinbaseLedgerEntry> {
  const timestamp = 1_767_278_215_000; // 2026-01-01T14:36:55.000Z
  const base: RawTransactionWithMetadata<CoinbaseLedgerEntry> = {
    eventId: 'entry-1',
    cursor: {},
    normalized: {
      id: 'entry-1',
      correlationId: 'corr-1',
      timestamp,
      type: 'advanced_trade_fill',
      assetSymbol: 'USDC' as Currency,
      amount: '100.00',
      status: 'success',
    },
    raw: {
      id: 'entry-1',
      direction: 'in',
      account: 'account-1',
      type: 'advanced_trade_fill',
      currency: 'USDC',
      amount: '100.00',
      timestamp,
      datetime: new Date(timestamp).toISOString(),
      status: 'ok',
    },
  };

  const merged = {
    ...base,
    ...(overrides || {}),
  };

  return {
    ...merged,
    normalized: {
      ...base.normalized,
      ...(overrides?.normalized || {}),
    },
    raw: {
      ...base.raw,
      ...(overrides?.raw || {}),
    },
  } as RawTransactionWithMetadata<CoinbaseLedgerEntry>;
}

function createProcessor() {
  return new CoinbaseProcessor();
}

describe('CoinbaseProcessor - Interest/Staking Rewards', () => {
  test('classifies interest transactions as staking rewards', async () => {
    const processor = createProcessor();

    const interestEntry = buildEntry({
      normalized: {
        id: 'interest-1',
        correlationId: 'interest-corr-1',
        type: 'interest',
        assetSymbol: 'USDC' as Currency,
        amount: '0.000798',
      },
      raw: {
        id: 'ce0c0c8a-da45-5570-a7a2-d00a36780c98',
        type: 'interest',
        direction: 'in',
        currency: 'USDC',
        amount: '0.000798',
      },
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
        normalized: {
          id: 'interest-1',
          correlationId: 'interest-corr-1',
          type: 'interest',
          assetSymbol: 'USDC' as Currency,
          amount: '0.000798',
        },
        raw: {
          id: 'interest-1',
          type: 'interest',
          currency: 'USDC',
          amount: '0.000798',
        },
      }),
      buildEntry({
        normalized: {
          id: 'interest-2',
          correlationId: 'interest-corr-2',
          type: 'interest',
          assetSymbol: 'ETH' as Currency,
          amount: '0.0001',
        },
        raw: {
          id: 'interest-2',
          type: 'interest',
          currency: 'ETH',
          amount: '0.0001',
        },
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
      normalized: {
        id: 'deposit-1',
        correlationId: 'deposit-corr-1',
        type: 'fiat_deposit',
        assetSymbol: 'USD' as Currency,
        amount: '100.00',
      },
      raw: {
        id: 'deposit-1',
        type: 'fiat_deposit',
        direction: 'in',
        currency: 'USD',
        amount: '100.00',
      },
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
      normalized: {
        id: 'deposit-2',
        correlationId: 'deposit-corr-2',
        type: 'send',
        assetSymbol: 'BTC' as Currency,
        amount: '0.01',
      },
      raw: {
        id: 'deposit-2',
        type: 'send',
        direction: 'in',
        currency: 'BTC',
        amount: '0.01',
      },
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
      normalized: {
        id: 'withdrawal-1',
        correlationId: 'withdrawal-corr-1',
        type: 'fiat_withdrawal',
        assetSymbol: 'USD' as Currency,
        amount: '-50.00',
        fee: '1.00',
        feeCurrency: 'USD' as Currency,
      },
      raw: {
        id: 'withdrawal-1',
        type: 'fiat_withdrawal',
        direction: 'out',
        currency: 'USD',
        amount: '-50.00',
      },
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
    expect(outflow?.netAmount!.toFixed()).toBe('49');
  });

  test('classifies crypto withdrawals correctly', async () => {
    const processor = createProcessor();

    const withdrawalEntry = buildEntry({
      normalized: {
        id: 'withdrawal-2',
        correlationId: 'withdrawal-corr-2',
        type: 'transaction',
        assetSymbol: 'ETH' as Currency,
        amount: '-1.5',
        fee: '0.001',
        feeCurrency: 'ETH' as Currency,
      },
      raw: {
        id: 'withdrawal-2',
        type: 'transaction',
        direction: 'out',
        currency: 'ETH',
        amount: '-1.5',
      },
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
    expect(outflow?.netAmount!.toFixed()).toBe('1.499');

    expect(transaction.fees).toHaveLength(1);
    expect(transaction.fees[0]?.amount.toFixed()).toBe('0.001');
  });
});

describe('CoinbaseProcessor - Swaps/Trades', () => {
  test('classifies advanced trade fills as swaps', async () => {
    const processor = createProcessor();

    const tradeEntries = [
      buildEntry({
        normalized: {
          id: 'trade-1-out',
          correlationId: 'trade-corr-1',
          type: 'advanced_trade_fill',
          assetSymbol: 'USDC' as Currency,
          amount: '-100.00',
          fee: '0.05',
          feeCurrency: 'USDC' as Currency,
        },
        raw: {
          id: 'trade-1-out',
          type: 'advanced_trade_fill',
          direction: 'out',
          currency: 'USDC',
          amount: '-100.00',
        },
      }),
      buildEntry({
        normalized: {
          id: 'trade-1-in',
          correlationId: 'trade-corr-1',
          type: 'advanced_trade_fill',
          assetSymbol: 'ETH' as Currency,
          amount: '0.04',
          fee: '0.05',
          feeCurrency: 'USDC' as Currency,
        },
        raw: {
          id: 'trade-1-in',
          type: 'advanced_trade_fill',
          direction: 'in',
          currency: 'ETH',
          amount: '0.04',
        },
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
});

describe('CoinbaseProcessor - Mixed Transaction Batch', () => {
  test('processes mixed transaction types correctly', async () => {
    const processor = createProcessor();

    const mixedEntries = [
      buildEntry({
        normalized: {
          id: 'interest-1',
          correlationId: 'interest-corr-1',
          type: 'interest',
          assetSymbol: 'USDC' as Currency,
          amount: '0.5',
        },
        raw: {
          id: 'interest-1',
          type: 'interest',
          currency: 'USDC',
          amount: '0.5',
        },
      }),
      buildEntry({
        normalized: {
          id: 'deposit-1',
          correlationId: 'deposit-corr-1',
          type: 'fiat_deposit',
          assetSymbol: 'USD' as Currency,
          amount: '100',
        },
        raw: {
          id: 'deposit-1',
          type: 'fiat_deposit',
          currency: 'USD',
          amount: '100',
        },
      }),
      buildEntry({
        normalized: {
          id: 'withdrawal-1',
          correlationId: 'withdrawal-corr-1',
          type: 'fiat_withdrawal',
          assetSymbol: 'USD' as Currency,
          amount: '-50',
        },
        raw: {
          id: 'withdrawal-1',
          type: 'fiat_withdrawal',
          currency: 'USD',
          amount: '-50',
        },
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
      normalized: {
        id: 'deposit-with-hash',
        correlationId: 'deposit-corr-1',
        type: 'send',
        assetSymbol: 'BTC' as Currency,
        amount: '0.01',
        hash: '0xabc123def456',
        network: 'bitcoin',
        address: 'bc1q...',
      },
      raw: {
        id: 'deposit-with-hash',
        type: 'send',
        direction: 'in',
        currency: 'BTC',
        amount: '0.01',
      },
    });

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
      normalized: {
        id: 'pending-deposit',
        correlationId: 'deposit-corr-2',
        type: 'send',
        assetSymbol: 'ETH' as Currency,
        amount: '1.5',
        status: 'pending',
        hash: '0xpending123',
        network: 'ethereum',
      },
      raw: {
        id: 'pending-deposit',
        type: 'send',
        direction: 'in',
        currency: 'ETH',
        amount: '1.5',
        status: 'pending',
      },
    });

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

  test('uses unknown blockchain name when network is not provided', async () => {
    const processor = createProcessor();

    const depositEntry = buildEntry({
      normalized: {
        id: 'deposit-no-network',
        correlationId: 'deposit-corr-3',
        type: 'send',
        assetSymbol: 'USDC' as Currency,
        amount: '100',
        hash: '0xhash456',
      },
      raw: {
        id: 'deposit-no-network',
        type: 'send',
        direction: 'in',
        currency: 'USDC',
        amount: '100',
      },
    });

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
      normalized: {
        id: 'deposit-no-hash',
        correlationId: 'deposit-corr-4',
        type: 'send',
        assetSymbol: 'BTC' as Currency,
        amount: '0.01',
        hash: '',
      },
      raw: {
        id: 'deposit-no-hash',
        type: 'send',
        direction: 'in',
        currency: 'BTC',
        amount: '0.01',
      },
    });

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
      normalized: {
        id: 'fiat-deposit',
        correlationId: 'deposit-corr-5',
        type: 'fiat_deposit',
        assetSymbol: 'USD' as Currency,
        amount: '100',
      },
      raw: {
        id: 'fiat-deposit',
        type: 'fiat_deposit',
        direction: 'in',
        currency: 'USD',
        amount: '100',
      },
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
