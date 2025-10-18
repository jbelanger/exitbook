import type { BlockchainBalanceSnapshot } from '@exitbook/core';
import type { BalanceSnapshot, IExchangeClient } from '@exitbook/exchanges';
import type { BlockchainProviderManager, FailoverExecutionResult } from '@exitbook/providers';
import { Decimal } from 'decimal.js';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { convertBalancesToDecimals, fetchBlockchainBalance, fetchExchangeBalance } from './balance-utils.ts';

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
      fetchTransactionData: vi.fn(),
      exchangeId: 'kraken',
    };

    const result = await fetchExchangeBalance(mockClient, 'kraken');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        balances: {
          BTC: '1.5',
          ETH: '10.25',
          USDT: '5000',
        },
        timestamp: 1234567890000,
        sourceType: 'exchange',
        sourceId: 'kraken',
      });
    }
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock assertion
    expect(mockClient.fetchBalance).toHaveBeenCalledTimes(1);
  });

  it('should return error when exchange client fails', async () => {
    const mockError = new Error('API connection failed');
    const mockClient: IExchangeClient = {
      fetchBalance: vi.fn().mockResolvedValue(err(mockError)),
      fetchTransactionData: vi.fn(),
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
      fetchTransactionData: vi.fn(),
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
      fetchTransactionData: vi.fn(),
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
    const mockBalanceSnapshot: BlockchainBalanceSnapshot = {
      asset: 'BTC',
      total: '2.5',
    };

    const mockProviderResult: FailoverExecutionResult<BlockchainBalanceSnapshot> = {
      data: mockBalanceSnapshot,
      providerName: 'blockstream',
    };

    const mockProviderManager = {
      executeWithFailover: vi.fn().mockResolvedValue(ok(mockProviderResult)),
      destroy: vi.fn(),
    } as unknown as BlockchainProviderManager;

    const result = await fetchBlockchainBalance(
      mockProviderManager,
      'bitcoin',
      'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.balances).toEqual({
        BTC: '2.5',
      });
      expect(result.value.sourceType).toBe('blockchain');
      expect(result.value.sourceId).toBe('bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
      expect(result.value.timestamp).toBeGreaterThan(0);
    }

    // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock assertion
    expect(mockProviderManager.executeWithFailover).toHaveBeenCalledWith('bitcoin', {
      type: 'getAddressBalances',
      address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    });
  });

  it('should return error when provider manager fails', async () => {
    const mockError = new Error('Provider unavailable');

    const mockProviderManager = {
      executeWithFailover: vi.fn().mockResolvedValue(err(mockError)),
      destroy: vi.fn(),
    } as unknown as BlockchainProviderManager;

    const result = await fetchBlockchainBalance(
      mockProviderManager,
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
      executeWithFailover: vi.fn().mockRejectedValue(new Error('Network error')),
      destroy: vi.fn(),
    } as unknown as BlockchainProviderManager;

    const result = await fetchBlockchainBalance(
      mockProviderManager,
      'solana',
      'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK'
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Network error');
    }
  });

  it('should handle different blockchain native assets', async () => {
    const mockBalanceSnapshot: BlockchainBalanceSnapshot = {
      asset: 'ETH',
      total: '15.75',
    };

    const mockProviderResult: FailoverExecutionResult<BlockchainBalanceSnapshot> = {
      data: mockBalanceSnapshot,
      providerName: 'alchemy',
    };

    const mockProviderManager = {
      executeWithFailover: vi.fn().mockResolvedValue(ok(mockProviderResult)),
      destroy: vi.fn(),
    } as unknown as BlockchainProviderManager;

    const result = await fetchBlockchainBalance(
      mockProviderManager,
      'ethereum',
      '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.balances).toEqual({
        ETH: '15.75',
      });
    }
  });

  it('should handle zero balance', async () => {
    const mockBalanceSnapshot: BlockchainBalanceSnapshot = {
      asset: 'SOL',
      total: '0',
    };

    const mockProviderResult: FailoverExecutionResult<BlockchainBalanceSnapshot> = {
      data: mockBalanceSnapshot,
      providerName: 'helius',
    };

    const mockProviderManager = {
      executeWithFailover: vi.fn().mockResolvedValue(ok(mockProviderResult)),
      destroy: vi.fn(),
    } as unknown as BlockchainProviderManager;

    const result = await fetchBlockchainBalance(
      mockProviderManager,
      'solana',
      'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK'
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.balances).toEqual({
        SOL: '0',
      });
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

    expect(result.BTC).toBeInstanceOf(Decimal);
    expect(result.BTC?.toString()).toBe('1.23456789');
    expect(result.ETH?.toString()).toBe('10.5');
    expect(result.USDT?.toString()).toBe('1000');
  });

  it('should handle empty balances object', () => {
    const result = convertBalancesToDecimals({});

    expect(result).toEqual({});
  });

  it('should handle zero balances', () => {
    const balances = {
      BTC: '0',
      ETH: '0.0',
    };

    const result = convertBalancesToDecimals(balances);

    expect(result.BTC?.toString()).toBe('0');
    expect(result.ETH?.toString()).toBe('0');
  });

  it('should handle very small decimal values', () => {
    const balances = {
      BTC: '0.00000001',
    };

    const result = convertBalancesToDecimals(balances);

    expect(result.BTC?.toString()).toBe('1e-8');
  });

  it('should handle very large decimal values', () => {
    const balances = {
      SHIB: '1000000000000',
      WEI: '999999999999999999',
    };

    const result = convertBalancesToDecimals(balances);

    expect(result.SHIB?.toString()).toBe('1000000000000');
    expect(result.WEI?.toString()).toBe('999999999999999999');
  });

  it('should default to zero for invalid decimal strings', () => {
    const balances = {
      VALID: '100',
      INVALID: 'not-a-number',
      EMPTY: '',
    };

    const result = convertBalancesToDecimals(balances);

    expect(result.VALID?.toString()).toBe('100');
    expect(result.INVALID?.toString()).toBe('0');
    expect(result.EMPTY?.toString()).toBe('0');
  });

  it('should handle negative balances', () => {
    const balances = {
      BTC: '-0.5',
      ETH: '-10',
    };

    const result = convertBalancesToDecimals(balances);

    expect(result.BTC?.toString()).toBe('-0.5');
    expect(result.ETH?.toString()).toBe('-10');
  });

  it('should handle scientific notation strings', () => {
    const balances = {
      MICRO: '1e-6',
      MEGA: '1e6',
    };

    const result = convertBalancesToDecimals(balances);

    expect(result.MICRO?.toString()).toBe('0.000001');
    expect(result.MEGA?.toString()).toBe('1000000');
  });

  it('should preserve precision for many decimal places', () => {
    const balances = {
      PRECISE: '1.123456789012345678901234567890',
    };

    const result = convertBalancesToDecimals(balances);

    expect(result.PRECISE?.toString()).toBe('1.12345678901234567890123456789');
  });
});
