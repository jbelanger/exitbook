import { getErrorMessage } from '@exitbook/core';

import { BaseApiClient } from '../../../core/blockchain/base/api-client.ts';
import type { ProviderConfig } from '../../../core/blockchain/index.ts';
import { RegisterApiClient } from '../../../core/blockchain/index.ts';
import type { ProviderOperation } from '../../../core/blockchain/types/index.ts';
import { maskAddress } from '../../../core/blockchain/utils/address-utils.ts';
import type { AddressInfo } from '../types.js';

import type { TatumBitcoinTransaction, TatumBitcoinBalance } from './tatum.types.js';

@RegisterApiClient({
  apiKeyEnvVar: 'TATUM_API_KEY',
  baseUrl: 'https://api.tatum.io/v3/bitcoin',
  blockchain: 'bitcoin',
  capabilities: {
    supportedOperations: ['getRawAddressTransactions', 'getAddressBalances'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 50, // 50 batch calling as specified
      requestsPerHour: 10800,
      requestsPerMinute: 180,
      requestsPerSecond: 3, // 3 req/s as specified
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Multi-blockchain API provider supporting Bitcoin via unified Tatum API',
  displayName: 'Tatum Bitcoin API',
  name: 'tatum',
  requiresApiKey: true,
})
export class TatumBitcoinApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super(config);

    // Reinitialize HTTP client with Tatum-specific headers
    this.reinitializeHttpClient({
      baseUrl: `https://api.tatum.io/v3/${this.blockchain}`,
      defaultHeaders: {
        accept: 'application/json',
        'x-api-key': this.apiKey,
      },
    });

    this.logger.debug(
      `Initialized TatumBitcoinApiClient - BaseUrl: ${this.baseUrl}, HasApiKey: ${this.apiKey !== 'YourApiKeyToken'}`
    );
  }

  async execute<T>(operation: ProviderOperation, _config?: Record<string, unknown>): Promise<T> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address as string) : 'N/A'}`
    );

    try {
      switch (operation.type) {
        case 'getRawAddressTransactions':
          return (await this.getRawAddressTransactions(operation.address)) as T;
        case 'getAddressBalances':
          return (await this.getAddressBalances({
            address: operation.address,
          })) as T;
        case 'custom': {
          // Handle custom Tatum-specific operations with additional parameters
          const customOp = operation as Record<string, unknown>; // Cast to access custom fields
          if (customOp['tatumOperation'] === 'getRawAddressTransactionsWithParams') {
            return (await this.getRawAddressTransactions(customOp['address'] as string, {
              blockFrom: customOp['blockFrom'] as number,
              blockTo: customOp['blockTo'] as number,
              offset: customOp['offset'] as number,
              pageSize: customOp['pageSize'] as number,
              txType: customOp['txType'] as 'incoming' | 'outgoing',
            })) as T;
          }
          throw new Error(`Unsupported custom operation: ${customOp['tatumOperation'] as string}`);
        }
        default:
          throw new Error(`Unsupported operation: ${operation.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Operation execution failed - Type: ${operation.type}, Params: ${JSON.stringify(operation)}, Error: ${getErrorMessage(error)}`
      );
      throw error;
    }
  }

  /**
   * Get raw address balance - no transformation, just raw Tatum API data
   */
  async getRawAddressBalance(address: string): Promise<TatumBitcoinBalance> {
    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    try {
      const balance = await this.makeRequest<TatumBitcoinBalance>(`/address/balance/${address}`);

      this.logger.debug(
        `Retrieved raw balance - Address: ${maskAddress(address)}, Incoming: ${balance.incoming}, Outgoing: ${balance.outgoing}`
      );

      return balance;
    } catch (error) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(error)}`
      );
      throw error;
    }
  }

  /**
   * Get raw address transactions - no transformation, just raw Tatum API data
   */
  async getRawAddressTransactions(
    address: string,
    params?: {
      blockFrom?: number | undefined;
      blockTo?: number | undefined;
      offset?: number | undefined;
      pageSize?: number | undefined;
      txType?: 'incoming' | 'outgoing' | undefined;
    }
  ): Promise<TatumBitcoinTransaction[]> {
    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    try {
      const queryParams = {
        offset: params?.offset || 0,
        pageSize: Math.min(params?.pageSize || 50, 50), // Tatum max is 50
        ...(params?.blockFrom && { blockFrom: params.blockFrom }),
        ...(params?.blockTo && { blockTo: params.blockTo }),
        ...(params?.txType && { txType: params.txType }),
      };

      const transactions = await this.makeRequest<TatumBitcoinTransaction[]>(
        `/transaction/address/${address}`,
        queryParams
      );

      if (!Array.isArray(transactions)) {
        this.logger.debug(`No transactions found - Address: ${maskAddress(address)}`);
        return [];
      }

      this.logger.debug(`Retrieved raw transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}`);

      return transactions;
    } catch (error) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(error)}`
      );
      throw error;
    }
  }

  override getHealthCheckConfig() {
    return {
      endpoint: '/address/balance/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      validate: (response: unknown) => {
        return response !== null && response !== undefined;
      },
    };
  }

  /**
   * Make a request to the Tatum API with common error handling
   */
  private async makeRequest<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    this.validateApiKey();

    try {
      // Build URL with query parameters
      let url = endpoint;
      if (params && Object.keys(params).length > 0) {
        const queryString = new URLSearchParams(
          Object.entries(params)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => [key, String(value)] as [string, string])
        ).toString();
        url = `${endpoint}?${queryString}`;
      }

      const response = await this.httpClient.get<T>(url);
      return response;
    } catch (error) {
      this.logger.error(
        `Tatum API request failed - Blockchain: ${this.blockchain}, Endpoint: ${endpoint}, Error: ${getErrorMessage(error)}`
      );
      throw error;
    }
  }

  /**
   * Get address info for efficient gap scanning
   * Converts raw balance to AddressInfo format
   */
  private async getAddressBalances(params: { address: string }): Promise<AddressInfo> {
    const { address } = params;

    this.logger.debug(`Fetching address info - Address: ${maskAddress(address)}`);

    try {
      // Get balance first
      const balance = await this.getRawAddressBalance(address);

      // Calculate net balance in BTC (incoming - outgoing, converted from satoshis)
      const incomingSats = parseInt(balance.incoming) || 0;
      const outgoingSats = parseInt(balance.outgoing) || 0;
      const netBalanceSats = incomingSats - outgoingSats;
      const balanceBTC = (netBalanceSats / 100000000).toString();

      // Get transactions to count them
      const transactions = await this.getRawAddressTransactions(address, { pageSize: 1 });
      const txCount = Array.isArray(transactions) ? transactions.length : 0;

      this.logger.debug(`Retrieved address info - Address: ${maskAddress(address)}, TxCount: ${txCount}`);

      return {
        balance: balanceBTC,
        txCount,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get address info - Address: ${maskAddress(address)}, Error: ${getErrorMessage(error)}`
      );
      throw error;
    }
  }
}
