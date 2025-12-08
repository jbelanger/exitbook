import { parseDecimal } from '@exitbook/core';
import type { ImportSession, UniversalTransactionData } from '@exitbook/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildBalanceParamsFromFlags,
  decimalRecordToStringRecord,
  findMostRecentCompletedSession,
  getExchangeCredentialsFromEnv,
  sortSessionsByCompletedDate,
  subtractExcludedAmounts,
  sumExcludedInflowAmounts,
  validateBalanceParams,
  type BalanceCommandOptions,
  type BalanceHandlerParams,
} from './balance-utils.js';

describe('buildBalanceParamsFromFlags', () => {
  it('should return error when neither exchange nor blockchain is specified', () => {
    const options: BalanceCommandOptions = {};
    const result = buildBalanceParamsFromFlags(options);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Either --exchange or --blockchain must be specified');
    }
  });

  it('should return error when both exchange and blockchain are specified', () => {
    const options: BalanceCommandOptions = {
      exchange: 'kraken',
      blockchain: 'bitcoin',
    };
    const result = buildBalanceParamsFromFlags(options);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Cannot specify both --exchange and --blockchain');
    }
  });

  it('should build exchange params without credentials', () => {
    const options: BalanceCommandOptions = {
      exchange: 'kraken',
    };
    const result = buildBalanceParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        sourceType: 'exchange',
        sourceName: 'kraken',
        credentials: undefined,
      });
    }
  });

  it('should build exchange params with credentials', () => {
    const options: BalanceCommandOptions = {
      exchange: 'kucoin',
      apiKey: 'test-key',
      apiSecret: 'test-secret',
      apiPassphrase: 'test-passphrase',
    };
    const result = buildBalanceParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        sourceType: 'exchange',
        sourceName: 'kucoin',
        credentials: {
          apiKey: 'test-key',
          secret: 'test-secret',
          passphrase: 'test-passphrase',
        },
      });
    }
  });

  it('should build exchange params with credentials without passphrase', () => {
    const options: BalanceCommandOptions = {
      exchange: 'kraken',
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    };
    const result = buildBalanceParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        sourceType: 'exchange',
        sourceName: 'kraken',
        credentials: {
          apiKey: 'test-key',
          secret: 'test-secret',
        },
      });
    }
  });

  it('should return error when only apiKey is provided', () => {
    const options: BalanceCommandOptions = {
      exchange: 'kraken',
      apiKey: 'test-key',
    };
    const result = buildBalanceParamsFromFlags(options);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Both --api-key and --api-secret must be provided together');
    }
  });

  it('should return error when only apiSecret is provided', () => {
    const options: BalanceCommandOptions = {
      exchange: 'kraken',
      apiSecret: 'test-secret',
    };
    const result = buildBalanceParamsFromFlags(options);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Both --api-key and --api-secret must be provided together');
    }
  });

  it('should build blockchain params with address', () => {
    const options: BalanceCommandOptions = {
      blockchain: 'bitcoin',
      address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    };
    const result = buildBalanceParamsFromFlags(options);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        sourceType: 'blockchain',
        sourceName: 'bitcoin',
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      });
    }
  });

  it('should return error when blockchain is specified without address', () => {
    const options: BalanceCommandOptions = {
      blockchain: 'ethereum',
    };
    const result = buildBalanceParamsFromFlags(options);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('--address is required when using --blockchain');
    }
  });
});

describe('validateBalanceParams', () => {
  it('should validate valid exchange params', () => {
    const params: BalanceHandlerParams = {
      sourceType: 'exchange',
      sourceName: 'kraken',
    };
    const result = validateBalanceParams(params);

    expect(result.isOk()).toBe(true);
  });

  it('should validate valid blockchain params', () => {
    const params: BalanceHandlerParams = {
      sourceType: 'blockchain',
      sourceName: 'bitcoin',
      address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    };
    const result = validateBalanceParams(params);

    expect(result.isOk()).toBe(true);
  });

  it('should return error when sourceName is empty', () => {
    const params: BalanceHandlerParams = {
      sourceType: 'exchange',
      sourceName: '',
    };
    const result = validateBalanceParams(params);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Source name is required');
    }
  });

  it('should return error when blockchain sourceType has no address', () => {
    const params: BalanceHandlerParams = {
      sourceType: 'blockchain',
      sourceName: 'ethereum',
    };
    const result = validateBalanceParams(params);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Address is required for blockchain sources');
    }
  });
});

describe('getExchangeCredentialsFromEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return credentials from environment variables', () => {
    process.env.KRAKEN_API_KEY = 'env-key';
    process.env.KRAKEN_SECRET = 'env-secret';

    const result = getExchangeCredentialsFromEnv('kraken');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        apiKey: 'env-key',
        secret: 'env-secret',
      });
    }
  });

  it('should include passphrase if present', () => {
    process.env.KUCOIN_API_KEY = 'env-key';
    process.env.KUCOIN_SECRET = 'env-secret';
    process.env.KUCOIN_PASSPHRASE = 'env-passphrase';

    const result = getExchangeCredentialsFromEnv('kucoin');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        apiKey: 'env-key',
        secret: 'env-secret',
        passphrase: 'env-passphrase',
      });
    }
  });

  it.skipIf(!!originalEnv.KRAKEN_API_KEY)('should return error when API key is missing', () => {
    process.env.KRAKEN_SECRET = 'env-secret';

    const result = getExchangeCredentialsFromEnv('kraken');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Missing KRAKEN_API_KEY or KRAKEN_SECRET in environment');
    }
  });

  it.skipIf(!!originalEnv.KRAKEN_SECRET)('should return error when API secret is missing', () => {
    process.env.KRAKEN_API_KEY = 'env-key';

    const result = getExchangeCredentialsFromEnv('kraken');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Missing KRAKEN_API_KEY or KRAKEN_SECRET in environment');
    }
  });

  it('should handle uppercase exchange names', () => {
    process.env.BINANCE_API_KEY = 'env-key';
    process.env.BINANCE_SECRET = 'env-secret';

    const result = getExchangeCredentialsFromEnv('binance');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.apiKey).toBe('env-key');
      expect(result.value.secret).toBe('env-secret');
    }
  });
});

describe('decimalRecordToStringRecord', () => {
  it('should convert Decimal values to strings', () => {
    const input = {
      BTC: parseDecimal('1.23456789'),
      ETH: parseDecimal('10.5'),
      USDT: parseDecimal('1000'),
    };

    const result = decimalRecordToStringRecord(input);

    expect(result).toEqual({
      BTC: '1.23456789',
      ETH: '10.5',
      USDT: '1000',
    });
  });

  it('should handle empty record', () => {
    const result = decimalRecordToStringRecord({});

    expect(result).toEqual({});
  });

  it('should handle zero values', () => {
    const input = {
      BTC: parseDecimal('0'),
      ETH: parseDecimal('0.0'),
    };

    const result = decimalRecordToStringRecord(input);

    expect(result).toEqual({
      BTC: '0',
      ETH: '0',
    });
  });

  it('should handle very small decimal values', () => {
    const input = {
      BTC: parseDecimal('0.00000001'),
    };

    const result = decimalRecordToStringRecord(input);

    expect(result).toEqual({
      BTC: '0.00000001',
    });
  });

  it('should handle very large decimal values without scientific notation', () => {
    const input = {
      SHIB: parseDecimal('1000000000000'),
      WEI: parseDecimal('999999999999999999'),
    };

    const result = decimalRecordToStringRecord(input);

    expect(result).toEqual({
      SHIB: '1000000000000',
      WEI: '999999999999999999',
    });
  });
});

describe('sortSessionsByCompletedDate', () => {
  it('should sort sessions by completed date in descending order', () => {
    const sessions: ImportSession[] = [
      {
        id: 1,
        accountId: 1,
        status: 'completed',
        transactionsImported: 10,
        transactionsSkipped: 0,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        startedAt: new Date('2024-01-01T00:00:00Z'),
        completedAt: new Date('2024-01-01T01:00:00Z'),
        durationMs: 60000,
      },
      {
        id: 2,
        accountId: 1,
        status: 'completed',
        transactionsImported: 20,
        transactionsSkipped: 0,
        createdAt: new Date('2024-01-02T00:00:00Z'),
        startedAt: new Date('2024-01-02T00:00:00Z'),
        completedAt: new Date('2024-01-02T01:00:00Z'),
        durationMs: 60000,
      },
      {
        id: 3,
        accountId: 1,
        status: 'completed',
        transactionsImported: 30,
        transactionsSkipped: 0,
        createdAt: new Date('2024-01-03T00:00:00Z'),
        startedAt: new Date('2024-01-03T00:00:00Z'),
        completedAt: new Date('2024-01-03T01:00:00Z'),
        durationMs: 60000,
      },
    ];

    const result = sortSessionsByCompletedDate(sessions);

    expect(result[0]?.id).toBe(3);
    expect(result[1]?.id).toBe(2);
    expect(result[2]?.id).toBe(1);
  });

  it('should handle sessions with no completed date', () => {
    const sessions: ImportSession[] = [
      {
        id: 1,
        accountId: 1,
        status: 'completed',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        startedAt: new Date('2024-01-01T00:00:00Z'),
        completedAt: new Date('2024-01-02T01:00:00Z'),
        durationMs: 60000,
        transactionsImported: 10,
        transactionsSkipped: 0,
      },
      {
        id: 2,
        accountId: 1,
        status: 'started',
        createdAt: new Date('2024-01-02T00:00:00Z'),
        startedAt: new Date('2024-01-02T00:00:00Z'),
        durationMs: undefined,
        transactionsImported: 20,
        transactionsSkipped: 0,
      },
    ];

    const result = sortSessionsByCompletedDate(sessions);

    expect(result[0]?.id).toBe(1);
    expect(result[1]?.id).toBe(2);
  });

  it('should not mutate the original array', () => {
    const sessions: ImportSession[] = [
      {
        id: 1,
        accountId: 1,
        status: 'completed',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        startedAt: new Date('2024-01-01T00:00:00Z'),
        completedAt: new Date('2024-01-01T01:00:00Z'),
        durationMs: 60000,
        transactionsImported: 10,
        transactionsSkipped: 0,
      },
      {
        id: 2,
        accountId: 1,
        status: 'completed',
        createdAt: new Date('2024-01-02T00:00:00Z'),
        startedAt: new Date('2024-01-02T00:00:00Z'),
        completedAt: new Date('2024-01-02T01:00:00Z'),
        durationMs: 60000,
        transactionsImported: 20,
        transactionsSkipped: 0,
      },
    ];

    const original = [...sessions];
    sortSessionsByCompletedDate(sessions);

    expect(sessions).toEqual(original);
  });
});

describe('findMostRecentCompletedSession', () => {
  it('should return the most recent completed session', () => {
    const sessions: ImportSession[] = [
      {
        id: 1,
        accountId: 1,
        status: 'completed',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        startedAt: new Date('2024-01-01T00:00:00Z'),
        completedAt: new Date('2024-01-01T01:00:00Z'),
        durationMs: 60000,
        transactionsImported: 10,
        transactionsSkipped: 0,
      },
      {
        id: 2,
        accountId: 1,
        status: 'completed',
        createdAt: new Date('2024-01-02T00:00:00Z'),
        startedAt: new Date('2024-01-02T00:00:00Z'),
        completedAt: new Date('2024-01-02T01:00:00Z'),
        durationMs: 60000,
        transactionsImported: 20,
        transactionsSkipped: 0,
      },
      {
        id: 3,
        accountId: 1,
        status: 'started',
        createdAt: new Date('2024-01-03T00:00:00Z'),
        startedAt: new Date('2024-01-03T00:00:00Z'),
        durationMs: undefined,
        transactionsImported: 30,
        transactionsSkipped: 0,
      },
    ];

    const result = findMostRecentCompletedSession(sessions);

    expect(result?.id).toBe(2);
  });

  it('should return undefined when no completed sessions', () => {
    const sessions: ImportSession[] = [
      {
        id: 1,
        accountId: 1,
        status: 'started',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        startedAt: new Date('2024-01-01T00:00:00Z'),
        durationMs: undefined,
        transactionsImported: 10,
        transactionsSkipped: 0,
      },
    ];

    const result = findMostRecentCompletedSession(sessions);

    expect(result).toBeUndefined();
  });

  it('should return undefined when sessions array is empty', () => {
    const result = findMostRecentCompletedSession([]);

    expect(result).toBeUndefined();
  });
});

describe('subtractExcludedAmounts', () => {
  it('should subtract excluded amounts from balances', () => {
    const balances = {
      BTC: parseDecimal('1.5'),
      ETH: parseDecimal('10.0'),
      SCAM: parseDecimal('1000000'),
    };

    const excludedAmounts = {
      SCAM: parseDecimal('1000000'),
      ETH: parseDecimal('2.0'),
    };

    const result = subtractExcludedAmounts(balances, excludedAmounts);

    expect(result.BTC?.toFixed()).toBe('1.5');
    expect(result.ETH?.toFixed()).toBe('8');
    expect(result.SCAM).toBeUndefined();
  });

  it('should remove assets when balance becomes zero', () => {
    const balances = {
      BTC: parseDecimal('1.0'),
      SCAM: parseDecimal('100'),
    };

    const excludedAmounts = {
      SCAM: parseDecimal('100'),
    };

    const result = subtractExcludedAmounts(balances, excludedAmounts);

    expect(result.BTC?.toFixed()).toBe('1');
    expect(result.SCAM).toBeUndefined();
  });

  it('should remove assets when balance becomes negative', () => {
    const balances = {
      BTC: parseDecimal('1.0'),
      SCAM: parseDecimal('100'),
    };

    const excludedAmounts = {
      SCAM: parseDecimal('200'),
    };

    const result = subtractExcludedAmounts(balances, excludedAmounts);

    expect(result.BTC?.toFixed()).toBe('1');
    expect(result.SCAM).toBeUndefined();
  });

  it('should handle excluded amounts for assets not in balances', () => {
    const balances = {
      BTC: parseDecimal('1.0'),
    };

    const excludedAmounts = {
      SCAM: parseDecimal('1000000'),
    };

    const result = subtractExcludedAmounts(balances, excludedAmounts);

    expect(result.BTC?.toFixed()).toBe('1');
    expect(result.SCAM).toBeUndefined();
  });

  it('should not mutate the original balances', () => {
    const balances = {
      BTC: parseDecimal('1.5'),
      SCAM: parseDecimal('1000000'),
    };

    const excludedAmounts = {
      SCAM: parseDecimal('1000000'),
    };

    const original = { ...balances };
    subtractExcludedAmounts(balances, excludedAmounts);

    expect(balances.BTC.toFixed()).toBe(original.BTC.toFixed());
    expect(balances.SCAM.toFixed()).toBe(original.SCAM.toFixed());
  });

  it('should handle empty excluded amounts', () => {
    const balances = {
      BTC: parseDecimal('1.5'),
      ETH: parseDecimal('10.0'),
    };

    const result = subtractExcludedAmounts(balances, {});

    expect(result.BTC?.toFixed()).toBe('1.5');
    expect(result.ETH?.toFixed()).toBe('10');
  });
});

describe('sumExcludedInflowAmounts', () => {
  it('should sum inflow amounts from excluded transactions', () => {
    const transactions: UniversalTransactionData[] = [
      {
        id: 1,
        accountId: 1,
        externalId: 'tx1',
        datetime: '2024-01-01T00:00:00Z',
        timestamp: new Date('2024-01-01T00:00:00Z').getTime(),
        source: 'test',
        status: 'success',
        operation: { category: 'transfer', type: 'airdrop' },
        movements: {
          inflows: [
            { asset: 'SCAM1', grossAmount: parseDecimal('1000000') },
            { asset: 'SCAM2', grossAmount: parseDecimal('500000') },
          ],
        },
        fees: [],
        excludedFromAccounting: true,
      },
      {
        id: 2,
        accountId: 1,
        externalId: 'tx2',
        datetime: '2024-01-02T00:00:00Z',
        timestamp: new Date('2024-01-02T00:00:00Z').getTime(),
        source: 'test',
        status: 'success',
        operation: { category: 'transfer', type: 'airdrop' },
        movements: {
          inflows: [{ asset: 'SCAM1', grossAmount: parseDecimal('2000000') }],
        },
        fees: [],
        excludedFromAccounting: true,
      },
      {
        id: 3,
        accountId: 1,
        externalId: 'tx3',
        datetime: '2024-01-03T00:00:00Z',
        timestamp: new Date('2024-01-03T00:00:00Z').getTime(),
        source: 'test',
        status: 'success',
        operation: { category: 'trade', type: 'buy' },
        movements: {
          inflows: [{ asset: 'BTC', grossAmount: parseDecimal('1.0') }],
        },
        fees: [],
        excludedFromAccounting: false,
      },
    ];

    const result = sumExcludedInflowAmounts(transactions);

    expect(result.SCAM1?.toFixed()).toBe('3000000');
    expect(result.SCAM2?.toFixed()).toBe('500000');
    expect(result.BTC).toBeUndefined();
  });

  it('should handle transactions with no inflows', () => {
    const transactions: UniversalTransactionData[] = [
      {
        id: 1,
        accountId: 1,
        externalId: 'tx1',
        datetime: '2024-01-01T00:00:00Z',
        timestamp: new Date('2024-01-01T00:00:00Z').getTime(),
        source: 'test',
        status: 'success',
        operation: { category: 'transfer', type: 'withdrawal' },
        movements: {
          outflows: [{ asset: 'BTC', grossAmount: parseDecimal('1.0') }],
        },
        fees: [],
        excludedFromAccounting: true,
      },
    ];

    const result = sumExcludedInflowAmounts(transactions);

    expect(Object.keys(result).length).toBe(0);
  });

  it('should handle empty transactions array', () => {
    const result = sumExcludedInflowAmounts([]);

    expect(Object.keys(result).length).toBe(0);
  });

  it('should only sum excluded transactions', () => {
    const transactions: UniversalTransactionData[] = [
      {
        id: 1,
        accountId: 1,
        externalId: 'tx1',
        datetime: '2024-01-01T00:00:00Z',
        timestamp: new Date('2024-01-01T00:00:00Z').getTime(),
        source: 'test',
        status: 'success',
        operation: { category: 'transfer', type: 'airdrop' },
        movements: {
          inflows: [{ asset: 'SCAM', grossAmount: parseDecimal('1000000') }],
        },
        fees: [],
        excludedFromAccounting: true,
      },
      {
        id: 2,
        accountId: 1,
        externalId: 'tx2',
        datetime: '2024-01-02T00:00:00Z',
        timestamp: new Date('2024-01-02T00:00:00Z').getTime(),
        source: 'test',
        status: 'success',
        operation: { category: 'transfer', type: 'airdrop' },
        movements: {
          inflows: [{ asset: 'SCAM', grossAmount: parseDecimal('500000') }],
        },
        fees: [],
        excludedFromAccounting: false,
      },
    ];

    const result = sumExcludedInflowAmounts(transactions);

    expect(result.SCAM?.toFixed()).toBe('1000000');
  });

  it('should handle transactions with undefined inflows', () => {
    const transactions: UniversalTransactionData[] = [
      {
        id: 1,
        accountId: 1,
        externalId: 'tx1',
        datetime: '2024-01-01T00:00:00Z',
        timestamp: new Date('2024-01-01T00:00:00Z').getTime(),
        source: 'test',
        status: 'success',
        operation: { category: 'transfer', type: 'withdrawal' },
        movements: {},
        fees: [],
        excludedFromAccounting: true,
      },
    ];

    const result = sumExcludedInflowAmounts(transactions);

    expect(Object.keys(result).length).toBe(0);
  });
});
