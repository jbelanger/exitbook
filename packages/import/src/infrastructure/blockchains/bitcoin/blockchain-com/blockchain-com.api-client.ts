import { maskAddress } from '@exitbook/shared-utils';

import { BlockchainApiClient } from '../../shared/api/blockchain-api-client.ts';
import { RegisterApiClient } from '../../shared/registry/decorators.js';
import type { ProviderOperation } from '../../shared/types.js';
import type { AddressInfo } from '../types.js';

import type { BlockchainComAddressResponse, BlockchainComTransaction } from './blockchain-com.types.js';

@RegisterApiClient({
  blockchain: 'bitcoin',
  capabilities: {
    maxBatchSize: 1,
    supportedOperations: ['getRawAddressTransactions', 'getAddressInfo'],
    supportsHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: false,
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 1,
      requestsPerHour: 300,
      requestsPerMinute: 10,
      requestsPerSecond: 0.17, // Conservative: 1 request per 6 seconds
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Blockchain.com Bitcoin explorer API with transaction and balance data (no API key required)',
  displayName: 'Blockchain.com API',
  name: 'blockchain.com',
  networks: {
    mainnet: {
      baseUrl: 'https://blockchain.info',
    },
  },
  requiresApiKey: false,
  type: 'rest',
})
export class BlockchainComApiClient extends BlockchainApiClient {
  constructor() {
    super('bitcoin', 'blockchain.com', 'mainnet');

    this.logger.debug(
      `Initialized BlockchainComApiClient from registry metadata - Network: ${this.network}, BaseUrl: ${this.baseUrl}`
    );
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
        case 'getAddressInfo':
          return (await this.getAddressInfo({
            address: operation.address,
          })) as T;
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
      const response = await this.httpClient.get<{ height: number }>('/latestblock');
      return typeof response.height === 'number' && response.height > 0;
    } catch (error) {
      this.logger.warn(`Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Get raw address info for efficient gap scanning
   */
  private async getAddressInfo(params: { address: string }): Promise<AddressInfo> {
    const { address } = params;

    this.logger.debug(`Fetching raw address info - Address: ${maskAddress(address)}`);

    try {
      const addressInfo = await this.httpClient.get<BlockchainComAddressResponse>(`/rawaddr/${address}?limit=0`);

      // Convert satoshis to BTC
      const balanceBTC = (addressInfo.final_balance / 100000000).toString();

      this.logger.debug(`Successfully retrieved raw address info - Address: ${maskAddress(address)}`);

      return {
        balance: balanceBTC,
        txCount: addressInfo.n_tx,
      };
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
  }): Promise<BlockchainComTransaction[]> {
    const { address, since } = params;

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    try {
      // Use limit=50 to get the maximum transactions per request
      const addressData = await this.httpClient.get<BlockchainComAddressResponse>(`/rawaddr/${address}?limit=50`);

      if (!addressData.txs || addressData.txs.length === 0) {
        this.logger.debug(`No raw transactions found - Address: ${maskAddress(address)}`);
        return [];
      }

      let filteredTransactions = addressData.txs;

      // Filter by timestamp if 'since' is provided
      if (since) {
        filteredTransactions = addressData.txs.filter((tx) => {
          const timestamp = tx.time * 1000; // Convert to milliseconds
          return timestamp >= since;
        });

        this.logger.debug(
          `Filtered raw transactions by timestamp - OriginalCount: ${addressData.txs.length}, FilteredCount: ${filteredTransactions.length}`
        );
      }

      // Sort by timestamp (newest first)
      filteredTransactions.sort((a, b) => b.time - a.time);

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
}
