import { maskAddress } from '@crypto/shared-utils';

import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.ts';
import { RegisterApiClient } from '../../shared/registry/decorators.ts';
import type { ProviderOperation } from '../../shared/types.ts';
import type { MempoolAddressInfo, MempoolTransaction } from '../types.ts';

@RegisterApiClient({
  blockchain: 'bitcoin',
  capabilities: {
    maxBatchSize: 25,
    supportedOperations: ['getRawAddressTransactions', 'getAddressInfo'],
    supportsHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: false,
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 1,
      requestsPerHour: 600,
      requestsPerMinute: 15,
      requestsPerSecond: 0.25, // Conservative: 1 request per 4 seconds
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Bitcoin blockchain explorer API with comprehensive transaction and balance data (no API key required)',
  displayName: 'Mempool.space API',
  name: 'mempool.space',
  networks: {
    mainnet: {
      baseUrl: 'https://mempool.space/api',
    },
    testnet: {
      baseUrl: 'https://mempool.space/testnet/api',
    },
  },
  requiresApiKey: false,
  type: 'rest',
})
export class MempoolSpaceApiClient extends BaseRegistryProvider {
  constructor() {
    super('bitcoin', 'mempool.space', 'mainnet');

    this.logger.debug(
      `Initialized MempoolSpaceApiClient from registry metadata - Network: ${this.network}, BaseUrl: ${this.baseUrl}`
    );
  }

  /**
   * Get raw address info for efficient gap scanning
   */
  private async getAddressInfo(params: { address: string }): Promise<MempoolAddressInfo> {
    const { address } = params;

    this.logger.debug(`Fetching raw address info - Address: ${maskAddress(address)}`);

    try {
      const addressInfo = await this.httpClient.get<MempoolAddressInfo>(`/address/${address}`);

      this.logger.debug(`Successfully retrieved raw address info - Address: ${maskAddress(address)}`);

      return addressInfo;
    } catch (error) {
      this.logger.error(
        `Failed to get raw address info - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Get raw transaction data without transformation for wallet-aware parsing
   */
  private async getRawAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<MempoolTransaction[]> {
    const { address, since } = params;

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    try {
      // Get raw transaction list directly - mempool.space returns full transaction objects
      // No need to check address info first as empty addresses will just return empty array
      const rawTransactions = await this.httpClient.get<MempoolTransaction[]>(`/address/${address}/txs`);

      if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
        this.logger.debug(`No raw transactions found - Address: ${maskAddress(address)}`);
        return [];
      }

      this.logger.debug(
        `Retrieved raw transactions - Address: ${maskAddress(address)}, Count: ${rawTransactions.length}`
      );

      // Filter by timestamp if 'since' is provided
      let filteredTransactions = rawTransactions;
      if (since) {
        filteredTransactions = rawTransactions.filter(tx => {
          const timestamp = tx.status.confirmed && tx.status.block_time ? tx.status.block_time * 1000 : Date.now();
          return timestamp >= since;
        });

        this.logger.debug(
          `Filtered raw transactions by timestamp - OriginalCount: ${rawTransactions.length}, FilteredCount: ${filteredTransactions.length}`
        );
      }

      // Sort by timestamp (newest first)
      filteredTransactions.sort((a, b) => {
        const timestampA = a.status.confirmed && a.status.block_time ? a.status.block_time : 0;
        const timestampB = b.status.confirmed && b.status.block_time ? b.status.block_time : 0;
        return timestampB - timestampA;
      });

      this.logger.debug(
        `Successfully retrieved raw address transactions - Address: ${maskAddress(address)}, TotalTransactions: ${filteredTransactions.length}`
      );

      return filteredTransactions;
    } catch (error) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
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
            since: operation.since,
          }) as T;
        case 'getAddressInfo':
          return this.getAddressInfo({
            address: operation.address,
          }) as T;
        default:
          throw new Error(`Unsupported operation: ${operation.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Operation execution failed - Type: ${operation.type}, Params: ${JSON.stringify(operation)}, Error: ${error instanceof Error ? error.message : String(error)}, Stack: ${error instanceof Error ? error.stack : undefined}`
      );
      throw error;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.httpClient.get<number>('/blocks/tip/height');
      return typeof response === 'number' && response > 0;
    } catch (error) {
      this.logger.warn(`Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test with a simple endpoint that should always work
      const blockHeight = await this.httpClient.get<number>('/blocks/tip/height');
      this.logger.debug(`Connection test successful - CurrentBlockHeight: ${blockHeight}`);
      return typeof blockHeight === 'number' && blockHeight > 0;
    } catch (error) {
      this.logger.error(`Connection test failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
