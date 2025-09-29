import { hasStringProperty, isErrorWithMessage, maskAddress } from '@crypto/shared-utils';

import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.js';
import { RegisterApiClient } from '../../shared/registry/decorators.js';
import type { ProviderOperation } from '../../shared/types.js';
import type { AddressInfo } from '../types.js';

import type { BlockstreamAddressInfo, BlockstreamTransaction } from './blockstream.types.js';

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
      burstLimit: 5,
      requestsPerHour: 3600,
      requestsPerMinute: 60,
      requestsPerSecond: 1.0, // More generous than mempool.space
    },
    retries: 3,
    timeout: 10000,
  },
  description:
    'Bitcoin blockchain explorer API with comprehensive transaction data and pagination support (no API key required)',
  displayName: 'Blockstream.info API',
  name: 'blockstream.info',
  networks: {
    mainnet: {
      baseUrl: 'https://blockstream.info/api',
    },
    testnet: {
      baseUrl: 'https://blockstream.info/testnet/api',
    },
  },
  requiresApiKey: false,
  type: 'rest',
})
export class BlockstreamApiClient extends BaseRegistryProvider {
  constructor() {
    super('bitcoin', 'blockstream.info', 'mainnet');

    this.logger.debug(
      `Initialized BlockstreamApiClient from registry metadata - Network: ${this.network}, BaseUrl: ${this.baseUrl}`
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
        `Operation execution failed - Type: ${operation.type}, Error: ${error instanceof Error ? error.message : String(error)}, Stack: ${error instanceof Error ? error.stack : undefined}`
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

  override async testConnection(): Promise<boolean> {
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

  /**
   * Get lightweight address info for efficient gap scanning
   */
  private async getAddressInfo(params: { address: string }): Promise<AddressInfo> {
    const { address } = params;

    this.logger.debug(`Fetching lightweight address info - Address: ${maskAddress(address)}`);

    try {
      const addressInfo = await this.httpClient.get<BlockstreamAddressInfo>(`/address/${address}`);

      // Calculate transaction count
      const txCount = addressInfo.chain_stats.tx_count + addressInfo.mempool_stats.tx_count;

      // Calculate current balance: funded amount - spent amount
      const chainBalance = addressInfo.chain_stats.funded_txo_sum - addressInfo.chain_stats.spent_txo_sum;
      const mempoolBalance = addressInfo.mempool_stats.funded_txo_sum - addressInfo.mempool_stats.spent_txo_sum;
      const totalBalanceSats = chainBalance + mempoolBalance;

      // Convert satoshis to BTC
      const balanceBTC = (totalBalanceSats / 100000000).toString();

      this.logger.debug(
        `Successfully retrieved lightweight address info - Address: ${maskAddress(address)}, TxCount: ${txCount}, BalanceBTC: ${balanceBTC}`
      );

      return {
        balance: balanceBTC,
        txCount,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get address info - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`
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
  }): Promise<BlockstreamTransaction[]> {
    const { address, since } = params;

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}, Since: ${since}`);

    try {
      // Get address info first to check if there are transactions
      const addressInfo = await this.httpClient.get<BlockstreamAddressInfo>(`/address/${address}`);

      if (addressInfo.chain_stats.tx_count === 0 && addressInfo.mempool_stats.tx_count === 0) {
        this.logger.debug(`No raw transactions found for address - Address: ${maskAddress(address)}`);
        return [];
      }

      // Get transaction list with pagination - return raw transactions directly
      const allRawTransactions: BlockstreamTransaction[] = [];
      let lastSeenTxid: string | undefined;
      let hasMore = true;
      let batchCount = 0;
      const maxBatches = 50; // Safety limit

      while (hasMore && batchCount < maxBatches) {
        const endpoint = lastSeenTxid ? `/address/${address}/txs/chain/${lastSeenTxid}` : `/address/${address}/txs`;

        const rawTransactions = await this.httpClient.get<BlockstreamTransaction[]>(endpoint);

        if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
          hasMore = false;
          break;
        }

        this.logger.debug(
          `Retrieved raw transaction batch - Address: ${maskAddress(address)}, BatchSize: ${rawTransactions.length}, Batch: ${batchCount + 1}`
        );

        // We already have the raw transaction data - no need to fetch again
        const validRawTransactions = rawTransactions.filter((tx): tx is BlockstreamTransaction => tx !== null);
        allRawTransactions.push(...validRawTransactions);

        // Update pagination
        lastSeenTxid = rawTransactions.length > 0 ? rawTransactions[rawTransactions.length - 1]?.txid : undefined;
        hasMore = rawTransactions.length === 25; // Blockstream typically returns 25 per page
        batchCount++;
      }

      // Filter by timestamp if 'since' is provided
      let filteredRawTransactions = allRawTransactions;
      if (since) {
        filteredRawTransactions = allRawTransactions.filter(
          (tx) => (tx.status.block_time || Math.floor(Date.now() / 1000)) >= since
        );
        this.logger.debug(
          `Filtered raw transactions by timestamp - OriginalCount: ${allRawTransactions.length}, FilteredCount: ${filteredRawTransactions.length}, Since: ${since}`
        );
      }

      // Sort by timestamp (newest first)
      filteredRawTransactions.sort((a, b) => {
        const aTime = a.status.block_time || 0;
        const bTime = b.status.block_time || 0;
        return bTime - aTime;
      });

      this.logger.debug(
        `Successfully retrieved raw address transactions - Address: ${maskAddress(address)}, TotalRawTransactions: ${filteredRawTransactions.length}, BatchesProcessed: ${batchCount}`
      );

      return filteredRawTransactions;
    } catch (error) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}
