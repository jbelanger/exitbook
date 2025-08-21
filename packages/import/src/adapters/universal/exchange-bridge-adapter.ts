import type { IExchangeAdapter, CryptoTransaction, ExchangeBalance } from '@crypto/core';
import { BaseAdapter } from './base-adapter.js';
import type { AdapterInfo, FetchParams, Transaction, Balance } from './types.js';
import type { ExchangeAdapterConfig } from './config.js';

/**
 * Bridge adapter that wraps existing IExchangeAdapter implementations 
 * to provide the new IUniversalAdapter interface.
 * 
 * This enables a gradual migration by allowing the new unified interface
 * to work with existing exchange adapter implementations without modification.
 */
export class ExchangeBridgeAdapter extends BaseAdapter {
  constructor(
    private readonly oldAdapter: IExchangeAdapter,
    config: ExchangeAdapterConfig
  ) {
    super(config);
  }

  async getInfo(): Promise<AdapterInfo> {
    const exchangeInfo = await this.oldAdapter.getExchangeInfo();
    
    return {
      id: exchangeInfo.id,
      name: exchangeInfo.name,
      type: 'exchange',
      subType: this.config.subType,
      capabilities: {
        supportedOperations: [
          'fetchTransactions',
          'fetchBalances'
        ],
        maxBatchSize: 100,
        supportsHistoricalData: true,
        supportsPagination: true,
        requiresApiKey: this.config.subType === 'ccxt',
        rateLimit: exchangeInfo.rateLimit ? {
          requestsPerSecond: Math.floor(1000 / exchangeInfo.rateLimit),
          burstLimit: 50
        } : undefined
      }
    };
  }

  async testConnection(): Promise<boolean> {
    return this.oldAdapter.testConnection();
  }

  protected async fetchRawTransactions(params: FetchParams): Promise<CryptoTransaction[]> {
    // Use the old adapter's fetchAllTransactions method
    return this.oldAdapter.fetchAllTransactions(params.since);
  }
  
  protected async transformTransactions(rawTxs: CryptoTransaction[], params: FetchParams): Promise<Transaction[]> {
    // Transform CryptoTransaction to universal Transaction format
    return rawTxs.map(tx => ({
      id: tx.id,
      timestamp: tx.timestamp,
      datetime: tx.datetime || new Date(tx.timestamp).toISOString(),
      type: tx.type,
      status: this.mapTransactionStatus(tx.status),
      amount: tx.amount,
      fee: tx.fee,
      price: tx.price,
      from: tx.info?.from,
      to: tx.info?.to,
      symbol: tx.symbol,
      source: this.config.id,
      network: 'exchange',
      metadata: {
        side: tx.side,
        originalInfo: tx.info || {},
        exchangeSpecific: {
          status: tx.status,
          type: tx.type
        }
      }
    }));
  }

  protected async fetchRawBalances(params: FetchParams): Promise<ExchangeBalance[]> {
    return this.oldAdapter.fetchBalance();
  }

  protected async transformBalances(rawBalances: ExchangeBalance[], params: FetchParams): Promise<Balance[]> {
    return rawBalances.map(balance => ({
      currency: balance.currency,
      total: balance.total,
      free: balance.balance,
      used: balance.used,
      // No contract address for exchange balances
    }));
  }

  private mapTransactionStatus(status?: string): 'pending' | 'open' | 'closed' | 'canceled' | 'failed' | 'ok' {
    switch (status) {
      case 'pending':
        return 'pending';
      case 'open':
        return 'open';
      case 'closed':
        return 'closed';
      case 'ok':
        return 'ok';
      case 'failed':
        return 'failed';
      case 'canceled':
        return 'canceled';
      default:
        return 'ok'; // Default to ok for unknown statuses
    }
  }

  async close(): Promise<void> {
    return this.oldAdapter.close();
  }
}