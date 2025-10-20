/* eslint-disable unicorn/no-null -- acceptable for tests */
import { parseDecimal } from '@exitbook/core';
import type { ImportSession } from '@exitbook/data';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildBalanceParamsFromFlags,
  buildSourceParams,
  decimalRecordToStringRecord,
  getExchangeCredentialsFromEnv,
  parseImportParams,
  validateBalanceParams,
  type BalanceCommandOptions,
  type BalanceHandlerParams,
} from './balance-utils.ts';

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

  it('should return error when API key is missing', () => {
    process.env.KRAKEN_SECRET = 'env-secret';

    const result = getExchangeCredentialsFromEnv('kraken');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Missing KRAKEN_API_KEY or KRAKEN_SECRET in environment');
    }
  });

  it('should return error when API secret is missing', () => {
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

describe('buildSourceParams', () => {
  it('should build source params for exchange', () => {
    const session: ImportSession = {
      id: 123,
      source_id: 'kraken',
      source_type: 'exchange',
      status: 'completed',
      import_params: JSON.stringify({}),
      import_result_metadata: JSON.stringify({}),
      created_at: '2024-01-01T00:00:00Z',
      started_at: '2024-01-01T00:00:00Z',
      completed_at: '2024-01-01T01:00:00Z',
      updated_at: null,
      transactions_imported: 100,
      transactions_failed: 0,
      duration_ms: 60000,
      error_message: null,
      error_details: null,
      provider_id: null,
      last_balance_check_at: null,
      verification_metadata: null,
    };

    const result = buildSourceParams(session, 'exchange');

    expect(result).toEqual({ exchange: 'kraken' });
  });

  it('should build source params for blockchain with address', () => {
    const session: ImportSession = {
      id: 456,
      source_id: 'bitcoin',
      source_type: 'blockchain',
      status: 'completed',
      import_params: JSON.stringify({ address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' }),
      import_result_metadata: JSON.stringify({}),
      created_at: '2024-01-01T00:00:00Z',
      started_at: '2024-01-01T00:00:00Z',
      completed_at: '2024-01-01T01:00:00Z',
      updated_at: null,
      transactions_imported: 50,
      transactions_failed: 0,
      duration_ms: 45000,
      error_message: null,
      error_details: null,
      provider_id: 'blockstream',
      last_balance_check_at: null,
      verification_metadata: null,
    };

    const result = buildSourceParams(session, 'blockchain', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

    expect(result).toEqual({
      blockchain: 'bitcoin',
      address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    });
  });

  it('should use address from params when session import_params lacks it', () => {
    const session: ImportSession = {
      id: 789,
      source_id: 'ethereum',
      source_type: 'blockchain',
      status: 'completed',
      import_params: JSON.stringify({}),
      import_result_metadata: JSON.stringify({}),
      created_at: '2024-01-01T00:00:00Z',
      started_at: '2024-01-01T00:00:00Z',
      completed_at: '2024-01-01T01:00:00Z',
      updated_at: null,
      transactions_imported: 75,
      transactions_failed: 0,
      duration_ms: 90000,
      error_message: null,
      error_details: null,
      provider_id: 'alchemy',
      last_balance_check_at: null,
      verification_metadata: null,
    };

    const result = buildSourceParams(session, 'blockchain', '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb');

    expect(result).toEqual({
      blockchain: 'ethereum',
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    });
  });

  it('should use "unknown" when no address is available', () => {
    const session: ImportSession = {
      id: 101,
      source_id: 'solana',
      source_type: 'blockchain',
      status: 'completed',
      import_params: JSON.stringify({}),
      import_result_metadata: JSON.stringify({}),
      created_at: '2024-01-01T00:00:00Z',
      started_at: '2024-01-01T00:00:00Z',
      completed_at: '2024-01-01T01:00:00Z',
      updated_at: null,
      transactions_imported: 25,
      transactions_failed: 0,
      duration_ms: 30000,
      error_message: null,
      error_details: null,
      provider_id: 'helius',
      last_balance_check_at: null,
      verification_metadata: null,
    };

    const result = buildSourceParams(session, 'blockchain');

    expect(result).toEqual({
      blockchain: 'solana',
      address: 'unknown',
    });
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

describe('parseImportParams', () => {
  it('should parse JSON string to object', () => {
    const jsonString = JSON.stringify({ address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', since: '2024-01-01' });
    const result = parseImportParams(jsonString);

    expect(result).toEqual({
      address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      since: '2024-01-01',
    });
  });

  it('should return object as-is when already parsed', () => {
    const obj = { address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', until: '2024-12-31' };
    const result = parseImportParams(obj);

    expect(result).toEqual(obj);
  });

  it('should handle empty object string', () => {
    const jsonString = JSON.stringify({});
    const result = parseImportParams(jsonString);

    expect(result).toEqual({});
  });

  it('should handle complex nested objects', () => {
    const complex = {
      address: 'test-address',
      options: { limit: 100, offset: 0 },
      metadata: { source: 'api' },
    };
    const jsonString = JSON.stringify(complex);
    const result = parseImportParams(jsonString);

    expect(result).toEqual(complex);
  });
});
