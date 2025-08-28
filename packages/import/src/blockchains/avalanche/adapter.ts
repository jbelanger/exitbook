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
import { Decimal } from 'decimal.js';

import { BaseAdapter } from '../../shared/adapters/base-adapter.ts';
import { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';
import type { BlockchainExplorersConfig } from '../shared/explorer-config.ts';
import './api/index.ts';
import type { SnowtraceRawData } from './processors/SnowtraceProcessor.ts';
import { SnowtraceProcessor } from './processors/SnowtraceProcessor.ts';
import type { SnowtraceTokenTransfer } from './types.ts';

export class AvalancheAdapter extends BaseAdapter {
  private providerManager: BlockchainProviderManager;

  constructor(config: UniversalBlockchainAdapterConfig, explorerConfig: BlockchainExplorersConfig) {
    super(config);

    this.providerManager = new BlockchainProviderManager(explorerConfig);
    this.providerManager.autoRegisterFromConfig('avalanche', 'mainnet');

    this.logger.info(
      `Initialized Avalanche adapter with registry-based provider manager - ProvidersCount: ${this.providerManager.getProviders('avalanche').length}`
    );
  }

  private processRawBalance(rawData: unknown, providerName: string): Balance[] {
    switch (providerName) {
      case 'snowtrace': {
        // Process Snowtrace raw balance response
        const response = rawData as { result: string };
        const balanceWei = new Decimal(response.result);
        const balanceAvax = balanceWei.dividedBy(new Decimal(10).pow(18));

        return [
          {
            balance: balanceAvax.toNumber(),
            currency: 'AVAX',
            total: balanceAvax.toNumber(),
            used: 0,
          },
        ];
      }
      default:
        throw new Error(`Unsupported provider for balance processing: ${providerName}`);
    }
  }

  private processRawTokenBalances(rawData: unknown, providerName: string): Balance[] {
    switch (providerName) {
      case 'snowtrace':
        this.logger.debug(`Provider ${providerName} does not support token balances or processing not implemented`);
        return [];
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
      case 'snowtrace':
        return SnowtraceProcessor.processTokenTransactions(rawData as SnowtraceTokenTransfer[], userAddress);
      default:
        this.logger.debug(`Provider ${providerName} does not support token transactions or processing not implemented`);
        return [];
    }
  }

  private processRawTransactions(rawData: unknown, providerName: string, userAddress: string): BlockchainTransaction[] {
    switch (providerName) {
      case 'snowtrace':
        return SnowtraceProcessor.processAddressTransactions(rawData as SnowtraceRawData, userAddress);
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
      this.logger.info('Avalanche adapter closed successfully');
    } catch (error) {
      this.logger.warn(`Error during Avalanche adapter close - Error: ${error}`);
    }
  }

  protected async fetchRawBalances(params: UniversalFetchParams): Promise<Balance[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Avalanche balance fetching');
    }

    const allBalances: Balance[] = [];

    for (const address of params.addresses) {
      this.logger.info(`Getting balance for address: ${address.substring(0, 20)}...`);

      try {
        const failoverResult = await this.providerManager.executeWithFailover('avalanche', {
          address: address,
          getCacheKey: cacheParams =>
            `avax_raw_balance_${cacheParams.type === 'getRawAddressBalance' ? cacheParams.address : 'unknown'}`,
          type: 'getRawAddressBalance',
        });

        // Process raw balance data using bridge pattern
        const rawBalanceData = failoverResult.data;
        const processedBalances = this.processRawBalance(rawBalanceData, failoverResult.providerName);

        allBalances.push(...processedBalances);

        // Get token balances
        try {
          const tokenFailoverResult = await this.providerManager.executeWithFailover('avalanche', {
            address: address,
            getCacheKey: cacheParams =>
              `avax_raw_token_balance_${cacheParams.type === 'getRawTokenBalances' ? cacheParams.address : 'unknown'}`,
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
      throw new Error('Addresses required for Avalanche adapter');
    }

    const allTransactions: BlockchainTransaction[] = [];

    for (const address of params.addresses) {
      this.logger.info(`AvalancheAdapter: Fetching transactions for address: ${address.substring(0, 20)}...`);

      try {
        // Fetch raw transactions using new architecture
        const rawResult = await this.providerManager.executeWithFailover('avalanche', {
          address: address,
          getCacheKey: cacheParams =>
            `avax_raw_tx_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.address : 'unknown'}_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.since || 'all' : 'unknown'}`,
          since: params.since,
          type: 'getRawAddressTransactions',
        });

        // Process raw data using bridge pattern
        const processedTransactions = this.processRawTransactions(rawResult.data, rawResult.providerName, address);
        allTransactions.push(...processedTransactions);

        // Try to fetch token transactions separately (if provider supports it)
        let tokenTxs: BlockchainTransaction[] = [];
        try {
          const tokenTxsFailoverResult = await this.providerManager.executeWithFailover('avalanche', {
            address: address,
            getCacheKey: cacheParams =>
              `avax_token_tx_${cacheParams.type === 'getTokenTransactions' ? cacheParams.address : 'unknown'}_${cacheParams.type === 'getTokenTransactions' ? cacheParams.since || 'all' : 'unknown'}`,
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
            `Provider does not support separate token transactions or failed to fetch: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        allTransactions.push(...tokenTxs);
        this.logger.info(
          `AvalancheAdapter transaction breakdown for ${address.substring(0, 20)}... - Regular: ${processedTransactions.length}, Token: ${tokenTxs.length}`
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

    this.logger.info(`AvalancheAdapter: Found ${uniqueTransactions.length} unique transactions total`);
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
      id: 'avalanche',
      name: 'Avalanche C-Chain',
      subType: 'rest',
      type: 'blockchain',
    };
  }

  async testConnection(): Promise<boolean> {
    this.logger.debug('AvalancheAdapter.testConnection called');
    try {
      const providers = this.providerManager.getProviders('avalanche');
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
    return rawTxs.map(tx => {
      // Map blockchain-specific types to UniversalTransaction types
      let universalType: TransactionType;

      switch (tx.type) {
        case 'transfer_in':
        case 'internal_transfer_in':
        case 'token_transfer_in':
          universalType = 'deposit';
          break;
        case 'transfer_out':
        case 'internal_transfer_out':
        case 'token_transfer_out':
          universalType = 'withdrawal';
          break;
        case 'transfer':
          universalType = 'transfer';
          break;
        default:
          universalType = 'transfer';
          break;
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
        network: 'mainnet',
        source: 'avalanche',
        status: tx.status === 'success' ? 'closed' : tx.status === 'pending' ? 'open' : 'canceled',
        symbol: tx.tokenSymbol || tx.value.currency,
        timestamp: tx.timestamp,
        to: tx.to,
        type: universalType,
      };
    });
  }

  // Legacy methods for compatibility (can be removed once migration is complete)
  validateAddress(address: string): boolean {
    // Avalanche C-Chain uses Ethereum-style addresses but they are case-sensitive
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    const isValid = ethAddressRegex.test(address);

    this.logger.debug(`Address validation - Address: ${address}, IsValid: ${isValid}`);
    return isValid;
  }
}
