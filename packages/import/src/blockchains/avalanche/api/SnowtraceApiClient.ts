import { AuthenticationError, ServiceError } from '@crypto/core';
import { maskAddress } from '@crypto/shared-utils';

import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.ts';
import { RegisterApiClient } from '../../shared/registry/decorators.ts';
import type { ProviderOperation } from '../../shared/types.ts';
import type {
  SnowtraceApiResponse,
  SnowtraceBalanceResponse,
  SnowtraceInternalTransaction,
  SnowtraceTokenTransfer,
  SnowtraceTransaction,
} from '../types.ts';
import { isValidAvalancheAddress } from '../utils.ts';

@RegisterApiClient({
  apiKeyEnvVar: 'SNOWTRACE_API_KEY',
  blockchain: 'avalanche',
  capabilities: {
    maxBatchSize: 1,
    supportedOperations: [
      'getRawAddressTransactions',
      'getRawAddressBalance',
      'getTokenTransactions',
      'getRawTokenBalances',
    ],
    supportsHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: true,
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 3,
      requestsPerHour: 100,
      requestsPerMinute: 30,
      requestsPerSecond: 1,
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Avalanche blockchain explorer API with comprehensive transaction and balance data',
  displayName: 'Snowtrace API',
  name: 'snowtrace',
  networks: {
    mainnet: {
      baseUrl: 'https://api.snowtrace.io/api',
    },
    testnet: {
      baseUrl: 'https://api-testnet.snowtrace.io/api',
    },
  },
  requiresApiKey: false,
  type: 'rest',
})
export class SnowtraceApiClient extends BaseRegistryProvider {
  constructor() {
    super('avalanche', 'snowtrace', 'mainnet');
  }

  private async getInternalTransactions(address: string, since?: number): Promise<SnowtraceInternalTransaction[]> {
    const allTransactions: SnowtraceInternalTransaction[] = [];
    let page = 1;

    while (true) {
      // API constraint: page * offset <= 10000, so optimize accordingly
      const maxOffset = Math.floor(10000 / page);
      if (maxOffset < 1) break; // Can't fetch more pages

      const params = new URLSearchParams({
        action: 'txlistinternal',
        address: address,
        endblock: '99999999',
        module: 'account',
        offset: maxOffset.toString(),
        page: page.toString(),
        sort: 'asc',
        startblock: '0',
      });

      if (since) {
        params.set('startblock', Math.floor(since / 1000).toString());
      }

      if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
        params.append('apikey', this.apiKey);
      }

      try {
        const response = (await this.httpClient.get(
          `?${params.toString()}`
        )) as SnowtraceApiResponse<SnowtraceInternalTransaction>;

        if (response.status !== '1') {
          // If no results found or error, break the loop
          if (response.message === 'No transactions found') {
            break;
          }
          this.logger.debug(`No internal transactions found - Message: ${response.message}`);
          break;
        }

        const transactions = response.result || [];
        allTransactions.push(...transactions);

        // If we got less than the max offset, we've reached the end
        if (transactions.length < maxOffset) {
          break;
        }

        page++;
      } catch (error) {
        this.logger.warn(`Failed to fetch internal transactions page ${page}`);
        break;
      }
    }

    return allTransactions;
  }

  private async getNormalTransactions(address: string, since?: number): Promise<SnowtraceTransaction[]> {
    const allTransactions: SnowtraceTransaction[] = [];
    let page = 1;

    while (true) {
      // API constraint: page * offset <= 10000, so optimize accordingly
      const maxOffset = Math.floor(10000 / page);
      if (maxOffset < 1) break; // Can't fetch more pages

      const params = new URLSearchParams({
        action: 'txlist',
        address: address,
        endblock: '99999999',
        module: 'account',
        offset: maxOffset.toString(),
        page: page.toString(),
        sort: 'asc',
        startblock: '0',
      });

      if (since) {
        params.set('startblock', Math.floor(since / 1000).toString());
      }

      if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
        params.append('apikey', this.apiKey);
      }

      const response = (await this.httpClient.get(
        `?${params.toString()}`
      )) as SnowtraceApiResponse<SnowtraceTransaction>;

      if (response.status !== '1') {
        if (response.message === 'NOTOK' && response.message.includes('Invalid API Key')) {
          throw new AuthenticationError('Invalid Snowtrace API key', this.name, 'getNormalTransactions');
        }
        // If no results found, break the loop
        if (response.message === 'No transactions found') {
          break;
        }
        throw new ServiceError(`Snowtrace API error: ${response.message}`, this.name, 'getNormalTransactions');
      }

      const transactions = response.result || [];
      allTransactions.push(...transactions);

      // If we got less than the max offset, we've reached the end
      if (transactions.length < maxOffset) {
        break;
      }

      page++;
    }

    return allTransactions;
  }

  private async getRawAddressBalance(params: { address: string }): Promise<SnowtraceBalanceResponse> {
    const { address } = params;

    if (!isValidAvalancheAddress(address)) {
      throw new Error(`Invalid Avalanche address: ${address}`);
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}, Network: ${this.network}`);

    try {
      const params = new URLSearchParams({
        action: 'balance',
        address: address,
        module: 'account',
        tag: 'latest',
      });

      if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
        params.append('apikey', this.apiKey);
      }

      const response = (await this.httpClient.get(`?${params.toString()}`)) as SnowtraceBalanceResponse;

      if (response.status !== '1') {
        throw new ServiceError(`Failed to fetch AVAX balance: ${response.message}`, this.name, 'getRawAddressBalance');
      }

      this.logger.debug(`Retrieved raw balance for ${maskAddress(address)}: ${response.result} wei`);

      return response;
    } catch (error) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawAddressTransactions(params: { address: string; since?: number | undefined }): Promise<{
    internal: SnowtraceInternalTransaction[];
    normal: SnowtraceTransaction[];
  }> {
    const { address, since } = params;

    if (!isValidAvalancheAddress(address)) {
      throw new Error(`Invalid Avalanche address: ${address}`);
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}, Network: ${this.network}`);

    try {
      // Get normal transactions
      const normalTransactions = await this.getNormalTransactions(address, since);

      // Get internal transactions
      const internalTransactions = await this.getInternalTransactions(address, since);

      this.logger.debug(
        `Retrieved ${normalTransactions.length + internalTransactions.length} raw transactions for ${maskAddress(address)}`
      );

      return {
        internal: internalTransactions,
        normal: normalTransactions,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawTokenBalances(params: {
    address: string;
    contractAddresses?: string[] | undefined;
  }): Promise<[]> {
    // Snowtrace doesn't have a direct "get all token balances" endpoint
    this.logger.debug('Token balance fetching not implemented for Snowtrace - use specific contract addresses');
    return [];
  }

  private async getTokenTransactions(params: {
    address: string;
    contractAddress?: string | undefined;
    limit?: number | undefined;
    since?: number | undefined;
    until?: number | undefined;
  }): Promise<SnowtraceTokenTransfer[]> {
    const { address, contractAddress, since } = params;
    return this.getTokenTransfers(address, since, contractAddress);
  }

  private async getTokenTransfers(
    address: string,
    since?: number,
    contractAddress?: string
  ): Promise<SnowtraceTokenTransfer[]> {
    const allTransactions: SnowtraceTokenTransfer[] = [];
    let page = 1;

    while (true) {
      // API constraint: page * offset <= 10000, so optimize accordingly
      const maxOffset = Math.floor(10000 / page);
      if (maxOffset < 1) break; // Can't fetch more pages

      const params = new URLSearchParams({
        action: 'tokentx',
        address: address,
        endblock: '99999999',
        module: 'account',
        offset: maxOffset.toString(),
        page: page.toString(),
        sort: 'asc',
        startblock: '0',
      });

      if (since) {
        params.set('startblock', Math.floor(since / 1000).toString());
      }

      if (contractAddress) {
        params.append('contractaddress', contractAddress);
      }

      if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
        params.append('apikey', this.apiKey);
      }

      try {
        const response = (await this.httpClient.get(
          `?${params.toString()}`
        )) as SnowtraceApiResponse<SnowtraceTokenTransfer>;

        if (response.status !== '1') {
          // If no results found or error, break the loop
          if (response.message === 'No transactions found') {
            break;
          }
          this.logger.debug(`No token transfers found - Message: ${response.message}`);
          break;
        }

        const transactions = response.result || [];
        allTransactions.push(...transactions);

        // If we got less than the max offset, we've reached the end
        if (transactions.length < maxOffset) {
          break;
        }

        page++;
      } catch (error) {
        this.logger.warn(`Failed to fetch token transfers page ${page}`);
        break;
      }
    }

    return allTransactions;
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${operation.type !== 'parseWalletTransaction' && operation.type !== 'testConnection' && 'address' in operation ? maskAddress(operation.address as string) : 'N/A'}`
    );

    try {
      switch (operation.type) {
        case 'getRawAddressTransactions':
          return this.getRawAddressTransactions({
            address: operation.address,
            since: operation.since,
          }) as T;
        case 'getRawAddressBalance':
          return this.getRawAddressBalance({
            address: operation.address,
          }) as T;
        case 'getTokenTransactions':
          return this.getTokenTransactions({
            address: operation.address,
            contractAddress: operation.contractAddress,
            limit: operation.limit,
            since: operation.since,
            until: operation.until,
          }) as T;
        case 'getRawTokenBalances':
          return this.getRawTokenBalances({
            address: operation.address,
            contractAddresses: operation.contractAddresses,
          }) as T;
        default:
          throw new Error(`Unsupported operation: ${operation.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Operation execution failed - Type: ${operation.type}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        action: 'ethsupply',
        module: 'stats',
      });

      if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
        params.append('apikey', this.apiKey);
      }

      const response = await this.httpClient.get(`?${params.toString()}`);
      return !!(response && (response as SnowtraceApiResponse<unknown>).status === '1');
    } catch (error) {
      this.logger.warn(`Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const result = await this.isHealthy();
      if (!result) {
        this.logger.warn(`Connection test failed - Provider unhealthy`);
      }
      return result;
    } catch (error) {
      this.logger.error(`Connection test failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
