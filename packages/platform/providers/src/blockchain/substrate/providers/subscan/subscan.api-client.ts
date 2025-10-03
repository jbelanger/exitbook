import { maskAddress } from '@exitbook/shared-utils';

import { BaseApiClient } from '../../../../core/blockchain/base/api-client.ts';
import type { ProviderConfig, ProviderOperation } from '../../../../core/blockchain/index.ts';
import { RegisterApiClient } from '../../../../core/blockchain/index.ts';
import type { SubstrateChainConfig } from '../../chain-config.interface.ts';
import { getSubstrateChainConfig } from '../../chain-registry.ts';
import { isValidSS58Address } from '../../utils.ts';

import type { SubscanAccountResponse, SubscanTransferAugmented, SubscanTransfersResponse } from './subscan.types.ts';

/**
 * Maps blockchain names to Subscan-specific subdomain identifiers
 */
const CHAIN_SUBDOMAIN_MAP: Record<string, string> = {
  kusama: 'kusama',
  polkadot: 'polkadot',
};

@RegisterApiClient({
  baseUrl: 'https://polkadot.api.subscan.io',
  blockchain: 'polkadot',
  capabilities: {
    supportedOperations: ['getRawAddressTransactions', 'getRawAddressBalance'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 4,
      requestsPerHour: 500,
      requestsPerMinute: 120,
      requestsPerSecond: 2,
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Polkadot and Kusama networks provider with Subscan API integration',
  displayName: 'Subscan',
  name: 'subscan',
  requiresApiKey: false,
  supportedChains: ['polkadot', 'kusama'],
})
export class SubscanApiClient extends BaseApiClient {
  private readonly chainConfig: SubstrateChainConfig;
  private readonly subscanSubdomain: string;

  constructor(config: ProviderConfig) {
    super(config);

    // Get chain config
    const chainConfig = getSubstrateChainConfig(config.blockchain);
    if (!chainConfig) {
      throw new Error(`Unsupported blockchain for Subscan provider: ${config.blockchain}`);
    }
    this.chainConfig = chainConfig;

    // Map to Subscan subdomain
    const mappedSubdomain = CHAIN_SUBDOMAIN_MAP[config.blockchain];
    if (!mappedSubdomain) {
      throw new Error(`No Subscan subdomain mapping for blockchain: ${config.blockchain}`);
    }
    this.subscanSubdomain = mappedSubdomain;

    // Override base URL with chain-specific subdomain
    this.reinitializeHttpClient({
      baseUrl: `https://${this.subscanSubdomain}.api.subscan.io`,
    });

    this.logger.debug(
      `Initialized SubscanApiClient for ${config.blockchain} - Subdomain: ${this.subscanSubdomain}, BaseUrl: ${this.baseUrl}, TokenSymbol: ${this.chainConfig.nativeCurrency}`
    );
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(`Executing operation: ${operation.type}`);

    switch (operation.type) {
      case 'getRawAddressTransactions': {
        const { address, since } = operation;
        this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);
        return this.getRawAddressTransactions(address, since) as Promise<T>;
      }
      case 'getRawAddressBalance': {
        const { address } = operation;
        this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);
        return this.getRawAddressBalance(address) as Promise<T>;
      }
      default:
        throw new Error(`Unsupported operation: ${operation.type}`);
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/api/scan/metadata',
      method: 'POST' as const,
      body: {},
      validate: (response: unknown) => {
        const data = response as { code?: number };
        return data && data.code === 0;
      },
    };
  }

  private async getRawAddressBalance(address: string): Promise<SubscanAccountResponse> {
    // Validate address format
    if (!isValidSS58Address(address)) {
      throw new Error(`Invalid SS58 address for ${this.blockchain}: ${address}`);
    }

    try {
      const response = await this.httpClient.post<SubscanAccountResponse>('/api/scan/account', {
        key: address,
      });

      // Check for API errors
      if (response.code !== 0) {
        throw new Error(`Subscan API error: ${response.message || `Code ${response.code}`}`);
      }

      // Log balance info if available, otherwise log account hex
      if (response.data?.balance !== undefined || response.data?.reserved !== undefined) {
        this.logger.debug(
          `Found raw balance for ${maskAddress(address)}: ${response.data?.balance || '0'} (reserved: ${response.data?.reserved || '0'})`
        );
      } else if (response.data?.account) {
        this.logger.debug(
          `Found raw account data for ${maskAddress(address)}: ${response.data.account.substring(0, 16)}...`
        );
      } else {
        this.logger.debug(`Found raw account data for ${maskAddress(address)}: no balance data available`);
      }

      return response;
    } catch (error) {
      this.logger.error(
        `Failed to fetch raw address balance for ${maskAddress(address)} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawAddressTransactions(address: string, since?: number): Promise<SubscanTransferAugmented[]> {
    // Validate address format
    if (!isValidSS58Address(address)) {
      throw new Error(`Invalid SS58 address for ${this.blockchain}: ${address}`);
    }

    try {
      const transfers: SubscanTransferAugmented[] = [];
      let page = 0;
      const maxPages = 100; // Safety limit to prevent infinite loops
      const rowsPerPage = 100;
      let hasMorePages = true;

      do {
        const body: Record<string, unknown> = {
          address: address,
          page: page,
          row: rowsPerPage,
        };

        // Note: Subscan API does not support timestamp-based filtering via 'since' parameter
        // The 'since' parameter is accepted but ignored for now
        // Filtering happens client-side after fetching all transactions
        // Alternative would be to use 'block_range' if block numbers are known

        const response = await this.httpClient.post<SubscanTransfersResponse>('/api/v2/scan/transfers', body);

        // Check for API errors
        if (response.code !== 0) {
          throw new Error(`Subscan API error: ${response.message || `Code ${response.code}`}`);
        }

        const pageTransfers = response.data?.transfers || [];

        // Augment transfers with chain config data
        const augmentedTransfers = pageTransfers.map((tx) => ({
          ...tx,
          _nativeCurrency: this.chainConfig.nativeCurrency,
          _nativeDecimals: this.chainConfig.nativeDecimals,
          _chainDisplayName: this.chainConfig.displayName,
        })) as SubscanTransferAugmented[];

        transfers.push(...augmentedTransfers);
        page++;

        // Check if there are more pages
        // Subscan doesn't return a cursor, so we check if we got a full page
        hasMorePages = pageTransfers.length === rowsPerPage;

        this.logger.debug(
          `Fetched page ${page}: ${pageTransfers.length} transfers${hasMorePages ? ' (more pages available)' : ' (last page)'}`
        );

        // Safety check to prevent infinite pagination
        if (page >= maxPages) {
          this.logger.warn(`Reached maximum page limit (${maxPages}), stopping pagination`);
          break;
        }
      } while (hasMorePages);

      // Client-side filtering by timestamp if 'since' parameter provided
      // (API doesn't support server-side timestamp filtering)
      let filteredTransfers = transfers;
      if (since) {
        const sinceSeconds = Math.floor(since / 1000);
        filteredTransfers = transfers.filter((tx) => tx.block_timestamp >= sinceSeconds);
        this.logger.debug(
          `Filtered ${filteredTransfers.length}/${transfers.length} transactions after timestamp ${sinceSeconds}`
        );
      }

      this.logger.debug(`Found ${filteredTransfers.length} total raw address transactions for ${maskAddress(address)}`);
      return filteredTransfers;
    } catch (error) {
      this.logger.error(
        `Failed to fetch raw address transactions for ${maskAddress(address)} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}
