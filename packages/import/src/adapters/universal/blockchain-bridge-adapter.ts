import type { IBlockchainAdapter, BlockchainTransaction, BlockchainBalance } from '@crypto/core';
import { BaseAdapter } from './base-adapter.js';
import type { AdapterInfo, FetchParams, Transaction, Balance } from './types.js';
import type { BlockchainAdapterConfig } from './config.js';

/**
 * Bridge adapter that wraps existing IBlockchainAdapter implementations 
 * to provide the new IUniversalAdapter interface.
 * 
 * This enables a gradual migration by allowing the new unified interface
 * to work with existing blockchain adapter implementations without modification.
 */
export class BlockchainBridgeAdapter extends BaseAdapter {
  constructor(
    private readonly oldAdapter: IBlockchainAdapter,
    config: BlockchainAdapterConfig
  ) {
    super(config);
  }

  async getInfo(): Promise<AdapterInfo> {
    const blockchainInfo = await this.oldAdapter.getBlockchainInfo();
    
    return {
      id: blockchainInfo.id,
      name: blockchainInfo.name,
      type: 'blockchain',
      subType: this.config.subType,
      capabilities: {
        supportedOperations: [
          'fetchTransactions',
          'fetchBalances',
          'getAddressTransactions',
          'getAddressBalance',
          ...(blockchainInfo.capabilities.supportsTokenTransactions ? ['getTokenTransactions'] as const : []),
        ],
        maxBatchSize: 1,
        supportsHistoricalData: blockchainInfo.capabilities.supportsHistoricalData,
        supportsPagination: blockchainInfo.capabilities.supportsPagination,
        requiresApiKey: false,
        rateLimit: {
          requestsPerSecond: 5, // Conservative default for blockchain APIs
          burstLimit: 10
        }
      }
    };
  }

  async testConnection(): Promise<boolean> {
    return this.oldAdapter.testConnection();
  }

  protected async fetchRawTransactions(params: FetchParams): Promise<BlockchainTransaction[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for blockchain adapter');
    }
    
    const allTxs: BlockchainTransaction[] = [];
    
    // Fetch transactions for each address
    for (const address of params.addresses) {
      try {
        const txs = await this.oldAdapter.getAddressTransactions(address, params.since);
        allTxs.push(...txs);
      } catch (error) {
        this.logger.warn(`Failed to fetch transactions for address ${address}: ${error}`);
        // Continue with other addresses rather than failing completely
      }
    }
    
    // Fetch token transactions if supported and requested
    if (params.includeTokens && this.oldAdapter.getTokenTransactions) {
      for (const address of params.addresses) {
        try {
          const tokenTxs = await this.oldAdapter.getTokenTransactions(address);
          allTxs.push(...tokenTxs);
        } catch (error) {
          this.logger.warn(`Failed to fetch token transactions for address ${address}: ${error}`);
        }
      }
    }
    
    return allTxs;
  }
  
  protected async transformTransactions(rawTxs: BlockchainTransaction[], params: FetchParams): Promise<Transaction[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for blockchain transaction transformation');
    }
    
    const userAddresses = new Set(params.addresses.map(addr => addr.toLowerCase()));
    
    return rawTxs.map(tx => {
      // Convert blockchain transaction to universal format
      const cryptoTx = this.oldAdapter.convertToCryptoTransaction(tx, params.addresses![0]);
      
      return {
        id: tx.hash,
        timestamp: tx.timestamp * 1000, // Convert to milliseconds if needed
        datetime: new Date(tx.timestamp * 1000).toISOString(),
        type: cryptoTx.type,
        status: this.mapBlockchainStatus(tx.status),
        amount: tx.value,
        fee: tx.fee,
        price: cryptoTx.price,
        from: tx.from,
        to: tx.to,
        symbol: tx.tokenSymbol || cryptoTx.symbol,
        source: this.config.id,
        network: (this.config as BlockchainAdapterConfig).network || 'mainnet',
        metadata: {
          blockNumber: tx.blockNumber,
          blockHash: tx.blockHash,
          confirmations: tx.confirmations,
          gasUsed: tx.gasUsed,
          gasPrice: tx.gasPrice,
          nonce: tx.nonce,
          tokenContract: tx.tokenContract,
          blockchainType: tx.type,
          direction: this.determineDirection(tx, userAddresses),
          originalTransaction: tx
        }
      };
    });
  }

  protected async fetchRawBalances(params: FetchParams): Promise<BlockchainBalance[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for blockchain balance fetching');
    }
    
    const allBalances: BlockchainBalance[] = [];
    
    for (const address of params.addresses) {
      try {
        const balances = await this.oldAdapter.getAddressBalance(address);
        
        // Add address metadata to each balance
        const enrichedBalances = balances.map(balance => ({
          ...balance,
          address
        }));
        
        allBalances.push(...enrichedBalances);
        
        // Fetch token balances if supported and requested
        if (params.includeTokens && this.oldAdapter.getTokenBalances) {
          try {
            const tokenBalances = await this.oldAdapter.getTokenBalances(address);
            const enrichedTokenBalances = tokenBalances.map(balance => ({
              ...balance,
              address
            }));
            allBalances.push(...enrichedTokenBalances);
          } catch (error) {
            this.logger.warn(`Failed to fetch token balances for address ${address}: ${error}`);
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch balances for address ${address}: ${error}`);
      }
    }
    
    return allBalances;
  }

  protected async transformBalances(rawBalances: (BlockchainBalance & { address?: string })[], params: FetchParams): Promise<Balance[]> {
    return rawBalances.map(balance => ({
      currency: balance.currency,
      total: balance.total,
      free: balance.balance,
      used: balance.used,
      contractAddress: balance.contractAddress
    }));
  }

  private mapBlockchainStatus(status: 'success' | 'failed' | 'pending'): 'pending' | 'open' | 'closed' | 'canceled' | 'failed' | 'ok' {
    switch (status) {
      case 'success':
        return 'ok';
      case 'failed':
        return 'failed';
      case 'pending':
        return 'pending';
      default:
        return 'ok';
    }
  }

  private determineDirection(tx: BlockchainTransaction, userAddresses: Set<string>): 'in' | 'out' | 'self' {
    const fromLower = tx.from.toLowerCase();
    const toLower = tx.to.toLowerCase();
    
    const isFromUser = userAddresses.has(fromLower);
    const isToUser = userAddresses.has(toLower);
    
    if (isFromUser && isToUser) {
      return 'self';
    } else if (isFromUser) {
      return 'out';
    } else if (isToUser) {
      return 'in';
    } else {
      // This shouldn't happen for transactions fetched by address
      return 'out';
    }
  }

  async close(): Promise<void> {
    return this.oldAdapter.close();
  }
}