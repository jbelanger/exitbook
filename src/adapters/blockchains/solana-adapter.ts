// Network configuration is now handled by the registry system
import type {
  Balance,
  BlockchainInfo,
  BlockchainTransaction
} from '../../core/types/index';
import {
  isValidSolanaAddress
} from '../../core/types/solana';
import { BlockchainProviderManager } from '../../providers/shared/BlockchainProviderManager';
import { BaseBlockchainAdapter } from './base-blockchain-adapter';

import '../../providers/solana/HeliusProvider.js';
import '../../providers/solana/SolanaRPCProvider.js';
import '../../providers/solana/SolscanProvider.js';

export class SolanaAdapter extends BaseBlockchainAdapter {
  private providerManager: BlockchainProviderManager;

  constructor() {
    super('solana', 'SolanaAdapter');

    this.providerManager = new BlockchainProviderManager();
    this.providerManager.autoRegisterFromConfig('solana', 'mainnet');

    this.logger.info('Initialized Solana adapter with registry-based provider manager', {
      providersCount: this.providerManager.getProviders('solana').length
    });
  }

  async getAddressTransactions(address: string, since?: number): Promise<BlockchainTransaction[]> {
    this.logger.info(`SolanaAdapter: Fetching transactions for address: ${address.substring(0, 20)}...`);
    this.logger.debug('SolanaAdapter.getAddressTransactions called', { address, since });

    try {
      // Fetch regular SOL transactions
      const regularTxs = await this.providerManager.executeWithFailover('solana', {
        type: 'getAddressTransactions',
        params: { address, since },
        getCacheKey: (params) => `solana_tx_${params.address}_${params.since || 'all'}`
      }) as BlockchainTransaction[];

      // Try to fetch SPL token transactions (if provider supports it)
      let tokenTxs: BlockchainTransaction[] = [];
      try {
        tokenTxs = await this.providerManager.executeWithFailover('solana', {
          type: 'getTokenTransactions',
          params: { address, since },
          getCacheKey: (params) => `solana_token_tx_${params.address}_${params.since || 'all'}`
        }) as BlockchainTransaction[];
      } catch (error) {
        this.logger.debug('Provider does not support token transactions or failed to fetch', {
          error: error instanceof Error ? error.message : String(error)
        });
        // Continue without token transactions if provider doesn't support them
      }

      this.logger.info(`SolanaAdapter transaction breakdown for ${address.substring(0, 20)}...`, {
        regular: regularTxs.length,
        token: tokenTxs.length,
        total: regularTxs.length + tokenTxs.length
      });

      // Combine all transactions (following Ethereum pattern)
      const allTransactions = [...regularTxs, ...tokenTxs];

      // Sort by timestamp (newest first)
      allTransactions.sort((a, b) => b.timestamp - a.timestamp);

      // Remove any duplicate transactions (by hash)
      const uniqueTransactions = allTransactions.reduce((acc, tx) => {
        if (!acc.find(existing => existing.hash === tx.hash)) {
          acc.push(tx);
        }
        return acc;
      }, [] as BlockchainTransaction[]);

      this.logger.info(`SolanaAdapter: Found ${uniqueTransactions.length} unique transactions for address ${address.substring(0, 20)}...`);
      return uniqueTransactions;

    } catch (error) {
      this.logger.error(`Failed to fetch transactions for ${address}`, { error });
      throw error;
    }
  }

  async getAddressBalance(address: string): Promise<Balance[]> {
    this.logger.info(`Getting balance for address: ${address.substring(0, 20)}...`);

    try {
      // Use provider manager to fetch balance with failover
      const balances = await this.providerManager.executeWithFailover('solana', {
        type: 'getAddressBalance',
        params: { address },
        getCacheKey: (params) => `solana_balance_${params.address}`
      }) as Balance[];

      return balances;

    } catch (error) {
      this.logger.error(`Failed to fetch balance for ${address}`, { error });
      throw error;
    }
  }

  validateAddress(address: string): boolean {
    // Solana addresses are Base58 encoded, 32 bytes (44 characters)
    return isValidSolanaAddress(address);
  }

  async testConnection(): Promise<boolean> {
    this.logger.debug('SolanaAdapter.testConnection called');
    try {
      const providers = this.providerManager.getProviders('solana');
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
      this.logger.error('Connection test failed', { error });
      return false;
    }
  }

  async getBlockchainInfo(): Promise<BlockchainInfo> {
    return {
      id: 'solana',
      name: 'Solana',
      network: 'mainnet',
      capabilities: {
        supportsAddressTransactions: true,
        supportsTokenTransactions: true, // Solana supports SPL tokens
        supportsBalanceQueries: true,
        supportsHistoricalData: true,
        supportsPagination: true,
        maxLookbackDays: undefined
      }
    };
  }

  // Solana supports SPL token transactions
  async getTokenTransactions(address: string, tokenContract?: string): Promise<BlockchainTransaction[]> {
    this.logger.debug('SolanaAdapter.getTokenTransactions called', {
      address,
      tokenContract
    });

    try {
      // Use provider manager to fetch token transactions with failover
      const transactions = await this.providerManager.executeWithFailover('solana', {
        type: 'getTokenTransactions',
        params: { address, contractAddress: tokenContract },
        getCacheKey: (params) => `solana_token_tx_${params.address}_${params.contractAddress || 'all'}`
      }) as BlockchainTransaction[];

      this.logger.info(`SolanaAdapter: Found ${transactions.length} token transactions for address ${address.substring(0, 20)}...`);
      return transactions;

    } catch (error) {
      this.logger.error(`Failed to fetch token transactions for ${address}`, { error });
      throw error;
    }
  }

  async getTokenBalances(address: string): Promise<Balance[]> {
    this.logger.debug('SolanaAdapter.getTokenBalances called', {
      address
    });

    try {
      // Use provider manager to fetch token balances with failover
      const balances = await this.providerManager.executeWithFailover('solana', {
        type: 'getTokenBalances',
        params: { address },
        getCacheKey: (params) => `solana_token_balance_${params.address}`
      }) as Balance[];

      this.logger.info(`SolanaAdapter: Found ${balances.length} token balances for address ${address.substring(0, 20)}...`);
      return balances;

    } catch (error) {
      this.logger.error(`Failed to fetch token balances for ${address}`, { error });
      throw error;
    }
  }

  /**
   * Close adapter and cleanup resources (required by IBlockchainAdapter)
   */
  async close(): Promise<void> {
    try {
      this.providerManager.destroy();
      this.logger.info('Solana adapter closed successfully');
    } catch (error) {
      this.logger.warn('Error during Solana adapter close', { error });
    }
  }
}