import { hasStringProperty, isErrorWithMessage, maskAddress } from '@crypto/shared-utils';

import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.ts';
import { RegisterProvider } from '../../shared/registry/decorators.ts';
import type { ProviderOperation } from '../../shared/types.ts';
import type { BlockCypherAddress, BlockCypherTransaction } from '../types.ts';

@RegisterProvider({
  apiKeyEnvVar: 'BLOCKCYPHER_API_KEY',
  blockchain: 'bitcoin',
  capabilities: {
    maxBatchSize: 50,
    supportedOperations: ['getRawAddressTransactions', 'getAddressInfo'],
    supportsHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: false,
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 5,
      requestsPerHour: 10800,
      requestsPerMinute: 180,
      requestsPerSecond: 3.0, // API key dependent - 3 req/sec for free tier
    },
    retries: 3,
    timeout: 15000, // Longer timeout for BlockCypher
  },
  description:
    'Bitcoin blockchain API with high-performance transaction data and balance queries (requires API key for full functionality)',
  displayName: 'BlockCypher API',
  name: 'blockcypher',
  networks: {
    mainnet: {
      baseUrl: 'https://api.blockcypher.com/v1/btc/main',
    },
    testnet: {
      baseUrl: 'https://api.blockcypher.com/v1/btc/test3',
    },
  },
  requiresApiKey: true,
  type: 'rest',
})
export class BlockCypherApiClient extends BaseRegistryProvider {
  constructor() {
    super('bitcoin', 'blockcypher', 'mainnet');

    this.logger.debug(
      `Initialized BlockCypherApiClient from registry metadata - Network: ${this.network}, BaseUrl: ${this.baseUrl}, HasApiKey: ${this.apiKey !== 'YourApiKeyToken'}`
    );
  }

  private buildEndpoint(endpoint: string): string {
    if (this.apiKey) {
      const separator = endpoint.includes('?') ? '&' : '?';
      return `${endpoint}${separator}token=${this.apiKey}`;
    }
    return endpoint;
  }

  /**
   * Get raw address info
   */
  private async getAddressInfo(params: { address: string }): Promise<BlockCypherAddress> {
    const { address } = params;

    this.logger.debug(`Fetching raw address info - Address: ${maskAddress(address)}`);

    try {
      const addressInfo = await this.httpClient.get<BlockCypherAddress>(
        this.buildEndpoint(`/addrs/${address}/balance`)
      );

      this.logger.debug(
        `Successfully retrieved raw address info - Address: ${maskAddress(address)}, TxCount: ${addressInfo.final_n_tx}, Balance: ${addressInfo.final_balance}`
      );

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
  }): Promise<BlockCypherTransaction[]> {
    const { address, since } = params;

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}, Since: ${since}`);

    try {
      // Get address info with transaction references
      const addressInfo = await this.httpClient.get<BlockCypherAddress>(
        this.buildEndpoint(`/addrs/${address}?limit=50`)
      );

      if (!addressInfo.txrefs || addressInfo.txrefs.length === 0) {
        this.logger.debug(`No raw transactions found for address - Address: ${maskAddress(address)}`);
        return [];
      }

      this.logger.debug(
        `Retrieved transaction references - Address: ${maskAddress(address)}, Count: ${addressInfo.txrefs.length}`
      );

      // Extract unique transaction hashes
      const uniqueTxHashes = Array.from(new Set(addressInfo.txrefs.map(ref => ref.tx_hash)));

      // Fetch detailed raw transaction data
      const rawTransactions: BlockCypherTransaction[] = [];

      // Process transactions in batches to respect rate limits
      const batchSize = this.capabilities.maxBatchSize!;
      for (let i = 0; i < uniqueTxHashes.length; i += batchSize) {
        const batch = uniqueTxHashes.slice(i, i + batchSize);

        const batchTransactions = await Promise.all(
          batch.map(async txHash => {
            try {
              const rawTx = await this.httpClient.get<BlockCypherTransaction>(this.buildEndpoint(`/txs/${txHash}`));
              return rawTx;
            } catch (error) {
              this.logger.warn(
                `Failed to fetch raw transaction details - TxHash: ${txHash}, Error: ${error instanceof Error ? error.message : String(error)}`
              );
              return null;
            }
          })
        );

        rawTransactions.push(...batchTransactions.filter((tx): tx is BlockCypherTransaction => tx !== null));

        // Rate limiting between batches
        if (i + batchSize < uniqueTxHashes.length) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between batches
        }
      }

      // Filter by timestamp if 'since' is provided
      let filteredRawTransactions = rawTransactions;
      if (since) {
        filteredRawTransactions = rawTransactions.filter(tx => {
          const confirmedTime = tx.confirmed ? new Date(tx.confirmed).getTime() : Date.now();
          return confirmedTime >= since;
        });
        this.logger.debug(
          `Filtered raw transactions by timestamp - OriginalCount: ${rawTransactions.length}, FilteredCount: ${filteredRawTransactions.length}, Since: ${since}`
        );
      }

      // Sort by timestamp (newest first)
      filteredRawTransactions.sort((a, b) => {
        const aTime = a.confirmed ? new Date(a.confirmed).getTime() : 0;
        const bTime = b.confirmed ? new Date(b.confirmed).getTime() : 0;
        return bTime - aTime;
      });

      this.logger.debug(
        `Successfully retrieved raw address transactions - Address: ${maskAddress(address)}, TotalRawTransactions: ${filteredRawTransactions.length}`
      );

      return filteredRawTransactions;
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
        `Operation execution failed - Type: ${operation.type}, Error: ${error instanceof Error ? error.message : String(error)}, Stack: ${error instanceof Error ? error.stack : undefined}`
      );
      throw error;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.httpClient.get<{ name?: string }>('/');
      return hasStringProperty(response, 'name');
    } catch (error) {
      this.logger.warn(`Health check failed - Error: ${isErrorWithMessage(error) ? error.message : String(error)}`);
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test with a simple endpoint that should always work
      const chainInfo = await this.httpClient.get<{ name?: string }>('/');
      this.logger.debug(`Connection test successful - ChainInfo: ${chainInfo?.name || 'Unknown'}`);
      return hasStringProperty(chainInfo, 'name');
    } catch (error) {
      this.logger.error(`Connection test failed - Error: ${isErrorWithMessage(error) ? error.message : String(error)}`);
      return false;
    }
  }
}
