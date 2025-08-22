import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';
import type { 
  IUniversalAdapter, 
  UniversalAdapterInfo, 
  UniversalFetchParams, 
  UniversalTransaction, 
  UniversalBalance,
  UniversalAdapterConfig 
} from '@crypto/core';
import { 
  validateUniversalTransactions, 
  validateUniversalBalances 
} from '@crypto/core';

export abstract class BaseAdapter implements IUniversalAdapter {
  protected logger: Logger;
  
  constructor(protected readonly config: UniversalAdapterConfig) {
    this.logger = getLogger(this.constructor.name);
  }
  
  abstract getInfo(): Promise<UniversalAdapterInfo>;
  abstract testConnection(): Promise<boolean>;
  
  // Template method pattern
  async fetchTransactions(params: UniversalFetchParams): Promise<UniversalTransaction[]> {
    await this.validateParams(params);
    const rawData = await this.fetchRawTransactions(params);
    const transactions = await this.transformTransactions(rawData, params);
    
    // NEW: Validate every transaction using Zod schemas
    const { valid, invalid } = validateUniversalTransactions(transactions);
    
    // Log validation errors but continue processing with valid transactions
    if (invalid.length > 0) {
      this.logger.error(
        `${invalid.length} invalid transactions from ${this.constructor.name}. ` +
        `Adapter: ${this.constructor.name}, Invalid: ${invalid.length}, Valid: ${valid.length}, Total: ${transactions.length}. ` +
        `Errors: ${invalid.map(({ errors }) => 
          errors.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
        ).join(' | ')}`
      );
    }
    
    this.logger.debug(`Validation completed: ${valid.length} valid, ${invalid.length} invalid transactions`);
    
    const filtered = this.applyFilters(valid, params);
    return this.sortTransactions(filtered);
  }
  
  async fetchBalances(params: UniversalFetchParams): Promise<UniversalBalance[]> {
    await this.validateParams(params);
    const rawBalances = await this.fetchRawBalances(params);
    const balances = await this.transformBalances(rawBalances, params);
    
    // NEW: Validate every balance using Zod schemas
    const { valid, invalid } = validateUniversalBalances(balances);
    
    // Log validation errors but continue processing with valid balances
    if (invalid.length > 0) {
      this.logger.error(
        `${invalid.length} invalid balances from ${this.constructor.name}. ` +
        `Adapter: ${this.constructor.name}, Invalid: ${invalid.length}, Valid: ${valid.length}, Total: ${balances.length}. ` +
        `Errors: ${invalid.map(({ errors }) => 
          errors.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
        ).join(' | ')}`
      );
    }
    
    this.logger.debug(`Balance validation completed: ${valid.length} valid, ${invalid.length} invalid balances`);
    
    return valid;
  }
  
  // Abstract hooks for subclasses
  protected abstract fetchRawTransactions(params: UniversalFetchParams): Promise<unknown>;
  protected abstract fetchRawBalances(params: UniversalFetchParams): Promise<unknown>;
  protected abstract transformTransactions(raw: unknown, params: UniversalFetchParams): Promise<UniversalTransaction[]>;
  protected abstract transformBalances(raw: unknown, params: UniversalFetchParams): Promise<UniversalBalance[]>;
  
  // Common utilities
  protected async validateParams(params: UniversalFetchParams): Promise<void> {
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
  
  protected applyFilters(transactions: UniversalTransaction[], params: UniversalFetchParams): UniversalTransaction[] {
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
  
  protected sortTransactions(transactions: UniversalTransaction[]): UniversalTransaction[] {
    return transactions.sort((a, b) => b.timestamp - a.timestamp);
  }
  
  async close(): Promise<void> {
    // Default cleanup
  }
}