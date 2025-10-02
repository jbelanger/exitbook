import { maskAddress } from '@exitbook/shared-utils';

import { BlockchainApiClient } from '../../../shared/api/blockchain-api-client.ts';
import type { ProviderConfig } from '../../../shared/index.ts';
import { RegisterApiClient } from '../../../shared/registry/decorators.js';
import type { ProviderOperation } from '../../../shared/types.js';
import type { CosmosChainConfig } from '../../chain-config.interface.js';

import type { InjectiveExplorerTransaction } from './injective-explorer.types.js';

@RegisterApiClient({
  baseUrl: 'https://sentry.exchange.grpc-web.injective.network',
  blockchain: 'injective',
  capabilities: {
    supportedOperations: ['getRawAddressTransactions'],
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
  requiresApiKey: false,
  supportedChains: ['injective'],
})
export class InjectiveExplorerApiClient extends BlockchainApiClient {
  private chainConfig: CosmosChainConfig;

  constructor(config: ProviderConfig, chainConfig?: CosmosChainConfig) {
    super(config);

    // Use provided chainConfig or default to Injective
    this.chainConfig = chainConfig || {
      bech32Prefix: 'inj',
      chainId: 'injective-1',
      chainName: 'injective',
      displayName: 'Injective Protocol',
      explorerUrls: ['https://explorer.injective.network'],
      nativeCurrency: 'INJ',
      nativeDecimals: 18,
      restEndpoints: ['https://lcd.injective.network'],
      rpcEndpoints: ['https://tm.injective.network'],
    };

    this.logger.debug(
      `Initialized InjectiveExplorerApiClient for chain: ${this.chainConfig.chainName} - BaseUrl: ${this.baseUrl}`
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
            ...(operation.since !== undefined && { since: operation.since }),
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
    const testAddress = 'inj1qq6hgelyft8z5fnm6vyyn3ge3w2nway4ykdf6a';
    return {
      endpoint: `/api/explorer/v1/accountTxs/${testAddress}`,
      validate: (response: unknown) => {
        return Boolean(response && typeof response === 'object');
      },
    };
  }

  private async getRawAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<InjectiveExplorerTransaction[]> {
    const { address, since } = params;

    if (!this.validateAddress(address)) {
      throw new Error(`Invalid ${this.chainConfig.displayName} address: ${address}`);
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    try {
      const endpoint = `/api/explorer/v1/accountTxs/${address}`;
      const data = await this.httpClient.get(endpoint);

      // Assert the expected structure of the response
      const response = data as { data?: unknown[] };

      if (!response.data || !Array.isArray(response.data)) {
        return [];
      }

      let transactions = response.data;

      // Apply time filter if specified
      if (since) {
        transactions = transactions.filter((tx) => {
          if (
            typeof tx === 'object' &&
            tx !== null &&
            'block_timestamp' in tx &&
            (typeof (tx as { block_timestamp?: unknown }).block_timestamp === 'string' ||
              typeof (tx as { block_timestamp?: unknown }).block_timestamp === 'number')
          ) {
            const timestamp = new Date((tx as { block_timestamp: string | number }).block_timestamp).getTime();
            return timestamp >= since;
          }
          return false;
        });
      }

      this.logger.debug(
        `Successfully retrieved raw address transactions - Address: ${maskAddress(address)}, TotalTransactions: ${transactions.length}`
      );

      return transactions as InjectiveExplorerTransaction[];
    } catch (error) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private validateAddress(address: string): boolean {
    // Use bech32Prefix from chainConfig for validation
    const addressRegex = new RegExp(`^${this.chainConfig.bech32Prefix}1[a-z0-9]{38}$`);
    return addressRegex.test(address);
  }
}
