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