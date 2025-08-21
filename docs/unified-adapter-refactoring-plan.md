# Unified Adapter Refactoring Plan

## Overview

This document outlines a detailed, phased implementation plan to refactor the current dual adapter system (separate `IExchangeAdapter` and `IBlockchainAdapter` interfaces) into a single, unified `IUniversalAdapter` interface. This will dramatically simplify the codebase by providing one consistent interface for all data sources.

## High-Level Goal

Refactor the separate `IExchangeAdapter` and `IBlockchainAdapter` interfaces into a single `IUniversalAdapter`. This will involve creating a new base adapter, bridge/wrapper classes for a phased migration, updating the factory and importer service, and then gradually refactoring each concrete adapter to the new standard.

## Current State

The codebase currently has:
- **Exchange Adapters**: Handle CEX platforms (KuCoin, Kraken, Coinbase) via CCXT, native APIs, or CSV files
- **Blockchain Adapters**: Handle direct blockchain data fetching (Bitcoin, Ethereum, Solana, etc.)

These have separate interfaces and require different handling in the import service.

## Benefits

1. **Massive Simplification**: One interface to learn and use instead of two
2. **Consistent Behavior**: All adapters work the same way
3. **Easy Testing**: Mock one interface for all tests
4. **Flexible Composition**: Mix and match adapters freely
5. **Future-Proof**: Easy to add new adapter types (DEX, L2, etc.)
6. **Reduced Coupling**: Services don't need to know adapter specifics

---

## Phase 1: Foundation - Creating the Universal Adapter Contracts

In this phase, we will define the new universal interfaces and the abstract base class. This is non-disruptive and can be done without altering any existing code.

### 1. Create a New Directory for Universal Adapters
- Create `packages/import/src/adapters/universal/`

### 2. Define the Universal Interfaces (`types.ts`)
Create `packages/import/src/adapters/universal/types.ts` with the following interfaces:

```typescript
import type { Money, TransactionStatus, TransactionType } from '@crypto/core';

export interface IUniversalAdapter {
  getInfo(): Promise<AdapterInfo>;
  testConnection(): Promise<boolean>;
  close(): Promise<void>;
  fetchTransactions(params: FetchParams): Promise<Transaction[]>;
  fetchBalances(params: FetchParams): Promise<Balance[]>;
}

export interface AdapterInfo {
  id: string;
  name: string;
  type: 'exchange' | 'blockchain';
  subType?: 'ccxt' | 'csv' | 'rpc' | 'rest';
  capabilities: AdapterCapabilities;
}

export interface AdapterCapabilities {
  supportedOperations: Array<
    | 'fetchTransactions' 
    | 'fetchBalances' 
    | 'getAddressTransactions'
    | 'getAddressBalance'
    | 'getTokenTransactions'
  >;
  maxBatchSize: number;
  supportsHistoricalData: boolean;
  supportsPagination: boolean;
  requiresApiKey: boolean;
  rateLimit?: {
    requestsPerSecond: number;
    burstLimit: number;
  };
}

export interface FetchParams {
  // Universal params
  addresses?: string[];        // For blockchains OR exchange accounts
  symbols?: string[];          // Filter by asset symbols
  since?: number;              // Time filter
  until?: number;              // Time filter
  
  // Optional type-specific params
  includeTokens?: boolean;     // For blockchains
  transactionTypes?: TransactionType[];
  
  // Pagination
  limit?: number;
  offset?: number;
}

export interface Transaction {
  // Universal fields
  id: string;
  timestamp: number;
  datetime: string;
  type: TransactionType;
  status: TransactionStatus;
  
  // Amounts
  amount: Money;
  fee?: Money;
  price?: Money;
  
  // Parties (works for both)
  from?: string;  // Sender address OR exchange account
  to?: string;    // Receiver address OR exchange account
  symbol?: string; // Add symbol for trades
  
  // Metadata
  source: string; // e.g., 'coinbase', 'bitcoin'
  network?: string; // e.g., 'mainnet'
  metadata: Record<string, any>;
}

export interface Balance {
  currency: string;
  total: number;
  free: number;
  used: number;
  contractAddress?: string;
}
```

### 3. Create the Base Adapter (`base-adapter.ts`)
Create `packages/import/src/adapters/universal/base-adapter.ts`:

```typescript
import { Logger, getLogger } from '@crypto/shared/logger';
import type { IUniversalAdapter, AdapterInfo, FetchParams, Transaction, Balance } from './types';
import type { AdapterConfig } from './config';

export abstract class BaseAdapter implements IUniversalAdapter {
  protected logger: Logger;
  
  constructor(protected readonly config: AdapterConfig) {
    this.logger = getLogger(this.constructor.name);
  }
  
  abstract getInfo(): Promise<AdapterInfo>;
  abstract testConnection(): Promise<boolean>;
  
  // Template method pattern
  async fetchTransactions(params: FetchParams): Promise<Transaction[]> {
    await this.validateParams(params);
    const rawData = await this.fetchRawTransactions(params);
    const transactions = await this.transformTransactions(rawData, params);
    const filtered = this.applyFilters(transactions, params);
    return this.sortTransactions(filtered);
  }
  
  async fetchBalances(params: FetchParams): Promise<Balance[]> {
    await this.validateParams(params);
    const rawBalances = await this.fetchRawBalances(params);
    return this.transformBalances(rawBalances, params);
  }
  
  // Abstract hooks for subclasses
  protected abstract fetchRawTransactions(params: FetchParams): Promise<any>;
  protected abstract fetchRawBalances(params: FetchParams): Promise<any>;
  protected abstract transformTransactions(raw: any, params: FetchParams): Promise<Transaction[]>;
  protected abstract transformBalances(raw: any, params: FetchParams): Promise<Balance[]>;
  
  // Common utilities
  protected async validateParams(params: FetchParams): Promise<void> {
    // Common validation logic
    if (params.since && params.until && params.since > params.until) {
      throw new Error('since cannot be greater than until');
    }
    
    // Validate operation support
    const info = await this.getInfo();
    if (params.addresses && !info.capabilities.supportedOperations.includes('getAddressTransactions')) {
      throw new Error(`${info.name} does not support address-based transaction fetching`);
    }
  }
  
  protected applyFilters(transactions: Transaction[], params: FetchParams): Transaction[] {
    let filtered = transactions;
    
    if (params.symbols?.length) {
      filtered = filtered.filter(tx => 
        params.symbols!.includes(tx.amount.currency) ||
        (tx.symbol && params.symbols!.includes(tx.symbol))
      );
    }
    
    if (params.transactionTypes?.length) {
      filtered = filtered.filter(tx => 
        params.transactionTypes!.includes(tx.type)
      );
    }
    
    return filtered;
  }
  
  protected sortTransactions(transactions: Transaction[]): Transaction[] {
    return transactions.sort((a, b) => b.timestamp - a.timestamp);
  }
  
  async close(): Promise<void> {
    // Default cleanup
  }
}
```

### 4. Define a Unified Configuration Type (`config.ts`)
Create `packages/import/src/adapters/universal/config.ts`:

```typescript
interface BaseAdapterConfig {
  type: 'exchange' | 'blockchain';
  id: string;
}

export interface ExchangeAdapterConfig extends BaseAdapterConfig {
  type: 'exchange';
  subType: 'ccxt' | 'csv';
  credentials?: { 
    apiKey: string; 
    secret: string; 
    password?: string; 
  };
  csvDirectories?: string[];
}

export interface BlockchainAdapterConfig extends BaseAdapterConfig {
  type: 'blockchain';
  subType: 'rest' | 'rpc';
  network: string;
}

export type AdapterConfig = ExchangeAdapterConfig | BlockchainAdapterConfig;
```

---

## Phase 2: Bridging - Connecting Old and New Worlds

This is the most critical phase for a smooth migration. We'll create "Bridge Adapters" that implement the new `IUniversalAdapter` interface but internally delegate calls to the old adapter implementations.

### 1. Create `ExchangeBridgeAdapter`
Create `packages/import/src/adapters/universal/exchange-bridge-adapter.ts`:

```typescript
import type { IExchangeAdapter, CryptoTransaction } from '@crypto/core';
import { BaseAdapter } from './base-adapter';
import type { AdapterInfo, FetchParams, Transaction, Balance } from './types';

export class ExchangeBridgeAdapter extends BaseAdapter {
  constructor(private oldAdapter: IExchangeAdapter, config: any) {
    super(config);
  }

  async getInfo(): Promise<AdapterInfo> {
    const info = await this.oldAdapter.getExchangeInfo();
    return {
      id: info.id,
      name: info.name,
      type: 'exchange',
      subType: 'ccxt', // or determine from adapter type
      capabilities: {
        supportedOperations: ['fetchTransactions', 'fetchBalances'],
        maxBatchSize: 100,
        supportsHistoricalData: true,
        supportsPagination: true,
        requiresApiKey: true,
        rateLimit: {
          requestsPerSecond: 10,
          burstLimit: 50
        }
      }
    };
  }

  async testConnection(): Promise<boolean> {
    return this.oldAdapter.testConnection();
  }

  protected async fetchRawTransactions(params: FetchParams): Promise<CryptoTransaction[]> {
    // Call old adapter methods based on params
    return this.oldAdapter.fetchAllTransactions(params.since);
  }
  
  protected async transformTransactions(rawTxs: CryptoTransaction[], params: FetchParams): Promise<Transaction[]> {
    // Map CryptoTransaction to universal Transaction format
    return rawTxs.map(tx => ({
      id: tx.id,
      timestamp: tx.timestamp,
      datetime: new Date(tx.timestamp).toISOString(),
      type: tx.type,
      status: tx.status,
      amount: tx.amount,
      fee: tx.fee,
      price: tx.price,
      from: tx.info?.from,
      to: tx.info?.to,
      symbol: tx.symbol,
      source: this.config.id,
      network: 'exchange',
      metadata: tx.info || {}
    }));
  }

  protected async fetchRawBalances(params: FetchParams): Promise<any> {
    // Call old adapter balance method if available
    throw new Error('Balance fetching not implemented for bridge adapter');
  }

  protected async transformBalances(raw: any, params: FetchParams): Promise<Balance[]> {
    throw new Error('Balance transformation not implemented for bridge adapter');
  }

  async close(): Promise<void> {
    return this.oldAdapter.close();
  }
}
```

### 2. Create `BlockchainBridgeAdapter`
Create `packages/import/src/adapters/universal/blockchain-bridge-adapter.ts`:

```typescript
import type { IBlockchainAdapter } from '@crypto/core';
import { BaseAdapter } from './base-adapter';
import type { AdapterInfo, FetchParams, Transaction, Balance } from './types';

export class BlockchainBridgeAdapter extends BaseAdapter {
  constructor(private oldAdapter: IBlockchainAdapter, config: any) {
    super(config);
  }

  async getInfo(): Promise<AdapterInfo> {
    return {
      id: this.config.id,
      name: `${this.config.id} Blockchain`,
      type: 'blockchain',
      subType: 'rest',
      capabilities: {
        supportedOperations: ['fetchTransactions', 'fetchBalances', 'getAddressTransactions', 'getAddressBalance'],
        maxBatchSize: 1,
        supportsHistoricalData: true,
        supportsPagination: false,
        requiresApiKey: false
      }
    };
  }

  async testConnection(): Promise<boolean> {
    return this.oldAdapter.testConnection();
  }

  protected async fetchRawTransactions(params: FetchParams): Promise<any[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for blockchain adapter');
    }
    
    const allTxs = [];
    for (const address of params.addresses) {
      const txs = await this.oldAdapter.getAddressTransactions(address, params.since);
      allTxs.push(...txs);
    }
    
    return allTxs;
  }
  
  protected async transformTransactions(rawTxs: any[], params: FetchParams): Promise<Transaction[]> {
    // Transform blockchain transactions to universal format
    return rawTxs.map(tx => ({
      id: tx.hash,
      timestamp: tx.timestamp,
      datetime: new Date(tx.timestamp * 1000).toISOString(),
      type: this.determineTransactionType(tx, params.addresses![0]),
      status: 'completed' as const,
      amount: tx.value,
      fee: tx.fee,
      from: tx.from,
      to: tx.to,
      source: this.config.id,
      network: this.config.network || 'mainnet',
      metadata: {
        blockNumber: tx.blockNumber,
        confirmations: tx.confirmations,
        gasUsed: tx.gasUsed
      }
    }));
  }

  protected async fetchRawBalances(params: FetchParams): Promise<any> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for blockchain balance fetching');
    }
    
    // Call old adapter balance methods
    const balances = [];
    for (const address of params.addresses) {
      const balance = await this.oldAdapter.getAddressBalance(address);
      balances.push({ address, ...balance });
    }
    
    return balances;
  }

  protected async transformBalances(rawBalances: any[], params: FetchParams): Promise<Balance[]> {
    return rawBalances.map(balance => ({
      currency: 'native', // or determine from blockchain
      total: balance.total,
      free: balance.total,
      used: 0
    }));
  }

  private determineTransactionType(tx: any, userAddress: string): any {
    // Logic to determine if transaction is send/receive based on user address
    return tx.from === userAddress ? 'send' : 'receive';
  }

  async close(): Promise<void> {
    return this.oldAdapter.close();
  }
}
```

---

## Phase 3: Integration - Switching the Core Logic

Now we update the high-level services to use the new universal system via the bridge adapters.

### 1. Create the `UniversalAdapterFactory`
Create `packages/import/src/adapters/universal/adapter-factory.ts`:

```typescript
import { ExchangeAdapterFactory } from '../../exchanges/adapter-factory';
import { BlockchainAdapterFactory } from '../../blockchains/shared/blockchain-adapter-factory';
import { ExchangeBridgeAdapter } from './exchange-bridge-adapter';
import { BlockchainBridgeAdapter } from './blockchain-bridge-adapter';
import type { IUniversalAdapter } from './types';
import type { AdapterConfig } from './config';

export class UniversalAdapterFactory {
  static async create(config: AdapterConfig, explorerConfig?: any): Promise<IUniversalAdapter> {
    if (config.type === 'exchange') {
      // Create old exchange adapter and wrap it
      const oldFactory = new ExchangeAdapterFactory();
      const oldAdapter = await oldFactory.createAdapterWithCredentials(
        config.id,
        config.subType,
        config.credentials,
        config.csvDirectories
      );
      return new ExchangeBridgeAdapter(oldAdapter, config);
    }
    
    if (config.type === 'blockchain') {
      // Create old blockchain adapter and wrap it
      const oldFactory = new BlockchainAdapterFactory();
      const oldAdapter = await oldFactory.createBlockchainAdapter(
        config.id, 
        explorerConfig
      );
      return new BlockchainBridgeAdapter(oldAdapter, config);
    }
    
    throw new Error(`Unsupported adapter type: ${config.type}`);
  }

  static async createMany(configs: AdapterConfig[], explorerConfig?: any): Promise<IUniversalAdapter[]> {
    return Promise.all(configs.map(config => this.create(config, explorerConfig)));
  }
}
```

### 2. Update `TransactionImporter` Service
Modify `packages/import/src/services/importer.ts` to use the universal interface:

```typescript
// Add new universal import method
async importFromAdapter(adapter: IUniversalAdapter, params: FetchParams): Promise<ImportResult> {
  const info = await adapter.getInfo();
  this.logger.info(`Starting import from ${info.name} (${info.type})`);

  try {
    // Test connection first
    const isConnected = await adapter.testConnection();
    if (!isConnected) {
      throw new Error(`Failed to connect to ${info.name}`);
    }

    // Fetch transactions using unified interface
    const transactions = await adapter.fetchTransactions(params);
    
    // Save transactions (existing logic)
    const saved = await this.saveTransactions(transactions);
    
    return {
      source: info.id,
      type: info.type,
      count: transactions.length,
      saved: saved,
      status: 'success'
    };
  } catch (error) {
    this.logger.error(`Import failed for ${info.name}: ${error}`);
    return {
      source: info.id,
      type: info.type,
      count: 0,
      saved: 0,
      status: 'error',
      error: error.message
    };
  } finally {
    await adapter.close();
  }
}

// Update existing methods to use universal factory
async importFromExchange(exchangeId: string, adapterType: string): Promise<ImportResult> {
  const config: ExchangeAdapterConfig = {
    type: 'exchange',
    id: exchangeId,
    subType: adapterType as 'ccxt' | 'csv',
    // ... other config
  };
  
  const adapter = await UniversalAdapterFactory.create(config);
  return this.importFromAdapter(adapter, {
    since: Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 days
  });
}

async importFromBlockchain(blockchain: string, addresses: string[]): Promise<ImportResult> {
  const config: BlockchainAdapterConfig = {
    type: 'blockchain',
    id: blockchain,
    subType: 'rest',
    network: 'mainnet'
  };
  
  const adapter = await UniversalAdapterFactory.create(config);
  return this.importFromAdapter(adapter, {
    addresses,
    since: Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 days
  });
}
```

---

## Phase 4: Refactoring - Migrating Concrete Adapters

With the system now running on the universal interface, we can refactor each adapter one by one without pressure.

### Plan for each adapter (example: `KrakenCSVAdapter`)

1. **Change Inheritance**: Modify `class KrakenCSVAdapter extends BaseCSVAdapter` to `class KrakenCSVAdapter extends BaseAdapter`
2. **Update Constructor**: Accept the new `AdapterConfig` and call `super(config)`
3. **Implement `getInfo`**: Return static `AdapterInfo`
4. **Implement `fetchRawTransactions`**: Move file reading/parsing logic here
5. **Implement `transformTransactions`**: Move mapping logic here
6. **Implement Balance Methods**: Implement or throw "Not Supported"
7. **Remove Old Code**: Delete overridden methods from old base classes

### Adapters to Refactor
- **CSV**: `KrakenCSVAdapter`, `KuCoinCSVAdapter`, `LedgerLiveCSVAdapter`
- **CCXT**: `CoinbaseCCXTAdapter`, `CCXTAdapter`
- **Blockchain**: `SolanaAdapter`, `BitcoinAdapter`, `EthereumAdapter`, etc.

---

## Phase 5: Finalization - Removing the Scaffolding

Once all adapters extend `BaseAdapter` directly, remove transitional code.

1. **Update `UniversalAdapterFactory`**: Instantiate refactored adapters directly
2. **Delete Bridge Adapters**: Remove bridge adapter files
3. **Delete Old Interfaces**: Remove `IExchangeAdapter`, `IBlockchainAdapter`
4. **Delete Old Base Classes**: Remove `BaseCSVAdapter`, `BaseCCXTAdapter`, etc.
5. **Delete Old Factories**: Remove original adapter factories
6. **Code Cleanup**: Remove all references to deleted files
7. **Review & Verify**: Test thoroughly with updated test suites

---

## Example Usage After Migration

```typescript
// Create adapters using unified factory
const adapters = [
  await UniversalAdapterFactory.create({ 
    type: 'exchange', 
    id: 'coinbase',
    subType: 'ccxt',
    credentials: { apiKey: 'xxx', secret: 'yyy' }
  }),
  await UniversalAdapterFactory.create({ 
    type: 'blockchain', 
    id: 'bitcoin',
    subType: 'rest',
    network: 'mainnet'
  }),
  await UniversalAdapterFactory.create({ 
    type: 'exchange', 
    id: 'kraken',
    subType: 'csv',
    csvDirectories: ['./data']
  })
];

// All use the same interface!
for (const adapter of adapters) {
  const transactions = await adapter.fetchTransactions({
    since: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days
    symbols: ['BTC', 'ETH']
  });
  
  console.log(`Found ${transactions.length} transactions`);
}
```

---

## Risk Mitigation

1. **Gradual Migration**: Implement new system alongside old one
2. **Bridge Pattern**: Delegate to existing implementations initially
3. **Comprehensive Testing**: Test each phase thoroughly before proceeding
4. **Backward Compatibility**: Maintain old interfaces during transition
5. **Rollback Plan**: Keep old implementations until migration is proven stable

## Timeline Estimate

- **Phase 1**: 1-2 days (Foundation)
- **Phase 2**: 1-2 days (Bridge adapters)
- **Phase 3**: 1-2 days (Service integration)
- **Phase 4**: 3-4 days (Adapter refactoring)
- **Phase 5**: 1 day (Cleanup)

**Total**: 7-11 days

## Success Criteria

- [ ] All existing functionality works through unified interface
- [ ] No breaking changes to external API
- [ ] Test coverage maintained or improved
- [ ] Performance remains comparable
- [ ] Code complexity significantly reduced
- [ ] Easy to add new adapter types

This phased approach ensures the system remains functional throughout the migration, minimizes risk, and allows the refactoring work to be done incrementally.