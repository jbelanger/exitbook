import { maskAddress } from '@exitbook/shared-utils';
import { ServiceError } from '@exitbook/shared-utils';

import type { ProviderConfig } from '../../../shared/index.ts';
import { RegisterApiClient, BlockchainApiClient } from '../../../shared/index.ts';
import type { ProviderOperation } from '../../../shared/types.ts';

import type {
  SnowtraceApiResponse,
  SnowtraceInternalTransaction,
  SnowtraceTransaction,
  SnowtraceBalanceResponse,
  SnowtraceTokenTransfer,
} from './snowtrace.types.ts';

@RegisterApiClient({
  apiKeyEnvVar: 'SNOWTRACE_API_KEY',
  baseUrl: 'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api',
  blockchain: 'avalanche',
  capabilities: {
    supportedOperations: [
      'getRawAddressBalance',
      'getRawAddressInternalTransactions',
      'getRawAddressTransactions',
      'getRawTokenBalances',
      'getTokenTransactions',
    ],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 8,
      requestsPerHour: 12960,
      requestsPerMinute: 216,
      requestsPerSecond: 5,
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Avalanche blockchain explorer API with comprehensive transaction and balance data',
  displayName: 'Snowtrace API',
  name: 'snowtrace',
  requiresApiKey: false,
  supportedChains: ['avalanche'],
})
export class SnowtraceApiClient extends BlockchainApiClient {
  constructor(config: ProviderConfig) {
    super(config);
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address as string) : 'N/A'}`
    );

    try {
      switch (operation.type) {
        case 'getRawAddressTransactions':
          return (await this.getRawAddressTransactions({
            address: operation.address,
            since: operation.since,
          })) as T;
        case 'getRawAddressInternalTransactions':
          return (await this.getRawAddressInternalTransactions({
            address: operation.address,
            since: operation.since,
          })) as T;
        case 'getRawAddressBalance':
          return (await this.getRawAddressBalance({
            address: operation.address,
          })) as T;
        case 'getTokenTransactions':
          return (await this.getTokenTransactions({
            address: operation.address,
            contractAddress: operation.contractAddress,
            limit: operation.limit,
            since: operation.since,
            until: operation.until,
          })) as T;
        case 'getRawTokenBalances':
          return (await this.getRawTokenBalances({
            address: operation.address,
            contractAddresses: operation.contractAddresses,
          })) as T;
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

  getHealthCheckConfig() {
    const params = new URLSearchParams({
      action: 'ethsupply',
      module: 'stats',
    });

    if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
      params.append('apikey', this.apiKey);
    }

    return {
      endpoint: `?${params.toString()}`,
      validate: (response: unknown) => {
        const data = response as SnowtraceApiResponse<unknown>;
        return !!(data && data.status === '1');
      },
    };
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
        const response = await this.httpClient.get(`?${params.toString()}`);
        const res = response as SnowtraceApiResponse<unknown>;
        if (res.status !== '1') {
          // If no results found or error, break the loop
          if (res.message === 'No transactions found') {
            break;
          }

          this.logger.debug(`No internal transactions found - Message: ${res.message}`);
          break;
        }

        const transactions = (res.result as SnowtraceInternalTransaction[]) || [];
        allTransactions.push(...transactions);

        // If we got less than the max offset, we've reached the end
        if (transactions.length < maxOffset) {
          break;
        }

        page++;
      } catch (_error) {
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

      const response = await this.httpClient.get(`?${params.toString()}`);
      const res = response as SnowtraceApiResponse<unknown>;

      if (res.status !== '1') {
        if (res.message === 'NOTOK' && res.message.includes('Invalid API Key')) {
          throw new ServiceError('Invalid Snowtrace API key', this.name, 'getNormalTransactions');
        }
        // If no results found, break the loop
        if (res.message === 'No transactions found') {
          break;
        }
        throw new ServiceError(`Snowtrace API error: ${res.message}`, this.name, 'getNormalTransactions');
      }

      const transactions = (res.result as SnowtraceTransaction[]) || [];
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

    if (!this.isValidAvalancheAddress(address)) {
      throw new Error(`Invalid Avalanche address: ${address}`);
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

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

      const response = await this.httpClient.get(`?${params.toString()}`);
      const res = response as SnowtraceApiResponse<unknown>;

      if (res.status !== '1') {
        throw new ServiceError(`Failed to fetch AVAX balance: ${res.message}`, this.name, 'getRawAddressBalance');
      }

      this.logger.debug(`Retrieved raw balance for ${maskAddress(address)}: ${String(res.result)} wei`);

      return {
        message: res.message,
        result: typeof res.result === 'string' ? res.result : String(res.result),
        status: res.status,
      } as SnowtraceBalanceResponse;
    } catch (error) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<SnowtraceTransaction[]> {
    const { address, since } = params;

    if (!this.isValidAvalancheAddress(address)) {
      throw new Error(`Invalid Avalanche address: ${address}`);
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    try {
      const normalTransactions = await this.getNormalTransactions(address, since);

      this.logger.debug(`Retrieved ${normalTransactions.length} raw transactions for ${maskAddress(address)}`);

      return normalTransactions;
    } catch (error) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawAddressInternalTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<SnowtraceInternalTransaction[]> {
    const { address, since } = params;

    if (!this.isValidAvalancheAddress(address)) {
      throw new Error(`Invalid Avalanche address: ${address}`);
    }

    this.logger.debug(`Fetching raw address internal transactions - Address: ${maskAddress(address)}`);

    try {
      const internalTransactions = await this.getInternalTransactions(address, since);

      this.logger.debug(
        `Retrieved ${internalTransactions.length} raw internal transactions for ${maskAddress(address)}`
      );

      return internalTransactions;
    } catch (error) {
      this.logger.error(
        `Failed to get raw address internal transactions - Address: ${maskAddress(address)}, Error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  private async getRawTokenBalances(_params: {
    address: string;
    contractAddresses?: string[] | undefined;
  }): Promise<[]> {
    // Snowtrace doesn't have a direct "get all token balances" endpoint
    this.logger.debug('Token balance fetching not implemented for Snowtrace - use specific contract addresses');
    return Promise.resolve([]);
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
        const response = await this.httpClient.get(`?${params.toString()}`);
        const res = response as SnowtraceApiResponse<unknown>;

        if (res.status !== '1') {
          // If no results found or error, break the loop
          if (res.message === 'No transactions found') {
            break;
          }
          this.logger.debug(`No token transfers found - Message: ${res.message}`);
          break;
        }

        const transactions = (res.result as SnowtraceTokenTransfer[]) || [];
        allTransactions.push(...transactions);

        // If we got less than the max offset, we've reached the end
        if (transactions.length < maxOffset) {
          break;
        }

        page++;
      } catch (_error) {
        this.logger.warn(`Failed to fetch token transfers page ${page}`);
        break;
      }
    }

    return allTransactions;
  }

  // Avalanche address validation
  private isValidAvalancheAddress(address: string): boolean {
    // Avalanche C-Chain uses Ethereum-style addresses but they are case-sensitive
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    return ethAddressRegex.test(address);
  }
}
