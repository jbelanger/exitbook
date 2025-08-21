

import type { Balance, BlockchainInfo, BlockchainTransaction } from '@crypto/core';

import { BaseBlockchainAdapter } from '../shared/base-blockchain-adapter.ts';
import { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';
import type { BlockchainExplorersConfig } from '../shared/explorer-config.ts';

export class EthereumAdapter extends BaseBlockchainAdapter {
  private providerManager: BlockchainProviderManager;

  constructor(explorerConfig: BlockchainExplorersConfig) {
    super('ethereum', 'EthereumAdapter');

    this.providerManager = new BlockchainProviderManager(explorerConfig);
    this.providerManager.autoRegisterFromConfig('ethereum', 'mainnet');

    this.logger.info(`Initialized Ethereum adapter with registry-based provider manager - ProvidersCount: ${this.providerManager.getProviders('ethereum').length}`);
  }

  async getAddressTransactions(address: string, since?: number): Promise<BlockchainTransaction[]> {
    this.logger.info(`EthereumAdapter: Fetching transactions for address: ${address.substring(0, 20)}...`);
    this.logger.debug(`EthereumAdapter.getAddressTransactions called - Address: ${address}, Since: ${since}`);

    try {
      // Fetch regular ETH transactions
      const regularTxs = await this.providerManager.executeWithFailover('ethereum', {
        type: 'getAddressTransactions',
        params: { address, since },
        getCacheKey: (params: any) => `eth_tx_${params.address}_${params.since || 'all'}`
      }) as BlockchainTransaction[];

      // Try to fetch ERC-20 token transactions (if provider supports it)
      let tokenTxs: BlockchainTransaction[] = [];
      try {
        tokenTxs = await this.providerManager.executeWithFailover('ethereum', {
          type: 'getTokenTransactions',
          params: { address, since },
          getCacheKey: (params: any) => `eth_token_tx_${params.address}_${params.since || 'all'}`
        }) as BlockchainTransaction[];
      } catch (error) {
        this.logger.debug(`Provider does not support separate token transactions or failed to fetch - Error: ${error instanceof Error ? error.message : String(error)}`);
        // Continue without separate token transactions - provider may already include them in getAddressTransactions
      }

      this.logger.info(`EthereumAdapter transaction breakdown for ${address.substring(0, 20)}... - Regular: ${regularTxs.length}, Token: ${tokenTxs.length}, Total: ${regularTxs.length + tokenTxs.length}`);

      // Combine all transactions (following the same pattern as Solana)
      const allTransactions = [...regularTxs, ...tokenTxs];

      // Sort by timestamp (newest first)
      allTransactions.sort((a, b) => b.timestamp - a.timestamp);

      // Remove any duplicate transactions (by hash) - some providers may include tokens in regular transactions
      const uniqueTransactions = allTransactions.reduce((acc, tx) => {
        if (!acc.find((existing: any) => existing.hash === tx.hash)) {
          acc.push(tx);
        }
        return acc;
      }, [] as BlockchainTransaction[]);

      this.logger.info(`EthereumAdapter: Found ${uniqueTransactions.length} unique transactions for address ${address.substring(0, 20)}...`);
      return uniqueTransactions;

    } catch (error) {
      this.logger.error(`Failed to fetch transactions for ${address} - Error: ${error}`);
      throw error;
    }
  }

  async getAddressBalance(address: string): Promise<Balance[]> {
    this.logger.info(`Getting balance for address: ${address.substring(0, 20)}...`);

    try {
      // Use provider manager to fetch balance with failover
      const balances = await this.providerManager.executeWithFailover('ethereum', {
        type: 'getAddressBalance',
        params: { address },
        getCacheKey: (params: any) => `eth_balance_${params.address}`
      }) as Balance[];

      return balances;

    } catch (error) {
      this.logger.error(`Failed to fetch balance for ${address} - Error: ${error}`);
      throw error;
    }
  }

  validateAddress(address: string): boolean {
    // Ethereum address pattern: 0x followed by 40 hex characters
    const ethereumPattern = /^0x[a-fA-F0-9]{40}$/;
    return ethereumPattern.test(address);
  }

  async testConnection(): Promise<boolean> {
    this.logger.debug('EthereumAdapter.testConnection called');
    try {
      const providers = this.providerManager.getProviders('ethereum');
      this.logger.debug(`Found ${providers.length} providers`);
      if (providers.length === 0) {
        this.logger.warn('No providers available for connection test');
        return false;
      }

      // Test the first provider
      const result = await providers[0]?.testConnection() || false;
      this.logger.debug(`Connection test result: ${result}`);
      return result;
    } catch (error) {
      this.logger.error(`Connection test failed - Error: ${error}`);
      return false;
    }
  }

  async getBlockchainInfo(): Promise<BlockchainInfo> {
    return {
      id: 'ethereum',
      name: 'Ethereum',
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

  /**
   * Close adapter and cleanup resources (required by IBlockchainAdapter)
   */
  async close(): Promise<void> {
    try {
      this.providerManager.destroy();
      this.logger.info('Ethereum adapter closed successfully');
    } catch (error) {
      this.logger.warn(`Error during Ethereum adapter close - Error: ${error}`);
    }
  }
}