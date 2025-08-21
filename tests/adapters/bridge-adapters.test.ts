import { describe, expect, test } from '@jest/globals';
import { Decimal } from 'decimal.js';
import type { IExchangeAdapter, IBlockchainAdapter, CryptoTransaction, BlockchainTransaction, ExchangeBalance, BlockchainBalance } from '@crypto/core';
import { ExchangeBridgeAdapter, BlockchainBridgeAdapter } from '../../packages/import/src/adapters/universal/index.js';
import type { ExchangeAdapterConfig, BlockchainAdapterConfig } from '../../packages/import/src/adapters/universal/index.js';

// Simple mock function implementation
const createMockFunction = (returnValue: any) => ({
  mockResolvedValue: (value: any) => ({ returnValue: Promise.resolve(value) }),
  mockReturnValue: (value: any) => ({ returnValue: value }),
  mockImplementation: (fn: any) => ({ implementation: fn }),
  mockRejectedValue: (error: any) => ({ returnValue: Promise.reject(error) })
});

describe('Bridge Adapters', () => {
  describe('ExchangeBridgeAdapter', () => {
    test('should wrap exchange adapter and provide universal interface', async () => {
      // Create a mock exchange adapter
      const mockExchangeAdapter: IExchangeAdapter = {
        testConnection: jest.fn().mockResolvedValue(true),
        getExchangeInfo: jest.fn().mockResolvedValue({
          id: 'test-exchange',
          name: 'Test Exchange',
          capabilities: {
            fetchMyTrades: true,
            fetchDeposits: true,
            fetchWithdrawals: true,
            fetchLedger: false,
            fetchClosedOrders: false,
            fetchBalance: true,
            fetchOrderBook: false,
            fetchTicker: false
          },
          rateLimit: 1000
        }),
        fetchAllTransactions: jest.fn().mockResolvedValue([
          {
            id: 'test-tx-1',
            type: 'trade',
            timestamp: 1640995200000,
            amount: { amount: new Decimal('1.5'), currency: 'BTC' },
            symbol: 'BTC/USD',
            side: 'buy',
            price: { amount: new Decimal('50000'), currency: 'USD' },
            fee: { amount: new Decimal('75'), currency: 'USD' },
            status: 'ok'
          } as CryptoTransaction
        ]),
        fetchTrades: jest.fn().mockResolvedValue([]),
        fetchDeposits: jest.fn().mockResolvedValue([]),
        fetchWithdrawals: jest.fn().mockResolvedValue([]),
        fetchClosedOrders: jest.fn().mockResolvedValue([]),
        fetchLedger: jest.fn().mockResolvedValue([]),
        fetchBalance: jest.fn().mockResolvedValue([
          {
            currency: 'BTC',
            balance: 1.5,
            used: 0,
            total: 1.5
          } as ExchangeBalance
        ]),
        close: jest.fn().mockResolvedValue(undefined)
      };

      const config: ExchangeAdapterConfig = {
        type: 'exchange',
        id: 'test-exchange',
        subType: 'ccxt'
      };

      const bridgeAdapter = new ExchangeBridgeAdapter(mockExchangeAdapter, config);

      // Test adapter info
      const info = await bridgeAdapter.getInfo();
      expect(info.type).toBe('exchange');
      expect(info.id).toBe('test-exchange');
      expect(info.subType).toBe('ccxt');
      expect(info.capabilities.supportedOperations).toContain('fetchTransactions');
      expect(info.capabilities.supportedOperations).toContain('fetchBalances');

      // Test connection
      const isConnected = await bridgeAdapter.testConnection();
      expect(isConnected).toBe(true);

      // Test transaction fetching
      const transactions = await bridgeAdapter.fetchTransactions({
        since: 1640995200000
      });
      expect(transactions).toHaveLength(1);
      expect(transactions[0].id).toBe('test-tx-1');
      expect(transactions[0].type).toBe('trade');
      expect(transactions[0].source).toBe('test-exchange');
      expect(transactions[0].network).toBe('exchange');

      // Test balance fetching
      const balances = await bridgeAdapter.fetchBalances({});
      expect(balances).toHaveLength(1);
      expect(balances[0].currency).toBe('BTC');
      expect(balances[0].total).toBe(1.5);

      // Test cleanup
      await bridgeAdapter.close();
    });
  });

  describe('BlockchainBridgeAdapter', () => {
    test('should wrap blockchain adapter and provide universal interface', async () => {
      // Create a mock blockchain adapter
      const mockBlockchainAdapter: IBlockchainAdapter = {
        testConnection: jest.fn().mockResolvedValue(true),
        getBlockchainInfo: jest.fn().mockResolvedValue({
          id: 'bitcoin',
          name: 'Bitcoin',
          network: 'mainnet',
          capabilities: {
            supportsAddressTransactions: true,
            supportsTokenTransactions: false,
            supportsBalanceQueries: true,
            supportsHistoricalData: true,
            supportsPagination: false
          }
        }),
        getAddressTransactions: jest.fn().mockResolvedValue([
          {
            hash: '0x123456789abcdef',
            blockNumber: 12345,
            blockHash: '0xblock123',
            timestamp: 1640995200,
            from: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
            to: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
            value: { amount: new Decimal('0.5'), currency: 'BTC' },
            fee: { amount: new Decimal('0.001'), currency: 'BTC' },
            gasUsed: 21000,
            gasPrice: 20,
            status: 'success',
            type: 'transfer',
            nonce: 1,
            confirmations: 6
          } as BlockchainTransaction
        ]),
        getAddressBalance: jest.fn().mockResolvedValue([
          {
            currency: 'BTC',
            balance: 0.5,
            used: 0,
            total: 0.5
          } as BlockchainBalance
        ]),
        validateAddress: jest.fn().mockReturnValue(true),
        convertToCryptoTransaction: jest.fn().mockImplementation((tx, userAddress) => ({
          id: tx.hash,
          type: 'withdrawal',
          timestamp: tx.timestamp * 1000,
          amount: tx.value,
          fee: tx.fee,
          info: tx
        } as CryptoTransaction)),
        close: jest.fn().mockResolvedValue(undefined)
      };

      const config: BlockchainAdapterConfig = {
        type: 'blockchain',
        id: 'bitcoin',
        subType: 'rest',
        network: 'mainnet'
      };

      const bridgeAdapter = new BlockchainBridgeAdapter(mockBlockchainAdapter, config);

      // Test adapter info
      const info = await bridgeAdapter.getInfo();
      expect(info.type).toBe('blockchain');
      expect(info.id).toBe('bitcoin');
      expect(info.subType).toBe('rest');
      expect(info.capabilities.supportedOperations).toContain('fetchTransactions');
      expect(info.capabilities.supportedOperations).toContain('getAddressTransactions');

      // Test connection
      const isConnected = await bridgeAdapter.testConnection();
      expect(isConnected).toBe(true);

      // Test transaction fetching
      const transactions = await bridgeAdapter.fetchTransactions({
        addresses: ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
        since: 1640995200000
      });
      expect(transactions).toHaveLength(1);
      expect(transactions[0].id).toBe('0x123456789abcdef');
      expect(transactions[0].source).toBe('bitcoin');
      expect(transactions[0].network).toBe('mainnet');
      expect(transactions[0].metadata.blockNumber).toBe(12345);

      // Test balance fetching
      const balances = await bridgeAdapter.fetchBalances({
        addresses: ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa']
      });
      expect(balances).toHaveLength(1);
      expect(balances[0].currency).toBe('BTC');
      expect(balances[0].total).toBe(0.5);

      // Test cleanup
      await bridgeAdapter.close();
    });

    test('should require addresses for blockchain operations', async () => {
      const mockBlockchainAdapter: IBlockchainAdapter = {
        testConnection: jest.fn().mockResolvedValue(true),
        getBlockchainInfo: jest.fn().mockResolvedValue({
          id: 'bitcoin',
          name: 'Bitcoin',
          network: 'mainnet',
          capabilities: {
            supportsAddressTransactions: true,
            supportsTokenTransactions: false,
            supportsBalanceQueries: true,
            supportsHistoricalData: true,
            supportsPagination: false
          }
        }),
        getAddressTransactions: jest.fn().mockResolvedValue([]),
        getAddressBalance: jest.fn().mockResolvedValue([]),
        validateAddress: jest.fn().mockReturnValue(true),
        convertToCryptoTransaction: jest.fn().mockReturnValue({} as CryptoTransaction),
        close: jest.fn().mockResolvedValue(undefined)
      };

      const config: BlockchainAdapterConfig = {
        type: 'blockchain',
        id: 'bitcoin',
        subType: 'rest',
        network: 'mainnet'
      };

      const bridgeAdapter = new BlockchainBridgeAdapter(mockBlockchainAdapter, config);

      // Should fail without addresses
      await expect(bridgeAdapter.fetchTransactions({})).rejects.toThrow('Addresses required');
      await expect(bridgeAdapter.fetchBalances({})).rejects.toThrow('Addresses required');
    });
  });
});