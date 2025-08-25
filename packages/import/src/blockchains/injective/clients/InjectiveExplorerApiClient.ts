import { maskAddress } from '@crypto/shared-utils';

import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.ts';
import { RegisterProvider } from '../../shared/registry/decorators.ts';
import type { ProviderOperation } from '../../shared/types.ts';
import type { InjectiveApiResponse, InjectiveTransaction } from '../types.ts';

@RegisterProvider({
  blockchain: 'injective',
  capabilities: {
    maxBatchSize: 1,
    supportedOperations: ['getRawAddressTransactions'],
    supportsHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: true,
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 5,
      requestsPerHour: 500,
      requestsPerMinute: 60,
      requestsPerSecond: 2,
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Direct connection to Injective Protocol blockchain explorer with comprehensive transaction data',
  displayName: 'Injective Explorer API',
  name: 'injective-explorer',
  networks: {
    mainnet: {
      baseUrl: 'https://sentry.exchange.grpc-web.injective.network',
    },
    testnet: {
      baseUrl: 'https://k8s.testnet.tm.injective.network',
    },
  },
  requiresApiKey: false,
  type: 'rest',
})
export class InjectiveExplorerApiClient extends BaseRegistryProvider {
  constructor() {
    super('injective', 'injective-explorer', 'mainnet');

    this.logger.debug(
      `Initialized InjectiveExplorerApiClient from registry metadata - Network: ${this.network}, BaseUrl: ${this.baseUrl}`
    );
  }

  private async getRawAddressTransactions(params: {
    address: string;
    since?: number;
  }): Promise<InjectiveTransaction[]> {
    const { address, since } = params;

    if (!this.validateAddress(address)) {
      throw new Error(`Invalid Injective address: ${address}`);
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}, Network: ${this.network}`);

    try {
      const endpoint = `/api/explorer/v1/accountTxs/${address}`;
      const data = (await this.httpClient.get(endpoint)) as InjectiveApiResponse;

      if (!data.data || !Array.isArray(data.data)) {
        return [];
      }

      let transactions = data.data;

      // Apply time filter if specified
      if (since) {
        transactions = transactions.filter(tx => {
          const timestamp = new Date(tx.block_timestamp).getTime();
          return timestamp >= since;
        });
      }

      this.logger.debug(
        `Successfully retrieved raw address transactions - Address: ${maskAddress(address)}, TotalTransactions: ${transactions.length}, Network: ${this.network}`
      );

      return transactions;
    } catch (error) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private validateAddress(address: string): boolean {
    // Injective addresses start with 'inj' and are bech32 encoded
    const injectiveAddressRegex = /^inj1[a-z0-9]{38}$/;
    return injectiveAddressRegex.test(address);
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address as string) : 'N/A'}`
    );

    try {
      switch (operation.type) {
        case 'getRawAddressTransactions':
          return this.getRawAddressTransactions({
            address: operation.address,
            ...(operation.since !== undefined && { since: operation.since }),
          }) as T;
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
      // Test with a known address to check if the API is responsive
      const testAddress = 'inj1qq6hgelyft8z5fnm6vyyn3ge3w2nway4ykdf6a'; // Injective Foundation address
      const endpoint = `/api/explorer/v1/accountTxs/${testAddress}`;

      const response = await this.httpClient.get<unknown>(endpoint);
      return Boolean(response && typeof response === 'object');
    } catch (error) {
      this.logger.warn(`Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const result = await this.isHealthy();
      this.logger.debug(`Connection test result - Healthy: ${result}`);
      return result;
    } catch (error) {
      this.logger.error(`Connection test failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
