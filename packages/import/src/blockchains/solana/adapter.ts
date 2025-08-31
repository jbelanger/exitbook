import type {
  Balance,
  TransactionType,
  UniversalAdapterInfo,
  UniversalBalance,
  UniversalBlockchainAdapterConfig,
  UniversalFetchParams,
  UniversalTransaction,
} from '@crypto/core';
import type { BlockchainExplorersConfig } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';

import { BaseAdapter } from '../../shared/adapters/base-adapter.ts';
import { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';
import type { UniversalBlockchainTransaction } from '../shared/types.ts';
import type { SolanaRawTransactionData } from './clients/HeliusApiClient.ts';
import type { SolanaRPCRawTransactionData } from './clients/SolanaRPCApiClient.ts';
import type { SolscanRawTransactionData } from './clients/SolscanApiClient.ts';
// Import clients to trigger registration
import './clients/index.ts';
import { HeliusProcessor } from './processors/HeliusProcessor.ts';
import { SolanaRPCProcessor } from './processors/SolanaRPCProcessor.ts';
import { SolscanProcessor } from './processors/SolscanProcessor.ts';

export class SolanaAdapter extends BaseAdapter {
  private providerManager: BlockchainProviderManager;

  constructor(config: UniversalBlockchainAdapterConfig, explorerConfig: BlockchainExplorersConfig | null) {
    super(config);

    this.providerManager = new BlockchainProviderManager(explorerConfig);
    this.providerManager.autoRegisterFromConfig('solana', 'mainnet');

    this.logger.info(
      `Initialized Solana adapter with registry-based provider manager - ProvidersCount: ${this.providerManager.getProviders('solana').length}`
    );
  }

  private processRawTransactions(
    rawData: unknown,
    providerName: string,
    userAddress: string
  ): UniversalBlockchainTransaction[] {
    switch (providerName) {
      case 'helius':
        return HeliusProcessor.processAddressTransactions(rawData as SolanaRawTransactionData, userAddress);
      case 'solana-rpc':
        return SolanaRPCProcessor.processAddressTransactions(rawData as SolanaRPCRawTransactionData, userAddress);
      case 'solscan':
        return SolscanProcessor.processAddressTransactions(rawData as SolscanRawTransactionData, userAddress);
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
      this.logger.info('Solana adapter closed successfully');
    } catch (error) {
      this.logger.warn(`Error during Solana adapter close - Error: ${error}`);
    }
  }

  protected async fetchRawBalances(params: UniversalFetchParams): Promise<Balance[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Solana balance fetching');
    }

    const allBalances: Balance[] = [];

    for (const address of params.addresses) {
      this.logger.info(`Getting balance for address: ${address.substring(0, 20)}...`);

      try {
        const failoverResult = await this.providerManager.executeWithFailover('solana', {
          address: address,
          getCacheKey: cacheParams =>
            `sol_raw_balance_${cacheParams.type === 'getRawAddressBalance' ? cacheParams.address : 'unknown'}`,
          type: 'getRawAddressBalance',
        });
        const balances = failoverResult.data as Balance[];

        allBalances.push(...balances);
      } catch (error) {
        this.logger.error(
          `Failed to fetch balance for ${address.substring(0, 20)}... - Error: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }
    }

    return allBalances;
  }

  protected async fetchRawTransactions(params: UniversalFetchParams): Promise<UniversalBlockchainTransaction[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Solana adapter');
    }

    const allTransactions: UniversalBlockchainTransaction[] = [];

    for (const address of params.addresses) {
      this.logger.info(`Fetching transactions for address: ${address.substring(0, 20)}...`);

      try {
        // Use bridge pattern - fetch raw data and process with provider-specific processor
        const rawResult = await this.providerManager.executeWithFailover('solana', {
          address: address,
          getCacheKey: cacheParams =>
            `sol_raw_tx_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.address : 'unknown'}_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.since || 'all' : 'unknown'}`,
          since: params.since,
          type: 'getRawAddressTransactions',
        });

        const processed = this.processRawTransactions(rawResult.data, rawResult.providerName, address);
        allTransactions.push(...processed);

        this.logger.info(
          `Processed transactions for ${address.substring(0, 20)}... - Provider: ${rawResult.providerName}, Count: ${processed.length}`
        );
      } catch (error) {
        this.logger.error(
          `Failed to fetch transactions for ${address.substring(0, 20)}... - Error: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }
    }

    // Remove duplicates and sort by timestamp
    const uniqueTransactions = allTransactions.reduce((acc, tx) => {
      if (!acc.find(existing => existing.id === tx.id)) {
        acc.push(tx);
      }
      return acc;
    }, [] as UniversalBlockchainTransaction[]);

    uniqueTransactions.sort((a, b) => b.timestamp - a.timestamp);

    this.logger.info(`Found ${uniqueTransactions.length} unique transactions total`);
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
      id: 'solana',
      name: 'Solana',
      subType: 'rest',
      type: 'blockchain',
    };
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
      const result = (await providers[0]?.testConnection()) || false;
      this.logger.debug(`Connection test result: ${result}`);
      return result;
    } catch (error) {
      this.logger.error(`Connection test failed - Error: ${error instanceof Error ? error.message : String(error)}`);
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
    rawTxs: UniversalBlockchainTransaction[],
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
        } else if (isIncoming && isOutgoing) {
          // Self-transfer: determine type based on value change
          // Positive value = staking rewards, airdrops, etc. = deposit
          // Negative value = staking delegation, burns, etc. = withdrawal
          const amount = parseFloat(tx.amount);
          type = amount > 0 ? 'deposit' : amount < 0 ? 'withdrawal' : 'transfer';
        }
      }

      return {
        amount: {
          amount: new Decimal(tx.amount),
          currency: tx.currency,
        },
        datetime: new Date(tx.timestamp).toISOString(),
        fee: tx.feeAmount
          ? {
              amount: new Decimal(tx.feeAmount),
              currency: tx.feeCurrency || tx.currency,
            }
          : undefined,
        from: tx.from,
        id: tx.id,
        metadata: {
          blockHeight: tx.blockHeight,
          blockId: tx.blockId,
          originalTransaction: tx,
          tokenAddress: tx.tokenAddress,
          tokenSymbol: tx.tokenSymbol,
          transactionType: tx.type,
        },
        network: 'mainnet',
        source: 'solana',
        status: tx.status === 'success' ? 'closed' : tx.status === 'pending' ? 'open' : 'canceled',
        symbol: tx.tokenSymbol || tx.currency,
        timestamp: tx.timestamp,
        to: tx.to,
        type,
      };
    });
  }
}
