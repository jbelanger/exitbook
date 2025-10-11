import { getErrorMessage } from '@exitbook/core';

import type { ProviderConfig, ProviderOperation } from '../../../../core/blockchain/index.ts';
import { BaseApiClient, RegisterApiClient } from '../../../../core/blockchain/index.ts';
import { maskAddress } from '../../../../core/blockchain/utils/address-utils.ts';
import type { SubstrateChainConfig } from '../../chain-config.interface.ts';
import { getSubstrateChainConfig } from '../../chain-registry.ts';
import { isValidSS58Address } from '../../utils.ts';

import type {
  TaostatsBalanceResponse,
  TaostatsTransactionAugmented,
  TaostatsTransactionRaw,
} from './taostats.types.ts';

@RegisterApiClient({
  apiKeyEnvVar: 'TAOSTATS_API_KEY',
  baseUrl: 'https://api.taostats.io/api',
  blockchain: 'bittensor',
  capabilities: {
    supportedOperations: ['getRawAddressTransactions', 'getRawAddressBalance'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 1,
      requestsPerHour: 300,
      requestsPerMinute: 5,
      requestsPerSecond: 0.08,
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Bittensor network provider with Taostats API integration',
  displayName: 'Taostats',
  name: 'taostats',
  requiresApiKey: true,
  supportedChains: ['bittensor'],
})
export class TaostatsApiClient extends BaseApiClient {
  private readonly chainConfig: SubstrateChainConfig;

  constructor(config: ProviderConfig) {
    super(config);

    // Get chain config
    const chainConfig = getSubstrateChainConfig(config.blockchain);
    if (!chainConfig) {
      throw new Error(`Unsupported blockchain for Taostats provider: ${config.blockchain}`);
    }
    this.chainConfig = chainConfig;

    // Taostats doesn't use "Bearer" prefix for authorization
    this.reinitializeHttpClient({
      defaultHeaders: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(this.apiKey && {
          Authorization: this.apiKey,
        }),
      },
    });

    this.logger.debug(
      `Initialized TaostatsApiClient for ${config.blockchain} - BaseUrl: ${this.baseUrl}, TokenSymbol: ${this.chainConfig.nativeCurrency}`
    );
  }

  async execute<T>(operation: ProviderOperation): Promise<T> {
    this.logger.debug(`Executing operation: ${operation.type}`);

    switch (operation.type) {
      case 'getRawAddressTransactions': {
        const { address, since } = operation;
        this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);
        return this.getRawAddressTransactions(address, since) as Promise<T>;
      }
      case 'getRawAddressBalance': {
        const { address } = operation;
        this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);
        return this.getRawAddressBalance(address) as Promise<T>;
      }
      default:
        throw new Error(`Unsupported operation: ${operation.type}`);
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/account/latest/v1?network=finney&limit=1',
      validate: (response: unknown) => {
        return !!(response && typeof response === 'object' && 'data' in response);
      },
    };
  }

  private async getRawAddressBalance(address: string): Promise<TaostatsBalanceResponse> {
    // Validate address format
    if (!isValidSS58Address(address)) {
      throw new Error(`Invalid SS58 address for ${this.blockchain}: ${address}`);
    }

    try {
      const response = await this.httpClient.get<TaostatsBalanceResponse>(
        `/account/latest/v1?network=finney&address=${address}`
      );

      const balance = response.data?.[0]?.balance_total || '0';
      this.logger.debug(`Found raw balance for ${maskAddress(address)}: ${balance}`);

      return response;
    } catch (error) {
      this.logger.error(
        `Failed to fetch raw address balance for ${maskAddress(address)} - Error: ${getErrorMessage(error)}`
      );
      throw error;
    }
  }

  private async getRawAddressTransactions(address: string, since?: number): Promise<TaostatsTransactionAugmented[]> {
    // Validate address format
    if (!isValidSS58Address(address)) {
      throw new Error(`Invalid SS58 address for ${this.blockchain}: ${address}`);
    }

    try {
      const transactions: TaostatsTransactionAugmented[] = [];
      let offset = 0;
      const maxPages = 100; // Safety limit to prevent infinite loops
      const limit = 100;
      let hasMorePages = true;

      do {
        // Build query parameters
        const params = new URLSearchParams({
          network: 'finney',
          address: address,
          limit: limit.toString(),
          offset: offset.toString(),
        });

        if (since) {
          // Taostats expects ISO timestamp
          const sinceDate = new Date(since).toISOString();
          params.append('after', sinceDate);
        }

        const endpoint = `/transfer/v1?${params.toString()}`;
        const response = await this.httpClient.get<{ data?: TaostatsTransactionRaw[] }>(endpoint);

        const pageTransactions = response.data || [];

        // Augment transactions with chain config data (no normalization - that's the mapper's job)
        const augmentedTransactions = pageTransactions.map((tx) => ({
          ...tx,
          _nativeCurrency: this.chainConfig.nativeCurrency,
          _nativeDecimals: this.chainConfig.nativeDecimals,
          _chainDisplayName: this.chainConfig.displayName,
        })) as TaostatsTransactionAugmented[];

        transactions.push(...augmentedTransactions);
        offset += limit;

        // Check if there are more pages
        hasMorePages = pageTransactions.length === limit;

        this.logger.debug(
          `Fetched page ${Math.floor(offset / limit)}: ${pageTransactions.length} transactions${hasMorePages ? ' (more pages available)' : ' (last page)'}`
        );

        // Safety check to prevent infinite pagination
        if (Math.floor(offset / limit) >= maxPages) {
          this.logger.warn(`Reached maximum page limit (${maxPages}), stopping pagination`);
          break;
        }
      } while (hasMorePages);

      this.logger.debug(`Found ${transactions.length} total raw address transactions for ${maskAddress(address)}`);
      return transactions;
    } catch (error) {
      this.logger.error(
        `Failed to fetch raw address transactions for ${maskAddress(address)} - Error: ${getErrorMessage(error)}`
      );
      throw error;
    }
  }
}
