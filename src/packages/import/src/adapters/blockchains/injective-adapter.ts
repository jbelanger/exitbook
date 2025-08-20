// Network configuration is now handled by the registry system
import type {
  Balance,
  BlockchainInfo,
  BlockchainTransaction
} from '../../core/types/index';
import { BaseBlockchainAdapter } from './base-blockchain-adapter';
import { BlockchainProviderManager } from '../../providers/shared/BlockchainProviderManager';

import '../../providers/injective/InjectiveLCDProvider.js';
import '../../providers/injective/InjectiveExplorerProvider.js';

export class InjectiveAdapter extends BaseBlockchainAdapter {
  private providerManager: BlockchainProviderManager;

  constructor() {
    super('injective', 'InjectiveAdapter');

    this.providerManager = new BlockchainProviderManager();
    this.providerManager.autoRegisterFromConfig('injective', 'mainnet');

    this.logger.info('Initialized Injective adapter with registry-based provider manager', {
      providersCount: this.providerManager.getProviders('injective').length
    });
  }


  validateAddress(address: string): boolean {
    // Injective addresses start with 'inj' and are bech32 encoded
    const injectiveAddressRegex = /^inj1[a-z0-9]{38}$/;
    return injectiveAddressRegex.test(address);
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test connection through provider manager
      const healthStatus = this.providerManager.getProviderHealth('injective');
      const hasHealthyProvider = Array.from(healthStatus.values()).some(health =>
        health.isHealthy && health.circuitState !== 'OPEN'
      );

      this.logger.info('Injective provider connection test result', {
        hasHealthyProvider,
        totalProviders: healthStatus.size
      });

      return hasHealthyProvider;
    } catch (error) {
      this.logger.error('Injective connection test failed', { error });
      return false;
    }
  }


  async getBlockchainInfo(): Promise<BlockchainInfo> {
    return {
      id: 'injective',
      name: 'Injective Protocol Blockchain',
      network: 'mainnet',
      capabilities: {
        supportsAddressTransactions: true,
        supportsTokenTransactions: true,
        supportsBalanceQueries: true,
        supportsHistoricalData: true,
        supportsPagination: true,
        maxLookbackDays: undefined
      }
    };
  }

  async getAddressTransactions(address: string, since?: number): Promise<BlockchainTransaction[]> {
    if (!this.validateAddress(address)) {
      throw new Error(`Invalid Injective address: ${address}`);
    }

    this.logger.info(`InjectiveAdapter: Fetching transactions for address: ${address.substring(0, 20)}...`);

    try {
      // Fetch regular INJ transactions
      const regularTxs = await this.providerManager.executeWithFailover('injective', {
        type: 'getAddressTransactions',
        params: { address, since },
        getCacheKey: (params: any) => `inj_tx_${params.address}_${params.since || 'all'}`
      }) as BlockchainTransaction[];

      // Try to fetch token transactions (if provider supports it)
      // Note: In Injective, tokens are represented as different denoms, not separate contracts
      let tokenTxs: BlockchainTransaction[] = [];
      try {
        tokenTxs = await this.providerManager.executeWithFailover('injective', {
          type: 'getTokenTransactions',
          params: { address, since },
          getCacheKey: (params: any) => `inj_token_tx_${params.address}_${params.since || 'all'}`
        }) as BlockchainTransaction[];
      } catch (error) {
        this.logger.debug('Provider does not support separate token transactions or failed to fetch', {
          error: error instanceof Error ? error.message : String(error)
        });
        // Continue without separate token transactions - provider may already include them in getAddressTransactions
      }

      this.logger.info(`InjectiveAdapter transaction breakdown for ${address.substring(0, 20)}...`, {
        regular: regularTxs.length,
        token: tokenTxs.length,
        total: regularTxs.length + tokenTxs.length
      });

      // Combine all transactions (following the same pattern as other adapters)
      const allTransactions = [...regularTxs, ...tokenTxs];

      // Sort by timestamp (newest first)
      allTransactions.sort((a, b) => b.timestamp - a.timestamp);

      // Remove any duplicate transactions (by hash)
      const uniqueTransactions = allTransactions.reduce((acc, tx) => {
        if (!acc.find((existing: any) => existing.hash === tx.hash)) {
          acc.push(tx);
        }
        return acc;
      }, [] as BlockchainTransaction[]);

      this.logger.info(`InjectiveAdapter: Found ${uniqueTransactions.length} unique transactions for address ${address.substring(0, 20)}...`);
      return uniqueTransactions;

    } catch (error) {
      this.logger.error(`Failed to fetch transactions for ${address}`, { error });
      throw error;
    }
  }

  async getAddressBalance(address: string): Promise<Balance[]> {
    if (!this.validateAddress(address)) {
      throw new Error(`Invalid Injective address: ${address}`);
    }

    this.logger.info(`Getting balance for address: ${address.substring(0, 20)}...`);

    try {
      // Use provider manager to fetch balance with failover
      const balances = await this.providerManager.executeWithFailover('injective', {
        type: 'getAddressBalance',
        params: { address },
        getCacheKey: (params: any) => `inj_balance_${params.address}`
      }) as Balance[];

      return balances;

    } catch (error) {
      this.logger.error(`Failed to fetch balance for ${address}`, { error });
      throw error;
    }
  }

  async getTokenTransactions(address: string, tokenContract?: string): Promise<BlockchainTransaction[]> {
    // For Injective, tokens are represented as different denoms, not contracts
    // This method can be used to filter transactions by specific token denom
    const allTransactions = await this.getAddressTransactions(address);

    if (tokenContract) {
      return allTransactions.filter(tx =>
        tx.tokenContract === tokenContract ||
        tx.tokenSymbol === tokenContract
      );
    }

    return allTransactions;
  }

  async getTokenBalances(address: string): Promise<Balance[]> {
    // For Injective, all balances are returned by getAddressBalance
    return this.getAddressBalance(address);
  }



  /**
   * Close adapter and cleanup resources (required by IBlockchainAdapter)
   */
  async close(): Promise<void> {
    try {
      this.providerManager.destroy();
      this.logger.info('Injective adapter closed successfully');
    } catch (error) {
      this.logger.warn('Error during Injective adapter close', { error });
    }
  }
}