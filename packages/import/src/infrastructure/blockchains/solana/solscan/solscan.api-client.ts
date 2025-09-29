import { maskAddress } from '@exitbook/shared-utils';

import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.js';
import { RegisterApiClient } from '../../shared/registry/decorators.js';
import type { ProviderOperation } from '../../shared/types.js';
import { isValidSolanaAddress } from '../utils.js';

import type { SolscanTransaction, SolscanResponse } from './solscan.types.js';

export interface SolscanRawTransactionData {
  normal: SolscanTransaction[];
}

export interface SolscanRawBalanceData {
  lamports: string;
}

@RegisterApiClient({
  apiKeyEnvVar: 'SOLSCAN_API_KEY',
  blockchain: 'solana',
  capabilities: {
    maxBatchSize: 1,
    supportedOperations: ['getRawAddressTransactions', 'getRawAddressBalance'],
    supportsHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: true,
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 1,
      requestsPerSecond: 0.2, // Conservative: 1 request per 5 seconds
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Solana blockchain explorer API with transaction and account data access',
  displayName: 'Solscan API',
  name: 'solscan',
  networks: {
    devnet: {
      baseUrl: 'https://api.solscan.io',
    },
    mainnet: {
      baseUrl: 'https://public-api.solscan.io',
    },
    testnet: {
      baseUrl: 'https://api.solscan.io',
    },
  },
  requiresApiKey: false,
  type: 'rest',
})
export class SolscanApiClient extends BaseRegistryProvider {
  constructor() {
    super('solana', 'solscan', 'mainnet');

    // Override HTTP client to add browser-like headers for Solscan
    this.reinitializeHttpClient({
      defaultHeaders: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        Connection: 'keep-alive',
        'Content-Type': 'application/json',
        DNT: '1',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(this.apiKey &&
          this.apiKey !== 'YourApiKeyToken' && {
            Authorization: `Bearer ${this.apiKey}`,
          }),
      },
    });
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
        case 'getRawAddressBalance':
          return (await this.getRawAddressBalance({
            address: operation.address,
          })) as T;
        default:
          throw new Error(`Unsupported operation: ${operation.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Operation execution failed - Type: ${operation.type}, Error: ${error instanceof Error ? error.message : String(error)}, Stack: ${error instanceof Error ? error.stack : undefined}`
      );
      throw error;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.httpClient.get<SolscanResponse>(
        '/account/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      );
      return response && response.success !== false;
    } catch (error) {
      this.logger.warn(`Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async getRawAddressBalance(params: { address: string }): Promise<SolscanRawBalanceData> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}, Network: ${this.network}`);

    try {
      const response = await this.httpClient.get<SolscanResponse<{ lamports: string }>>(`/account/${address}`);

      if (!response || !response.success || !response.data) {
        throw new Error('Failed to fetch balance from Solscan API');
      }

      this.logger.debug(
        `Successfully retrieved raw address balance - Address: ${maskAddress(address)}, Lamports: ${response.data.lamports}, Network: ${this.network}`
      );

      return { lamports: response.data.lamports || '0' };
    } catch (error) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<SolscanRawTransactionData> {
    const { address, since } = params;

    if (!isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }

    this.logger.debug(
      `Fetching raw address transactions - Address: ${maskAddress(address)}, Since: ${since}, Network: ${this.network}`
    );

    try {
      const response = await this.httpClient.get<SolscanResponse<SolscanTransaction[]>>(
        `/account/transaction?address=${address}&limit=100&offset=0`
      );

      this.logger.debug(
        `Solscan API response received - HasResponse: ${!!response}, Success: ${response?.success}, HasData: ${!!response?.data}, TransactionCount: ${response?.data?.length || 0}`
      );

      if (!response || !response.success || !response.data) {
        this.logger.debug(`No raw transactions found or API error - Address: ${maskAddress(address)}`);
        return { normal: [] };
      }

      // Filter by since if provided
      const filteredTransactions = since ? response.data.filter((tx) => tx.blockTime * 1000 >= since) : response.data;

      this.logger.debug(
        `Successfully retrieved raw address transactions - Address: ${maskAddress(address)}, TotalTransactions: ${filteredTransactions.length}, Network: ${this.network}`
      );

      return { normal: filteredTransactions };
    } catch (error) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}
