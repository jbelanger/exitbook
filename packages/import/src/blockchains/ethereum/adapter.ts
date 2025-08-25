import type {
  Balance,
  BlockchainTransaction,
  TransactionType,
  UniversalAdapterInfo,
  UniversalBalance,
  UniversalBlockchainAdapterConfig,
  UniversalFetchParams,
  UniversalTransaction,
} from '@crypto/core';

import { BaseAdapter } from '../../shared/adapters/base-adapter.ts';
import { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';
import type { BlockchainExplorersConfig } from '../shared/explorer-config.ts';
import './clients/index.ts';
// Import clients to trigger registration
import { AlchemyProcessor } from './processors/AlchemyProcessor.ts';
import { MoralisProcessor } from './processors/MoralisProcessor.ts';
import { EthereumTransactionProcessor } from './transaction-processor.ts';
import type {
  AlchemyAssetTransfer,
  EtherscanBalance,
  MoralisNativeBalance,
  MoralisTokenBalance,
  MoralisTokenTransfer,
  MoralisTransaction,
} from './types.ts';

export class EthereumAdapter extends BaseAdapter {
  private providerManager: BlockchainProviderManager;

  constructor(config: UniversalBlockchainAdapterConfig, explorerConfig: BlockchainExplorersConfig) {
    super(config);

    this.providerManager = new BlockchainProviderManager(explorerConfig);
    this.providerManager.autoRegisterFromConfig('ethereum', 'mainnet');

    this.logger.info(
      `Initialized Ethereum adapter with registry-based provider manager - ProvidersCount: ${this.providerManager.getProviders('ethereum').length}`
    );
  }

  private processRawBalance(rawData: unknown, providerName: string): Balance[] {
    switch (providerName) {
      case 'alchemy':
        return AlchemyProcessor.processAddressBalance(rawData as EtherscanBalance[]);
      case 'moralis':
        return MoralisProcessor.processAddressBalance(rawData as MoralisNativeBalance);
      default:
        throw new Error(`Unsupported provider for balance processing: ${providerName}`);
    }
  }

  private processRawTokenBalances(rawData: unknown, providerName: string): Balance[] {
    switch (providerName) {
      case 'moralis':
        return MoralisProcessor.processTokenBalances(rawData as MoralisTokenBalance[]);
      default:
        this.logger.debug(`Provider ${providerName} does not support token balances or processing not implemented`);
        return [];
    }
  }

  private processRawTokenTransactions(
    rawData: unknown,
    providerName: string,
    userAddress: string
  ): BlockchainTransaction[] {
    switch (providerName) {
      case 'alchemy':
        return AlchemyProcessor.processTokenTransactions(rawData as AlchemyAssetTransfer[], userAddress);
      case 'moralis':
        return MoralisProcessor.processTokenTransactions(rawData as MoralisTokenTransfer[], userAddress);
      default:
        this.logger.debug(`Provider ${providerName} does not support token transactions or processing not implemented`);
        return [];
    }
  }

  private processRawTransactions(rawData: unknown, providerName: string, userAddress: string): BlockchainTransaction[] {
    switch (providerName) {
      case 'alchemy':
        return AlchemyProcessor.processAddressTransactions(rawData as AlchemyAssetTransfer[], userAddress);
      case 'moralis':
        return MoralisProcessor.processAddressTransactions(rawData as MoralisTransaction[], userAddress);
      default:
        throw new Error(`Unsupported provider for transaction processing: ${providerName}`);
    }
  }

  /**
   * Close adapter and cleanup resources
   */
  async close(): Promise<void> {
    try {
      this.providerManager.destroy();
      this.logger.info('Ethereum adapter closed successfully');
    } catch (error) {
      this.logger.warn(`Error during Ethereum adapter close - Error: ${error}`);
    }
  }

  protected async fetchRawBalances(params: UniversalFetchParams): Promise<Balance[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Ethereum balance fetching');
    }

    const allBalances: Balance[] = [];

    for (const address of params.addresses) {
      this.logger.info(`Getting balance for address: ${address.substring(0, 20)}...`);

      try {
        const failoverResult = await this.providerManager.executeWithFailover('ethereum', {
          address: address,
          getCacheKey: cacheParams =>
            `eth_balance_${cacheParams.type === 'getRawAddressBalance' ? cacheParams.address : 'unknown'}`,
          type: 'getRawAddressBalance',
        });

        const balances = this.processRawBalance(failoverResult.data, failoverResult.providerName);
        allBalances.push(...balances);

        // Get token balances
        try {
          const tokenFailoverResult = await this.providerManager.executeWithFailover('ethereum', {
            address: address,
            getCacheKey: cacheParams =>
              `eth_token_balance_${cacheParams.type === 'getRawTokenBalances' ? cacheParams.address : 'unknown'}`,
            type: 'getRawTokenBalances',
          });

          const tokenBalances = this.processRawTokenBalances(
            tokenFailoverResult.data,
            tokenFailoverResult.providerName
          );
          allBalances.push(...tokenBalances);
        } catch (error) {
          this.logger.debug(
            `Token balances not available or failed - Error: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      } catch (error) {
        this.logger.error(`Failed to fetch balance for ${address} - Error: ${error}`);
        throw error;
      }
    }

    return allBalances;
  }

  protected async fetchRawTransactions(params: UniversalFetchParams): Promise<BlockchainTransaction[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Ethereum adapter');
    }

    const allTransactions: BlockchainTransaction[] = [];

    for (const address of params.addresses) {
      this.logger.info(`EthereumAdapter: Fetching transactions for address: ${address.substring(0, 20)}...`);

      try {
        // Fetch regular ETH transactions
        const regularTxsFailoverResult = await this.providerManager.executeWithFailover('ethereum', {
          address: address,
          getCacheKey: cacheParams =>
            `eth_tx_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.address : 'unknown'}_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.since || 'all' : 'unknown'}`,
          since: params.since,
          type: 'getRawAddressTransactions',
        });

        const regularTxs = this.processRawTransactions(
          regularTxsFailoverResult.data,
          regularTxsFailoverResult.providerName,
          address
        );

        // Try to fetch ERC-20 token transactions (if provider supports it)
        let tokenTxs: BlockchainTransaction[] = [];
        try {
          const tokenTxsFailoverResult = await this.providerManager.executeWithFailover('ethereum', {
            address: address,
            getCacheKey: cacheParams =>
              `eth_token_tx_${cacheParams.type === 'getTokenTransactions' ? cacheParams.address : 'unknown'}_${cacheParams.type === 'getTokenTransactions' ? cacheParams.since || 'all' : 'unknown'}`,
            since: params.since,
            type: 'getTokenTransactions',
          });

          tokenTxs = this.processRawTokenTransactions(
            tokenTxsFailoverResult.data,
            tokenTxsFailoverResult.providerName,
            address
          );
        } catch (error) {
          this.logger.debug(
            `Provider does not support separate token transactions or failed to fetch - Error: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        allTransactions.push(...regularTxs, ...tokenTxs);

        this.logger.info(
          `EthereumAdapter transaction breakdown for ${address.substring(0, 20)}... - Regular: ${regularTxs.length}, Token: ${tokenTxs.length}`
        );
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

    this.logger.info(`EthereumAdapter: Found ${uniqueTransactions.length} unique transactions total`);
    return uniqueTransactions;
  }

  async getInfo(): Promise<UniversalAdapterInfo> {
    return {
      capabilities: {
        maxBatchSize: 1,
        rateLimit: {
          burstLimit: 20,
          requestsPerSecond: 5,
        },
        requiresApiKey: false,
        supportedOperations: ['fetchTransactions', 'fetchBalances', 'getAddressTransactions'],
        supportsHistoricalData: true,
        supportsPagination: true,
      },
      id: 'ethereum',
      name: 'Ethereum',
      subType: 'rest',
      type: 'blockchain',
    };
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
      const result = (await providers[0]?.testConnection()) || false;
      this.logger.debug(`Connection test result: ${result}`);
      return result;
    } catch (error) {
      this.logger.error(`Connection test failed - Error: ${error}`);
      return false;
    }
  }

  protected async transformBalances(rawBalances: Balance[], params: UniversalFetchParams): Promise<UniversalBalance[]> {
    return rawBalances.map(balance => ({
      contractAddress: balance.contractAddress,
      currency: balance.currency,
      free: balance.balance,
      total: balance.total,
      used: balance.used,
    }));
  }

  protected async transformTransactions(
    rawTxs: BlockchainTransaction[],
    params: UniversalFetchParams
  ): Promise<UniversalTransaction[]> {
    const userAddresses = params.addresses || [];
    return EthereumTransactionProcessor.processTransactions(rawTxs, userAddresses);
  }
}
