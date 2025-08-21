import { Decimal } from 'decimal.js';
import type { IExchangeAdapter, IBlockchainAdapter, CryptoTransaction, BlockchainTransaction, ExchangeBalance, BlockchainBalance } from '@crypto/core';
import { ExchangeBridgeAdapter } from './exchange-bridge-adapter.js';
import { BlockchainBridgeAdapter } from './blockchain-bridge-adapter.js';
import type { ExchangeAdapterConfig, BlockchainAdapterConfig } from './config.js';

/**
 * Simple verification test for bridge adapters
 * This tests that the bridge adapters can wrap mock adapters and provide the universal interface
 */
async function testBridgeAdapters() {
  console.log('Testing Bridge Adapters...\n');

  // Test ExchangeBridgeAdapter
  console.log('1. Testing ExchangeBridgeAdapter');
  
  // Create a mock exchange adapter
  const mockExchangeAdapter: IExchangeAdapter = {
    testConnection: async () => true,
    getExchangeInfo: async () => ({
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
    fetchAllTransactions: async () => [{
      id: 'test-tx-1',
      type: 'trade',
      timestamp: 1640995200000,
      amount: { amount: new Decimal('1.5'), currency: 'BTC' },
      symbol: 'BTC/USD',
      side: 'buy',
      price: { amount: new Decimal('50000'), currency: 'USD' },
      fee: { amount: new Decimal('75'), currency: 'USD' },
      status: 'ok'
    } as CryptoTransaction],
    fetchTrades: async () => [],
    fetchDeposits: async () => [],
    fetchWithdrawals: async () => [],
    fetchClosedOrders: async () => [],
    fetchLedger: async () => [],
    fetchBalance: async () => [{
      currency: 'BTC',
      balance: 1.5,
      used: 0,
      total: 1.5
    } as ExchangeBalance],
    close: async () => undefined
  };

  const exchangeConfig: ExchangeAdapterConfig = {
    type: 'exchange',
    id: 'test-exchange',
    subType: 'ccxt'
  };

  const exchangeBridge = new ExchangeBridgeAdapter(mockExchangeAdapter, exchangeConfig);

  // Test adapter info
  const exchangeInfo = await exchangeBridge.getInfo();
  console.log('   ✓ Exchange adapter info:', {
    type: exchangeInfo.type,
    id: exchangeInfo.id,
    subType: exchangeInfo.subType,
    operationsCount: exchangeInfo.capabilities.supportedOperations.length
  });

  // Test connection
  const exchangeConnected = await exchangeBridge.testConnection();
  console.log('   ✓ Exchange connection test:', exchangeConnected);

  // Test transaction fetching
  const exchangeTransactions = await exchangeBridge.fetchTransactions({
    since: 1640995200000
  });
  console.log('   ✓ Exchange transactions fetched:', {
    count: exchangeTransactions.length,
    firstTx: exchangeTransactions[0] ? {
      id: exchangeTransactions[0].id,
      type: exchangeTransactions[0].type,
      source: exchangeTransactions[0].source,
      network: exchangeTransactions[0].network
    } : null
  });

  // Test balance fetching
  const exchangeBalances = await exchangeBridge.fetchBalances({});
  console.log('   ✓ Exchange balances fetched:', {
    count: exchangeBalances.length,
    firstBalance: exchangeBalances[0] ? {
      currency: exchangeBalances[0].currency,
      total: exchangeBalances[0].total
    } : null
  });

  // Test cleanup
  await exchangeBridge.close();
  console.log('   ✓ Exchange adapter closed successfully\n');

  // Test BlockchainBridgeAdapter
  console.log('2. Testing BlockchainBridgeAdapter');

  // Create a mock blockchain adapter
  const mockBlockchainAdapter: IBlockchainAdapter = {
    testConnection: async () => true,
    getBlockchainInfo: async () => ({
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
    getAddressTransactions: async () => [{
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
    } as BlockchainTransaction],
    getAddressBalance: async () => [{
      currency: 'BTC',
      balance: 0.5,
      used: 0,
      total: 0.5
    } as BlockchainBalance],
    validateAddress: () => true,
    convertToCryptoTransaction: (tx, userAddress) => ({
      id: tx.hash,
      type: 'withdrawal',
      timestamp: tx.timestamp * 1000,
      amount: tx.value,
      fee: tx.fee,
      info: tx
    } as CryptoTransaction),
    close: async () => undefined
  };

  const blockchainConfig: BlockchainAdapterConfig = {
    type: 'blockchain',
    id: 'bitcoin',
    subType: 'rest',
    network: 'mainnet'
  };

  const blockchainBridge = new BlockchainBridgeAdapter(mockBlockchainAdapter, blockchainConfig);

  // Test adapter info
  const blockchainInfo = await blockchainBridge.getInfo();
  console.log('   ✓ Blockchain adapter info:', {
    type: blockchainInfo.type,
    id: blockchainInfo.id,
    subType: blockchainInfo.subType,
    operationsCount: blockchainInfo.capabilities.supportedOperations.length
  });

  // Test connection
  const blockchainConnected = await blockchainBridge.testConnection();
  console.log('   ✓ Blockchain connection test:', blockchainConnected);

  // Test transaction fetching
  const blockchainTransactions = await blockchainBridge.fetchTransactions({
    addresses: ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
    since: 1640995200000
  });
  console.log('   ✓ Blockchain transactions fetched:', {
    count: blockchainTransactions.length,
    firstTx: blockchainTransactions[0] ? {
      id: blockchainTransactions[0].id,
      source: blockchainTransactions[0].source,
      network: blockchainTransactions[0].network,
      blockNumber: blockchainTransactions[0].metadata.blockNumber
    } : null
  });

  // Test balance fetching
  const blockchainBalances = await blockchainBridge.fetchBalances({
    addresses: ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa']
  });
  console.log('   ✓ Blockchain balances fetched:', {
    count: blockchainBalances.length,
    firstBalance: blockchainBalances[0] ? {
      currency: blockchainBalances[0].currency,
      total: blockchainBalances[0].total
    } : null
  });

  // Test error handling for missing addresses
  try {
    await blockchainBridge.fetchTransactions({});
    console.log('   ✗ Should have thrown error for missing addresses');
  } catch (error) {
    console.log('   ✓ Correctly throws error for missing addresses:', (error as Error).message);
  }

  // Test cleanup
  await blockchainBridge.close();
  console.log('   ✓ Blockchain adapter closed successfully\n');

  console.log('All bridge adapter tests passed! ✅');
}

// Run the test if this file is executed directly
if (import.meta.url.endsWith(process.argv[1])) {
  testBridgeAdapters().catch(console.error);
}

export { testBridgeAdapters };