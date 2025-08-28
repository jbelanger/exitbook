import type {
  Balance,
  TransactionType,
  UniversalAdapterInfo,
  UniversalBalance,
  UniversalBlockchainAdapterConfig,
  UniversalFetchParams,
  UniversalTransaction,
} from '@crypto/core';
import { createMoney } from '@crypto/shared-utils';
import type { BlockchainExplorersConfig } from '@crypto/shared-utils';

import { BaseAdapter } from '../../shared/adapters/base-adapter.ts';
import { BlockchainProviderManager } from '../shared/blockchain-provider-manager.ts';
// Import clients to ensure they are registered
import './api/index.ts';
import type { InjectiveBalanceResponse, InjectiveTransaction } from './types.ts';

export class InjectiveAdapter extends BaseAdapter {
  private providerManager: BlockchainProviderManager;

  constructor(config: UniversalBlockchainAdapterConfig, explorerConfig: BlockchainExplorersConfig | null) {
    super(config);

    this.providerManager = new BlockchainProviderManager(explorerConfig);
    this.providerManager.autoRegisterFromConfig('injective', 'mainnet');

    this.logger.info(
      `Initialized Injective adapter with registry-based provider manager - ProvidersCount: ${this.providerManager.getProviders('injective').length}`
    );
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

      this.logger.info(`Getting raw balance for address: ${address.substring(0, 20)}...`);

      try {
        const failoverResult = await this.providerManager.executeWithFailover('injective', {
          address: address,
          getCacheKey: cacheParams =>
            `inj_raw_balance_${cacheParams.type === 'getRawAddressBalance' ? cacheParams.address : 'unknown'}`,
          type: 'getRawAddressBalance',
        });
        const rawBalanceResponse = failoverResult.data as InjectiveBalanceResponse;

        // Transform raw balance response to Balance format
        // This is minimal transformation - detailed processing should be in processors if needed
        const balances: Balance[] = rawBalanceResponse.balances.map(balance => {
          const amount = parseFloat(balance.amount) / Math.pow(10, 18); // Convert from smallest unit
          const currency = balance.denom === 'inj' || balance.denom === 'uinj' ? 'INJ' : balance.denom.toUpperCase();
          return {
            balance: amount,
            contractAddress: undefined,
            currency,
            total: amount,
            used: 0,
          };
        });

        allBalances.push(...balances);
      } catch (error) {
        this.logger.error(`Failed to fetch raw balance for ${address} - Error: ${error}`);
        throw error;
      }
    }

    return allBalances;
  }

  /**
   * Fetch raw transaction data from Injective blockchain APIs.
   * Returns raw InjectiveTransaction data that will be processed by specific processors.
   */
  protected async fetchRawTransactions(params: UniversalFetchParams): Promise<InjectiveTransaction[]> {
    if (!params.addresses?.length) {
      throw new Error('Addresses required for Injective adapter');
    }

    const allRawTransactions: InjectiveTransaction[] = [];

    for (const address of params.addresses) {
      // Basic Injective address validation - starts with 'inj' and is bech32 encoded
      if (!/^inj1[a-z0-9]{38}$/.test(address)) {
        throw new Error(`Invalid Injective address: ${address}`);
      }

      this.logger.info(`InjectiveAdapter: Fetching raw transactions for address: ${address.substring(0, 20)}...`);

      try {
        // Fetch raw transactions from Injective Explorer API
        const failoverResult = await this.providerManager.executeWithFailover('injective', {
          address: address,
          getCacheKey: cacheParams =>
            `inj_raw_tx_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.address : 'unknown'}_${cacheParams.type === 'getRawAddressTransactions' ? cacheParams.since || 'all' : 'unknown'}`,
          since: params.since,
          type: 'getRawAddressTransactions',
        });
        const rawTransactions = failoverResult.data as InjectiveTransaction[];

        // Add fetching address to each raw transaction for processor context
        const enhancedRawTransactions = rawTransactions.map(tx => ({
          ...tx,
          fetchedByAddress: address,
        }));

        allRawTransactions.push(...enhancedRawTransactions);

        this.logger.info(
          `InjectiveAdapter: Found ${rawTransactions.length} raw transactions for ${address.substring(0, 20)}...`
        );
      } catch (error) {
        this.logger.error(`Failed to fetch raw transactions for ${address} - Error: ${error}`);
        throw error;
      }
    }

    // Remove duplicates based on hash and sort by timestamp
    const uniqueTransactions = allRawTransactions.reduce((acc, tx) => {
      if (!acc.find(existing => existing.hash === tx.hash)) {
        acc.push(tx);
      }
      return acc;
    }, [] as InjectiveTransaction[]);

    // Sort by block timestamp (newest first)
    uniqueTransactions.sort((a, b) => {
      const timestampA = new Date(a.block_timestamp).getTime();
      const timestampB = new Date(b.block_timestamp).getTime();
      return timestampB - timestampA;
    });

    this.logger.info(`InjectiveAdapter: Found ${uniqueTransactions.length} unique raw transactions total`);
    return uniqueTransactions;
  }

  async getInfo(): Promise<UniversalAdapterInfo> {
    return {
      capabilities: {
        maxBatchSize: 1,
        rateLimit: {
          burstLimit: 15,
          requestsPerSecond: 3,
        },
        requiresApiKey: false,
        supportedOperations: ['fetchTransactions', 'fetchBalances', 'getAddressTransactions'],
        supportsHistoricalData: true,
        supportsPagination: true,
      },
      id: 'injective',
      name: 'Injective Protocol',
      subType: 'rest',
      type: 'blockchain',
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test connection through provider manager
      const healthStatus = this.providerManager.getProviderHealth('injective');
      const hasHealthyProvider = Array.from(healthStatus.values()).some(
        health => health.isHealthy && health.circuitState !== 'OPEN'
      );

      this.logger.info(
        `Injective provider connection test result - HasHealthyProvider: ${hasHealthyProvider}, TotalProviders: ${healthStatus.size}`
      );

      return hasHealthyProvider;
    } catch (error) {
      this.logger.error(`Injective connection test failed - Error: ${error}`);
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
    rawTxs: InjectiveTransaction[],
    params: UniversalFetchParams
  ): Promise<UniversalTransaction[]> {
    // BRIDGE: Temporary compatibility layer for old import system
    // This method provides backward compatibility while maintaining the new processor architecture
    // The new system uses InjectiveTransactionProcessor via ProcessorFactory

    const userAddresses = params.addresses || [];
    const relevantAddresses = new Set(userAddresses);
    const universalTransactions: UniversalTransaction[] = [];

    for (const tx of rawTxs) {
      try {
        // Use the same logic as InjectiveExplorerProcessor for consistency
        const timestamp = new Date(tx.block_timestamp).getTime();

        let value = createMoney(0, 'INJ');
        let fee = createMoney(0, 'INJ');
        let from = '';
        let to = '';
        let tokenSymbol = 'INJ';
        let isRelevantTransaction = false;
        let isIncoming = false;
        let isOutgoing = false;

        // Parse fee from gas_fee field
        if (tx.gas_fee && tx.gas_fee.amount && Array.isArray(tx.gas_fee.amount) && tx.gas_fee.amount.length > 0) {
          const firstFee = tx.gas_fee.amount[0];
          if (firstFee && firstFee.amount && firstFee.denom) {
            const feeAmount = parseFloat(firstFee.amount) / Math.pow(10, 18);
            fee = createMoney(
              feeAmount.toString(),
              firstFee.denom === 'inj' || firstFee.denom === 'uinj' ? 'INJ' : firstFee.denom.toUpperCase()
            );
          }
        }

        // Parse messages to extract transfer information
        for (const message of tx.messages) {
          if (message.type === '/cosmos.bank.v1beta1.MsgSend') {
            from = message.value.from_address || '';
            to = message.value.to_address || '';

            if (message.value.amount && Array.isArray(message.value.amount) && message.value.amount.length > 0) {
              const transferAmount = message.value.amount[0];
              if (transferAmount) {
                const amount = parseFloat(transferAmount.amount) / Math.pow(10, 18);
                const denom =
                  transferAmount.denom === 'inj' || transferAmount.denom === 'uinj'
                    ? 'INJ'
                    : transferAmount.denom.toUpperCase();
                value = createMoney(amount.toString(), denom);
                tokenSymbol = denom;
              }
            }

            // Check if relevant to wallet addresses
            if (to && relevantAddresses.has(to) && value.amount.toNumber() > 0) {
              isRelevantTransaction = true;
              isIncoming = true;
            } else if (from && relevantAddresses.has(from) && value.amount.toNumber() > 0) {
              isRelevantTransaction = true;
              isOutgoing = true;
            }
            break;
          }
        }

        // Only process relevant transactions
        if (!isRelevantTransaction) {
          continue;
        }

        // Determine transaction type
        let type: TransactionType = 'transfer';
        if (isIncoming && !isOutgoing) {
          type = 'deposit';
        } else if (isOutgoing && !isIncoming) {
          type = 'withdrawal';
        } else if (isIncoming && isOutgoing) {
          type = 'transfer';
        }

        universalTransactions.push({
          amount: value,
          datetime: new Date(timestamp).toISOString(),
          fee,
          from,
          id: tx.hash,
          metadata: {
            blockchain: 'injective',
            blockNumber: tx.block_number,
            confirmations: tx.code === 0 ? 1 : 0,
            gasUsed: tx.gas_used,
            originalTransaction: tx,
          },
          network: 'mainnet',
          source: 'injective',
          status: tx.code === 0 ? 'closed' : tx.code === 0 ? 'open' : 'canceled',
          symbol: tokenSymbol,
          timestamp,
          to,
          type,
        });
      } catch (error) {
        this.logger.warn(`Failed to transform transaction ${tx.hash}: ${error}`);
      }
    }

    this.logger.debug(
      `Transformed ${universalTransactions.length} transactions from ${rawTxs.length} raw transactions`
    );
    return universalTransactions;
  }
}
