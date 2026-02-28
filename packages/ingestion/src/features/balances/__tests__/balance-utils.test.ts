import type {
  BlockchainProviderManager,
  FailoverExecutionResult,
  RawBalanceData,
} from '@exitbook/blockchain-providers';
import type { TokenMetadataQueries } from '@exitbook/data';
import type { BalanceSnapshot, IExchangeClient } from '@exitbook/exchange-providers';
import { Decimal } from 'decimal.js';
import { err, ok, okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import {
  convertBalancesToDecimals,
  fetchBlockchainBalance,
  fetchChildAccountsBalance,
  fetchExchangeBalance,
} from '../balance-utils.js';

// Helper to create mock TokenMetadataQueries
function createMockTokenMetadataQueries(): TokenMetadataQueries {
  return {
    getByContract: vi.fn().mockResolvedValue(ok(undefined)),
    save: vi.fn().mockResolvedValue(ok()),
    isStale: vi.fn().mockReturnValue(false),
    refreshInBackground: vi.fn(),
  } as unknown as TokenMetadataQueries;
}

describe('fetchExchangeBalance', () => {
  it('should fetch and return exchange balance successfully', async () => {
    const mockBalance: BalanceSnapshot = {
      balances: {
        BTC: '1.5',
        ETH: '10.25',
        USDT: '5000',
      },
      timestamp: 1234567890000,
    };

    const mockClient: IExchangeClient = {
      fetchBalance: vi.fn().mockResolvedValue(ok(mockBalance)),
      fetchTransactionDataStreaming: vi.fn(),
      exchangeId: 'kraken',
    };

    const result = await fetchExchangeBalance(mockClient, 'kraken');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        balances: {
          'exchange:kraken:btc': '1.5',
          'exchange:kraken:eth': '10.25',
          'exchange:kraken:usdt': '5000',
        },
        assetMetadata: {
          'exchange:kraken:btc': 'BTC',
          'exchange:kraken:eth': 'ETH',
          'exchange:kraken:usdt': 'USDT',
        },
        timestamp: 1234567890000,
        sourceType: 'exchange',
        sourceName: 'kraken',
      });
    }

    // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock assertion
    expect(mockClient.fetchBalance).toHaveBeenCalledTimes(1);
  });

  it('should return error when exchange client fails', async () => {
    const mockError = new Error('API connection failed');
    const mockClient: IExchangeClient = {
      fetchBalance: vi.fn().mockResolvedValue(err(mockError)),
      fetchTransactionDataStreaming: vi.fn(),
      exchangeId: 'kucoin',
    };

    const result = await fetchExchangeBalance(mockClient, 'kucoin');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('API connection failed');
    }
  });

  it('should handle exchange client throwing an error', async () => {
    const mockClient: IExchangeClient = {
      fetchBalance: vi.fn().mockRejectedValue(new Error('Network timeout')),
      fetchTransactionDataStreaming: vi.fn(),
      exchangeId: 'binance',
    };

    const result = await fetchExchangeBalance(mockClient, 'binance');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Network timeout');
    }
  });

  it('should handle empty balance response', async () => {
    const mockBalance: BalanceSnapshot = {
      balances: {},
      timestamp: Date.now(),
    };

    const mockClient: IExchangeClient = {
      fetchBalance: vi.fn().mockResolvedValue(ok(mockBalance)),
      fetchTransactionDataStreaming: vi.fn(),
      exchangeId: 'test-exchange',
    };

    const result = await fetchExchangeBalance(mockClient, 'test-exchange');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.balances).toEqual({});
      expect(result.value.sourceType).toBe('exchange');
    }
  });
});

describe('fetchBlockchainBalance', () => {
  it('should fetch and return blockchain balance successfully', async () => {
    const mockBalanceData: RawBalanceData = {
      rawAmount: '250000000',
      symbol: 'BTC',
      decimals: 8,
      decimalAmount: '2.5',
    };

    const mockProviderResult: FailoverExecutionResult<RawBalanceData> = {
      data: mockBalanceData,
      providerName: 'blockstream',
    };

    const mockProviderManager = {
      autoRegisterFromConfig: vi.fn(),
      destroy: vi.fn(),
      getAddressBalances: vi.fn().mockResolvedValue(ok(mockProviderResult)),
      getProviders: vi.fn().mockReturnValue([
        {
          capabilities: {
            supportedOperations: ['getAddressBalances'],
          },
        },
      ]),
    } as unknown as BlockchainProviderManager;

    const result = await fetchBlockchainBalance(
      mockProviderManager,
      createMockTokenMetadataQueries(),
      'bitcoin',
      'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.balances).toEqual({
        'blockchain:bitcoin:native': '2.5',
      });
      expect(result.value.sourceType).toBe('blockchain');
      expect(result.value.sourceName).toBe('bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
      expect(result.value.timestamp).toBeGreaterThan(0);
    }

    // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock assertion
    expect(mockProviderManager.getAddressBalances).toHaveBeenCalledWith(
      'bitcoin',
      'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
    );
  });

  it('should return error when provider manager fails', async () => {
    const mockError = new Error('Provider unavailable');

    const mockProviderManager = {
      autoRegisterFromConfig: vi.fn(),
      destroy: vi.fn(),
      getAddressBalances: vi.fn().mockResolvedValue(err(mockError)),
      getProviders: vi.fn().mockReturnValue([]),
    } as unknown as BlockchainProviderManager;

    const result = await fetchBlockchainBalance(
      mockProviderManager,
      createMockTokenMetadataQueries(),
      'ethereum',
      '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Provider unavailable');
    }
  });

  it('should handle provider manager throwing an error', async () => {
    const mockProviderManager = {
      autoRegisterFromConfig: vi.fn(),
      destroy: vi.fn(),
      getAddressBalances: vi.fn().mockRejectedValue(new Error('Network error')),
      getProviders: vi.fn().mockReturnValue([]),
    } as unknown as BlockchainProviderManager;

    const result = await fetchBlockchainBalance(
      mockProviderManager,
      createMockTokenMetadataQueries(),
      'solana',
      'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK'
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Network error');
    }
  });

  it('should handle different blockchain native assets', async () => {
    const mockBalanceData: RawBalanceData = {
      rawAmount: '15750000000000000000',
      symbol: 'ETH',
      decimals: 18,
      decimalAmount: '15.75',
    };

    const mockProviderResult: FailoverExecutionResult<RawBalanceData> = {
      data: mockBalanceData,
      providerName: 'alchemy',
    };

    const mockProviderManager = {
      autoRegisterFromConfig: vi.fn(),
      destroy: vi.fn(),
      getAddressBalances: vi.fn().mockResolvedValue(ok(mockProviderResult)),
      getProviders: vi.fn().mockReturnValue([
        {
          capabilities: {
            supportedOperations: ['getAddressBalances'],
          },
        },
      ]),
    } as unknown as BlockchainProviderManager;

    const result = await fetchBlockchainBalance(
      mockProviderManager,
      createMockTokenMetadataQueries(),
      'ethereum',
      '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.balances).toEqual({
        'blockchain:ethereum:native': '15.75',
      });
    }
  });

  it('should handle zero balance', async () => {
    const mockBalanceData: RawBalanceData = {
      rawAmount: '0',
      symbol: 'SOL',
      decimals: 9,
      decimalAmount: '0',
    };

    const mockProviderResult: FailoverExecutionResult<RawBalanceData> = {
      data: mockBalanceData,
      providerName: 'helius',
    };

    const mockProviderManager = {
      autoRegisterFromConfig: vi.fn(),
      destroy: vi.fn(),
      getAddressBalances: vi.fn().mockResolvedValue(ok(mockProviderResult)),
      getProviders: vi.fn().mockReturnValue([
        {
          capabilities: {
            supportedOperations: ['getAddressBalances'],
          },
        },
      ]),
    } as unknown as BlockchainProviderManager;

    const result = await fetchBlockchainBalance(
      mockProviderManager,
      createMockTokenMetadataQueries(),
      'solana',
      'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK'
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.balances).toEqual({
        'blockchain:solana:native': '0',
      });
    }
  });
});

describe('fetchChildAccountsBalance', () => {
  it('should return partial coverage metadata when child fetches fail', async () => {
    const mockProviderManager = {
      autoRegisterFromConfig: vi.fn(),
      destroy: vi.fn(),
      getAddressBalances: vi.fn().mockImplementation(async (_blockchain: string, address: string) => {
        if (address === 'bc1-child-success') {
          return okAsync({
            data: {
              rawAmount: '100000000',
              symbol: 'BTC',
              decimals: 8,
              decimalAmount: '1',
            },
            providerName: 'blockstream',
          });
        }

        return err(new Error('RPC timeout'));
      }),
      getProviders: vi.fn().mockReturnValue([
        {
          capabilities: {
            supportedOperations: ['getAddressBalances'],
          },
        },
      ]),
    } as unknown as BlockchainProviderManager;

    const result = await fetchChildAccountsBalance(
      mockProviderManager,
      createMockTokenMetadataQueries(),
      'bitcoin',
      'xpub-parent',
      [{ identifier: 'bc1-child-success' }, { identifier: 'bc1-child-fail' }]
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.balances).toEqual({
        'blockchain:bitcoin:native': '1',
      });
      expect(result.value.coverage).toEqual({
        requestedAddressCount: 2,
        successfulAddressCount: 1,
        failedAddressCount: 1,
      });
      expect(result.value.partialFailures).toEqual([
        expect.objectContaining({
          code: 'child-account-fetch-failed',
          scope: 'address',
          accountAddress: 'bc1-child-fail',
        }),
      ]);
    }
  });
});

describe('convertBalancesToDecimals', () => {
  it('should convert string balances to Decimal objects', () => {
    const balances = {
      BTC: '1.23456789',
      ETH: '10.5',
      USDT: '1000',
    };

    const result = convertBalancesToDecimals(balances);

    expect(result.balances['BTC']).toBeInstanceOf(Decimal);
    expect(result.balances['BTC']?.toString()).toBe('1.23456789');
    expect(result.balances['ETH']?.toString()).toBe('10.5');
    expect(result.balances['USDT']?.toString()).toBe('1000');
    expect(result.coverage).toEqual({
      totalAssetCount: 3,
      parsedAssetCount: 3,
      failedAssetCount: 0,
    });
    expect(result.partialFailures).toEqual([]);
  });

  it('should handle empty balances object', () => {
    const result = convertBalancesToDecimals({});

    expect(result.balances).toEqual({});
    expect(result.coverage).toEqual({
      totalAssetCount: 0,
      parsedAssetCount: 0,
      failedAssetCount: 0,
    });
    expect(result.partialFailures).toEqual([]);
  });

  it('should handle zero balances', () => {
    const balances = {
      BTC: '0',
      ETH: '0.0',
    };

    const result = convertBalancesToDecimals(balances);

    expect(result.balances['BTC']?.toString()).toBe('0');
    expect(result.balances['ETH']?.toString()).toBe('0');
  });

  it('should handle very small decimal values', () => {
    const balances = {
      BTC: '0.00000001',
    };

    const result = convertBalancesToDecimals(balances);

    expect(result.balances['BTC']?.toString()).toBe('1e-8');
  });

  it('should handle very large decimal values', () => {
    const balances = {
      SHIB: '1000000000000',
      WEI: '999999999999999999',
    };

    const result = convertBalancesToDecimals(balances);

    expect(result.balances['SHIB']?.toString()).toBe('1000000000000');
    expect(result.balances['WEI']?.toString()).toBe('999999999999999999');
  });

  it('should surface invalid decimal strings as parse failures by default', () => {
    const balances = {
      VALID: '100',
      INVALID: 'not-a-number',
      EMPTY: '',
    };

    const result = convertBalancesToDecimals(balances);

    expect(result.balances['VALID']?.toString()).toBe('100');
    expect(result.balances['INVALID']).toBeUndefined();
    expect(result.balances['EMPTY']).toBeUndefined();
    expect(result.coverage).toEqual({
      totalAssetCount: 3,
      parsedAssetCount: 1,
      failedAssetCount: 2,
    });
    expect(result.partialFailures).toEqual([
      expect.objectContaining({
        code: 'balance-parse-failed',
        scope: 'asset',
        assetId: 'INVALID',
        rawAmount: 'not-a-number',
      }),
      expect.objectContaining({
        code: 'balance-parse-failed',
        scope: 'asset',
        assetId: 'EMPTY',
        rawAmount: '',
      }),
    ]);
  });

  it('should handle negative balances', () => {
    const balances = {
      BTC: '-0.5',
      ETH: '-10',
    };

    const result = convertBalancesToDecimals(balances);

    expect(result.balances['BTC']?.toString()).toBe('-0.5');
    expect(result.balances['ETH']?.toString()).toBe('-10');
  });

  it('should handle scientific notation strings', () => {
    const balances = {
      MICRO: '1e-6',
      MEGA: '1e6',
    };

    const result = convertBalancesToDecimals(balances);

    expect(result.balances['MICRO']?.toString()).toBe('0.000001');
    expect(result.balances['MEGA']?.toString()).toBe('1000000');
  });

  it('should preserve precision for many decimal places', () => {
    const balances = {
      PRECISE: '1.123456789012345678901234567890',
    };

    const result = convertBalancesToDecimals(balances);

    expect(result.balances['PRECISE']?.toString()).toBe('1.12345678901234567890123456789');
  });
});
