import { BaseApiClient } from '../../../core/blockchain/base/api-client.ts';
import type { ProviderConfig } from '../../../core/blockchain/index.ts';
import { RegisterApiClient } from '../../../core/blockchain/index.ts';
import type { ProviderOperation } from '../../../core/blockchain/types/index.ts';
import { maskAddress } from '../../../core/blockchain/utils/address-utils.ts';
import type { AddressInfo } from '../types.js';

import type { BlockstreamAddressInfo, BlockstreamTransaction } from './blockstream.types.js';

@RegisterApiClient({
  apiKeyEnvVar: 'BLOCKSTREAM_API_KEY',
  baseUrl: 'https://blockstream.info/api',
  blockchain: 'bitcoin',
  capabilities: {
    supportedOperations: ['getRawAddressTransactions', 'getAddressInfo'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 15,
      requestsPerHour: 12960,
      requestsPerMinute: 216,
      requestsPerSecond: 4,
    },
    retries: 3,
    timeout: 10000,
  },
  description:
    'Bitcoin blockchain explorer API with comprehensive transaction data and pagination support (no API key required)',
  displayName: 'Blockstream.info API',
  name: 'blockstream.info',
  requiresApiKey: false,
})
export class BlockstreamApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super(config);

    this.logger.debug(`Initialized BlockstreamApiClient from registry metadata - BaseUrl: ${this.baseUrl}`);
  }

  async execute<T>(operation: ProviderOperation): Promise<T> {
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

  getHealthCheckConfig() {
    return {
      endpoint: '/blocks/tip/height',
      validate: (response: unknown) => {
        return typeof response === 'number' && response > 0;
      },
    };
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

      this.logger.debug(
        `Successfully retrieved raw address transactions - Address: ${maskAddress(address)}, TotalRawTransactions: ${allRawTransactions.length}, BatchesProcessed: ${batchCount}`
      );

      return allRawTransactions;
    } catch (error) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}
