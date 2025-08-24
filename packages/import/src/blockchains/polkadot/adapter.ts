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

    this.logger.info(
      `Initialized Substrate adapter with registry-based provider manager - Chain: ${this.chainConfig.name}, DisplayName: ${this.chainConfig.displayName}, TokenSymbol: ${this.chainConfig.tokenSymbol}, SS58Format: ${this.chainConfig.ss58Format}, ProvidersCount: ${this.providerManager.getProviders('polkadot').length}`
    );
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

  protected async fetchRawBalances(params: UniversalFetchParams): Promise<Balance[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Substrate balance fetching');
    }

    const allBalances: Balance[] = [];

    for (const address of params.addresses) {
      this.logger.debug(
        `SubstrateAdapter.getAddressBalance called - Address: ${address}, Chain: ${this.chainConfig.name}`
      );

      try {
        const balances = (await this.providerManager.executeWithFailover('polkadot', {
          address: address,
          getCacheKey: cacheParams =>
            `${this.chainConfig.name}_balance_${cacheParams.type === 'getAddressBalance' ? cacheParams.address : 'unknown'}`,
          type: 'getAddressBalance',
        })) as Balance[];

        allBalances.push(...balances);
        this.logger.info(`SubstrateAdapter: Found ${balances.length} balances for ${this.chainConfig.name} address`);
      } catch (error) {
        this.logger.error(
          `Failed to fetch address balance via provider manager - Address: ${address}, Chain: ${this.chainConfig.name}, Error: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }
    }

    return allBalances;
  }

  protected async fetchRawTransactions(params: UniversalFetchParams): Promise<BlockchainTransaction[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Substrate adapter');
    }

    const allTransactions: BlockchainTransaction[] = [];

    for (const address of params.addresses) {
      this.logger.info(`SubstrateAdapter: Fetching transactions for address: ${address.substring(0, 20)}...`);
      this.logger.debug(
        `SubstrateAdapter.getAddressTransactions called - Address: ${address}, Since: ${params.since}, Chain: ${this.chainConfig.name}`
      );

      try {
        const transactions = (await this.providerManager.executeWithFailover('polkadot', {
          address: address,
          getCacheKey: cacheParams =>
            `${this.chainConfig.name}_tx_${cacheParams.type === 'getAddressTransactions' ? cacheParams.address : 'unknown'}_${cacheParams.type === 'getAddressTransactions' ? cacheParams.since || 'all' : 'unknown'}`,
          since: params.since,
          type: 'getAddressTransactions',
        })) as BlockchainTransaction[];

        allTransactions.push(...transactions);

        this.logger.info(
          `SubstrateAdapter: Found ${transactions.length} transactions for ${this.chainConfig.name} address`
        );
      } catch (error) {
        this.logger.error(
          `Failed to fetch address transactions via provider manager - Address: ${address}, Chain: ${this.chainConfig.name}, Error: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }
    }

    // Sort by timestamp (newest first)
    allTransactions.sort((a, b) => b.timestamp - a.timestamp);

    this.logger.info(`SubstrateAdapter: Found ${allTransactions.length} total transactions`);
    return allTransactions;
  }

  async getInfo(): Promise<UniversalAdapterInfo> {
    return {
      capabilities: {
        maxBatchSize: 1,
        rateLimit: {
          burstLimit: 10,
          requestsPerSecond: 3,
        },
        requiresApiKey: false,
        supportedOperations: ['fetchTransactions', 'fetchBalances'],
        supportsHistoricalData: true,
        supportsPagination: true,
      },
      id: this.chainConfig.name,
      name: this.chainConfig.displayName,
      subType: 'rest',
      type: 'blockchain',
    };
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
          this.logger.debug(
            `Provider ${provider.name} failed health check - Error: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      this.logger.warn(`All polkadot providers failed connection test`);
      return false;
    } catch (error) {
      this.logger.error(
        `Connection test failed - Chain: ${this.chainConfig.name}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
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
        amount: tx.value,
        datetime: new Date(tx.timestamp).toISOString(),
        fee: tx.fee,
        from: tx.from,
        id: tx.hash,
        metadata: {
          blockHash: tx.blockHash,
          blockNumber: tx.blockNumber,
          confirmations: tx.confirmations,
          originalTransaction: tx,
          tokenContract: tx.tokenContract,
          transactionType: tx.type,
        },
        network: this.chainConfig.name,
        source: this.chainConfig.name,
        status: tx.status === 'success' ? 'closed' : tx.status === 'pending' ? 'open' : 'canceled',
        symbol: tx.tokenSymbol || tx.value.currency,
        timestamp: tx.timestamp,
        to: tx.to,
        type,
      };
    });
  }
}
