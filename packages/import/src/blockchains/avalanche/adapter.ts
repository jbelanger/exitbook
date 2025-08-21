import type {
  Balance,
  BlockchainInfo,
  BlockchainTransaction
} from '@crypto/core';

import './providers/SnowtraceProvider.ts';

import { BaseBlockchainAdapter } from '../shared/base-blockchain-adapter.ts';
import { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';
import type { BlockchainExplorersConfig } from '../shared/explorer-config.ts';

export class AvalancheAdapter extends BaseBlockchainAdapter {
  private providerManager: BlockchainProviderManager;

  constructor(explorerConfig: BlockchainExplorersConfig) {
    super('avalanche', 'AvalancheAdapter');

    this.providerManager = new BlockchainProviderManager(explorerConfig);
    this.providerManager.autoRegisterFromConfig('avalanche', 'mainnet');

    this.logger.debug(`Initialized Avalanche adapter with ${this.providerManager.getProviders('avalanche').length} providers`);
  }


  async getAddressTransactions(address: string, since?: number): Promise<BlockchainTransaction[]> {
    this.logger.info(`AvalancheAdapter: Fetching transactions for address: ${address.substring(0, 20)}...`);
    this.logger.debug(`AvalancheAdapter.getAddressTransactions called - Address: ${address}, Since: ${since}`);

    try {
      // Fetch regular AVAX transactions
      const regularTxs = await this.providerManager.executeWithFailover('avalanche', {
        type: 'getAddressTransactions',
        params: { address, since },
        getCacheKey: (params: any) => `avax_tx_${params.address}_${params.since || 'all'}`
      }) as BlockchainTransaction[];

      // Try to fetch ERC-20 token transactions (if provider supports it)
      let tokenTxs: BlockchainTransaction[] = [];
      try {
        tokenTxs = await this.providerManager.executeWithFailover('avalanche', {
          type: 'getTokenTransactions',
          params: { address, since },
          getCacheKey: (params: any) => `avax_token_tx_${params.address}_${params.since || 'all'}`
        }) as BlockchainTransaction[];
      } catch (error) {
        this.logger.debug(`Provider does not support separate token transactions or failed to fetch: ${error instanceof Error ? error.message : String(error)}`);
        // Continue without separate token transactions - provider may already include them in getAddressTransactions
      }

      this.logger.debug(`Transaction breakdown: ${regularTxs.length} regular, ${tokenTxs.length} token`);

      // Combine all transactions (following the same pattern as Ethereum/Solana)
      const allTransactions = [...regularTxs, ...tokenTxs];

      // Sort by timestamp (newest first)
      allTransactions.sort((a, b) => b.timestamp - a.timestamp);

      // Remove any duplicate transactions (by hash) - some providers may include tokens in regular transactions
      const uniqueTransactions = allTransactions.reduce((acc, tx) => {
        if (!acc.find(existing => existing.hash === tx.hash)) {
          acc.push(tx);
        }
        return acc;
      }, [] as BlockchainTransaction[]);

      this.logger.debug(`Found ${uniqueTransactions.length} unique transactions`);
      return uniqueTransactions;

    } catch (error) {
      this.logger.error(`Failed to fetch address transactions via provider manager - Address: ${address}, Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async getAddressBalance(address: string): Promise<Balance[]> {
    this.logger.debug(`AvalancheAdapter.getAddressBalance called - Address: ${address}`);

    try {
      // Use provider manager to fetch balance with failover
      const balances = await this.providerManager.executeWithFailover('avalanche', {
        type: 'getAddressBalance',
        params: { address },
        getCacheKey: (params: any) => `avax_balance_${params.address}`
      }) as Balance[];

      this.logger.info(`AvalancheAdapter: Found ${balances.length} balances for address`);
      return balances;

    } catch (error) {
      this.logger.error(`Failed to fetch address balance via provider manager - Address: ${address}, Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  validateAddress(address: string): boolean {
    // Avalanche C-Chain uses Ethereum-style addresses but they are case-sensitive
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    const isValid = ethAddressRegex.test(address);

    this.logger.debug(`Address validation - Address: ${address}, IsValid: ${isValid}`);
    return isValid;
  }

  async testConnection(): Promise<boolean> {
    this.logger.debug('AvalancheAdapter.testConnection called');

    try {
      // Test connection using provider manager
      const providers = this.providerManager.getProviders('avalanche');
      if (providers.length === 0) {
        this.logger.warn('No Avalanche providers available for connection test');
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

      this.logger.warn('All Avalanche providers failed connection test');
      return false;

    } catch (error) {
      this.logger.error(`Connection test failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async getBlockchainInfo(): Promise<BlockchainInfo> {
    return {
      id: 'avalanche',
      name: 'Avalanche C-Chain',
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

  async getTokenTransactions(address: string, tokenContract?: string): Promise<BlockchainTransaction[]> {
    this.logger.debug(`AvalancheAdapter.getTokenTransactions called - Address: ${address}, TokenContract: ${tokenContract}`);

    try {
      const transactions = await this.providerManager.executeWithFailover('avalanche', {
        type: 'getTokenTransactions',
        params: { address, contractAddress: tokenContract },
        getCacheKey: (params: any) => `avax_token_tx_${params.address}_${params.contractAddress || 'all'}`
      }) as BlockchainTransaction[];

      this.logger.info(`AvalancheAdapter: Found ${transactions.length} token transactions for address`);
      return transactions;

    } catch (error) {
      this.logger.error(`Failed to fetch token transactions via provider manager - Address: ${address}, TokenContract: ${tokenContract}, Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async getTokenBalances(address: string): Promise<Balance[]> {
    this.logger.debug(`AvalancheAdapter.getTokenBalances called - Address: ${address}`);

    try {
      const balances = await this.providerManager.executeWithFailover('avalanche', {
        type: 'getTokenBalances',
        params: { address },
        getCacheKey: (params: any) => `avax_token_balance_${params.address}`
      }) as Balance[];

      this.logger.info(`AvalancheAdapter: Found ${balances.length} token balances for address`);
      return balances;

    } catch (error) {
      this.logger.error(`Failed to fetch token balances via provider manager - Address: ${address}, Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Close adapter and cleanup resources (required by IBlockchainAdapter)
   */
  async close(): Promise<void> {
    try {
      this.providerManager.destroy();
      this.logger.info('Avalanche adapter closed successfully');
    } catch (error) {
      this.logger.warn(`Error during Avalanche adapter close - Error: ${error}`);
    }
  }
}