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

import { BaseAdapter } from '../../adapters/universal/base-adapter.ts';
import { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';
import type { BlockchainExplorersConfig } from '../shared/explorer-config.ts';
import { SUBSTRATE_CHAINS, type SubstrateChainConfig } from './types.ts';

export class SubstrateAdapter extends BaseAdapter {
  private chainConfig: SubstrateChainConfig;
  private providerManager: BlockchainProviderManager;

  constructor(config: UniversalBlockchainAdapterConfig, explorerConfig: BlockchainExplorersConfig) {
    super(config);

    // Always use Polkadot mainnet as default, but can be extended for other chains
    this.chainConfig = SUBSTRATE_CHAINS.polkadot!;

    // Create and initialize provider manager with registry
    this.providerManager = new BlockchainProviderManager(explorerConfig);
    this.providerManager.autoRegisterFromConfig('polkadot', 'mainnet');

    this.logger.info(`Initialized Substrate adapter with registry-based provider manager - Chain: ${this.chainConfig.name}, DisplayName: ${this.chainConfig.displayName}, TokenSymbol: ${this.chainConfig.tokenSymbol}, SS58Format: ${this.chainConfig.ss58Format}, ProvidersCount: ${this.providerManager.getProviders('polkadot').length}`);
  }

  async getInfo(): Promise<UniversalAdapterInfo> {
    return {
      id: this.chainConfig.name,
      name: this.chainConfig.displayName,
      type: 'blockchain',
      subType: 'rest',
      capabilities: {
        supportedOperations: ['fetchTransactions', 'fetchBalances', 'getAddressTransactions', 'getAddressBalance'],
        maxBatchSize: 1,
        supportsHistoricalData: true,
        supportsPagination: true,
        requiresApiKey: false,
        rateLimit: {
          requestsPerSecond: 3,
          burstLimit: 10
        }
      }
    };
  }

  protected async fetchRawTransactions(params: UniversalFetchParams): Promise<BlockchainTransaction[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Substrate adapter');
    }

    const allTransactions: BlockchainTransaction[] = [];
    
    for (const address of params.addresses) {
      this.logger.info(`SubstrateAdapter: Fetching transactions for address: ${address.substring(0, 20)}...`);
      this.logger.debug(`SubstrateAdapter.getAddressTransactions called - Address: ${address}, Since: ${params.since}, Chain: ${this.chainConfig.name}`);
      
      try {
        const transactions = await this.providerManager.executeWithFailover('polkadot', {
          type: 'getAddressTransactions',
          params: { address, since: params.since },
          getCacheKey: (cacheParams: any) => `${this.chainConfig.name}_tx_${cacheParams.address}_${cacheParams.since || 'all'}`
        }) as BlockchainTransaction[];

        allTransactions.push(...transactions);
        
        this.logger.info(`SubstrateAdapter: Found ${transactions.length} transactions for ${this.chainConfig.name} address`);
      } catch (error) {
        this.logger.error(`Failed to fetch address transactions via provider manager - Address: ${address}, Chain: ${this.chainConfig.name}, Error: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }

    // Sort by timestamp (newest first)
    allTransactions.sort((a, b) => b.timestamp - a.timestamp);
    
    this.logger.info(`SubstrateAdapter: Found ${allTransactions.length} total transactions`);
    return allTransactions;
  }

  protected async fetchRawBalances(params: UniversalFetchParams): Promise<Balance[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Substrate balance fetching');
    }

    const allBalances: Balance[] = [];
    
    for (const address of params.addresses) {
      this.logger.debug(`SubstrateAdapter.getAddressBalance called - Address: ${address}, Chain: ${this.chainConfig.name}`);
      
      try {
        const balances = await this.providerManager.executeWithFailover('polkadot', {
          type: 'getAddressBalance',
          params: { address },
          getCacheKey: (cacheParams: any) => `${this.chainConfig.name}_balance_${cacheParams.address}`
        }) as Balance[];

        allBalances.push(...balances);
        this.logger.info(`SubstrateAdapter: Found ${balances.length} balances for ${this.chainConfig.name} address`);
      } catch (error) {
        this.logger.error(`Failed to fetch address balance via provider manager - Address: ${address}, Chain: ${this.chainConfig.name}, Error: ${error instanceof Error ? error.message : String(error)}`);
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
        source: this.chainConfig.name,
        network: this.chainConfig.name,
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
    this.logger.debug(`SubstrateAdapter.testConnection called - Chain: ${this.chainConfig.name}`);

    try {
      // Test connection using provider manager
      const providers = this.providerManager.getProviders('polkadot');
      if (providers.length === 0) {
        this.logger.warn(`No polkadot providers available for connection test`);
        return false;
      }

      // Test the first healthy provider
      for (const provider of providers) {
        try {
          const isHealthy = await provider.isHealthy();
          if (isHealthy) {
            this.logger.info(`Connection test successful with provider: ${provider.name}`);
            return true;
          }
        } catch (error) {
          this.logger.debug(`Provider ${provider.name} failed health check - Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      this.logger.warn(`All polkadot providers failed connection test`);
      return false;

    } catch (error) {
      this.logger.error(`Connection test failed - Chain: ${this.chainConfig.name}, Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Close adapter and cleanup resources
   */
  async close(): Promise<void> {
    try {
      this.providerManager.destroy();
      this.logger.info(`${this.chainConfig.displayName} adapter closed successfully`);
    } catch (error) {
      this.logger.warn(`Error during ${this.chainConfig.displayName} adapter close - Error: ${error}`);
    }
  }

  // Legacy methods for compatibility (can be removed once migration is complete)
  validateAddress(address: string): boolean {
    // Basic SS58 address validation - could be enhanced with proper SS58 library
    const ss58Regex = /^[1-9A-HJ-NP-Za-km-z]{47,48}$/;
    const isValid = ss58Regex.test(address);

    this.logger.debug(`Address validation - Address: ${address}, IsValid: ${isValid}, Chain: ${this.chainConfig.name}, SS58Format: ${this.chainConfig.ss58Format}`);
    return isValid;
  }

  async getAddressTransactions(address: string, since?: number): Promise<BlockchainTransaction[]> {
    return this.fetchRawTransactions({ addresses: [address], since });
  }

  async getAddressBalance(address: string): Promise<Balance[]> {
    return this.fetchRawBalances({ addresses: [address] });
  }

  // Substrate chains don't typically have separate token transactions like EVM chains
  // They use native token transfers within extrinsics
  async getTokenTransactions(address: string, tokenContract?: string): Promise<BlockchainTransaction[]> {
    this.logger.debug(`SubstrateAdapter.getTokenTransactions called - Address: ${address}, TokenContract: ${tokenContract}, Chain: ${this.chainConfig.name}`);

    // For now, return regular transactions as Substrate chains primarily use native tokens
    // In the future, this could be extended to support parachains with custom tokens
    this.logger.info('Token transactions not implemented for Substrate chains - returning regular transactions');
    return this.getAddressTransactions(address);
  }

  async getTokenBalances(address: string): Promise<Balance[]> {
    this.logger.debug(`SubstrateAdapter.getTokenBalances called - Address: ${address}, Chain: ${this.chainConfig.name}`);

    // For now, return regular balance as Substrate chains primarily use native tokens
    this.logger.info('Token balances not implemented for Substrate chains - returning regular balance');
    return this.getAddressBalance(address);
  }

  // Required IBlockchainAdapter methods for backward compatibility
  async getBlockchainInfo(): Promise<any> {
    return {
      id: this.chainConfig.name,
      name: this.chainConfig.displayName,
      network: this.chainConfig.name,
      capabilities: {
        supportsAddressTransactions: true,
        supportsTokenTransactions: false, // Substrate native tokens only for now
        supportsBalanceQueries: true,
        supportsHistoricalData: true,
        supportsPagination: true,
        maxLookbackDays: undefined
      }
    };
  }

  convertToCryptoTransaction(blockchainTx: BlockchainTransaction, userAddress: string): any {
    // Determine transaction type based on user address
    let type: TransactionType = 'transfer';
    const normalizedUserAddress = userAddress.toLowerCase();
    const isIncoming = blockchainTx.to.toLowerCase() === normalizedUserAddress;
    const isOutgoing = blockchainTx.from.toLowerCase() === normalizedUserAddress;

    if (isIncoming && !isOutgoing) {
      type = 'deposit';
    } else if (isOutgoing && !isIncoming) {
      type = 'withdrawal';
    }

    return {
      id: blockchainTx.hash,
      type,
      timestamp: blockchainTx.timestamp,
      datetime: new Date(blockchainTx.timestamp).toISOString(),
      symbol: blockchainTx.tokenSymbol || blockchainTx.value.currency,
      side: undefined,
      amount: blockchainTx.value,
      price: undefined,
      fee: blockchainTx.fee,
      status: blockchainTx.status === 'success' ? 'closed' :
        blockchainTx.status === 'pending' ? 'open' : 'canceled',
      info: {
        blockNumber: blockchainTx.blockNumber,
        blockHash: blockchainTx.blockHash,
        from: blockchainTx.from,
        to: blockchainTx.to,
        confirmations: blockchainTx.confirmations,
        tokenContract: blockchainTx.tokenContract,
        transactionType: blockchainTx.type,
        originalTransaction: blockchainTx
      }
    };
  }
}