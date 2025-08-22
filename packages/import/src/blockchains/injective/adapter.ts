import type {
  Balance,
  BlockchainTransaction,
  TransactionType,
  UniversalAdapterInfo,
  UniversalBalance,
  UniversalBlockchainAdapterConfig,
  UniversalFetchParams,
  UniversalTransaction
} from '@crypto/core';

import { BaseAdapter } from '../../shared/adapters/base-adapter.ts';
import { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';
import type { BlockchainExplorersConfig } from '../shared/explorer-config.ts';

export class InjectiveAdapter extends BaseAdapter {
  private providerManager: BlockchainProviderManager;

  constructor(config: UniversalBlockchainAdapterConfig, explorerConfig: BlockchainExplorersConfig) {
    super(config);

    this.providerManager = new BlockchainProviderManager(explorerConfig);
    this.providerManager.autoRegisterFromConfig('injective', 'mainnet');

    this.logger.info(`Initialized Injective adapter with registry-based provider manager - ProvidersCount: ${this.providerManager.getProviders('injective').length}`);
  }

  async getInfo(): Promise<UniversalAdapterInfo> {
    return {
      id: 'injective',
      name: 'Injective Protocol',
      type: 'blockchain',
      subType: 'rest',
      capabilities: {
        supportedOperations: ['fetchTransactions', 'fetchBalances'],
        maxBatchSize: 1,
        supportsHistoricalData: true,
        supportsPagination: true,
        requiresApiKey: false,
        rateLimit: {
          requestsPerSecond: 3,
          burstLimit: 15
        }
      }
    };
  }

  protected async fetchRawTransactions(params: UniversalFetchParams): Promise<BlockchainTransaction[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Injective adapter');
    }

    const allTransactions: BlockchainTransaction[] = [];
    
    for (const address of params.addresses) {
      // Basic Injective address validation - starts with 'inj' and is bech32 encoded
      if (!/^inj1[a-z0-9]{38}$/.test(address)) {
        throw new Error(`Invalid Injective address: ${address}`);
      }

      this.logger.info(`InjectiveAdapter: Fetching transactions for address: ${address.substring(0, 20)}...`);
      
      try {
        // Fetch regular INJ transactions
        const regularTxs = await this.providerManager.executeWithFailover('injective', {
          type: 'getAddressTransactions',
          params: { address, since: params.since },
          getCacheKey: (cacheParams: any) => `inj_tx_${cacheParams.address}_${cacheParams.since || 'all'}`
        }) as BlockchainTransaction[];

        // Try to fetch token transactions (if provider supports it)
        // Note: In Injective, tokens are represented as different denoms, not separate contracts
        let tokenTxs: BlockchainTransaction[] = [];
        try {
          tokenTxs = await this.providerManager.executeWithFailover('injective', {
            type: 'getTokenTransactions',
            params: { address, since: params.since },
            getCacheKey: (cacheParams: any) => `inj_token_tx_${cacheParams.address}_${cacheParams.since || 'all'}`
          }) as BlockchainTransaction[];
        } catch (error) {
          this.logger.debug(`Provider does not support separate token transactions or failed to fetch - Error: ${error instanceof Error ? error.message : String(error)}`);
          // Continue without separate token transactions - provider may already include them in getAddressTransactions
        }

        allTransactions.push(...regularTxs, ...tokenTxs);
        
        this.logger.info(`InjectiveAdapter transaction breakdown for ${address.substring(0, 20)}... - Regular: ${regularTxs.length}, Token: ${tokenTxs.length}`);
      } catch (error) {
        this.logger.error(`Failed to fetch transactions for ${address} - Error: ${error}`);
        throw error;
      }
    }

    // Remove duplicates and sort by timestamp
    const uniqueTransactions = allTransactions.reduce((acc, tx) => {
      if (!acc.find(existing => existing.hash === tx.hash)) {
        acc.push(tx);
      }
      return acc;
    }, [] as BlockchainTransaction[]);

    uniqueTransactions.sort((a, b) => b.timestamp - a.timestamp);
    
    this.logger.info(`InjectiveAdapter: Found ${uniqueTransactions.length} unique transactions total`);
    return uniqueTransactions;
  }

  protected async fetchRawBalances(params: UniversalFetchParams): Promise<Balance[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Injective balance fetching');
    }

    const allBalances: Balance[] = [];
    
    for (const address of params.addresses) {
      // Basic Injective address validation - starts with 'inj' and is bech32 encoded
      if (!/^inj1[a-z0-9]{38}$/.test(address)) {
        throw new Error(`Invalid Injective address: ${address}`);
      }

      this.logger.info(`Getting balance for address: ${address.substring(0, 20)}...`);
      
      try {
        const balances = await this.providerManager.executeWithFailover('injective', {
          type: 'getAddressBalance',
          params: { address },
          getCacheKey: (cacheParams: any) => `inj_balance_${cacheParams.address}`
        }) as Balance[];

        allBalances.push(...balances);
      } catch (error) {
        this.logger.error(`Failed to fetch balance for ${address} - Error: ${error}`);
        throw error;
      }
    }

    return allBalances;
  }

  protected async transformTransactions(rawTxs: BlockchainTransaction[], params: UniversalFetchParams): Promise<UniversalTransaction[]> {
    const userAddresses = params.addresses || [];
    
    return rawTxs.map(tx => {
      // Determine transaction type based on user addresses
      let type: TransactionType = 'transfer';
      
      if (userAddresses.length > 0) {
        const userAddress = userAddresses[0].toLowerCase();
        const isIncoming = tx.to.toLowerCase() === userAddress;
        const isOutgoing = tx.from.toLowerCase() === userAddress;
        
        if (isIncoming && !isOutgoing) {
          type = 'deposit';
        } else if (isOutgoing && !isIncoming) {
          type = 'withdrawal';
        }
      }

      return {
        id: tx.hash,
        timestamp: tx.timestamp,
        datetime: new Date(tx.timestamp).toISOString(),
        type,
        status: tx.status === 'success' ? 'closed' : 
               tx.status === 'pending' ? 'open' : 'canceled',
        amount: tx.value,
        fee: tx.fee,
        from: tx.from,
        to: tx.to,
        symbol: tx.tokenSymbol || tx.value.currency,
        source: 'injective',
        network: 'mainnet',
        metadata: {
          blockNumber: tx.blockNumber,
          blockHash: tx.blockHash,
          confirmations: tx.confirmations,
          tokenContract: tx.tokenContract,
          transactionType: tx.type,
          originalTransaction: tx
        }
      };
    });
  }

  protected async transformBalances(rawBalances: Balance[], params: UniversalFetchParams): Promise<UniversalBalance[]> {
    return rawBalances.map(balance => ({
      currency: balance.currency,
      total: balance.total,
      free: balance.balance,
      used: balance.used,
      contractAddress: balance.contractAddress
    }));
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test connection through provider manager
      const healthStatus = this.providerManager.getProviderHealth('injective');
      const hasHealthyProvider = Array.from(healthStatus.values()).some(health =>
        health.isHealthy && health.circuitState !== 'OPEN'
      );

      this.logger.info(`Injective provider connection test result - HasHealthyProvider: ${hasHealthyProvider}, TotalProviders: ${healthStatus.size}`);

      return hasHealthyProvider;
    } catch (error) {
      this.logger.error(`Injective connection test failed - Error: ${error}`);
      return false;
    }
  }

  /**
   * Close adapter and cleanup resources
   */
  async close(): Promise<void> {
    try {
      this.providerManager.destroy();
      this.logger.info('Injective adapter closed successfully');
    } catch (error) {
      this.logger.warn(`Error during Injective adapter close - Error: ${error}`);
    }
  }

}