import { maskAddress } from '@exitbook/shared-utils';

import type { ProviderConfig } from '../../../shared/index.ts';
import { RegisterApiClient, BlockchainApiClient } from '../../../shared/index.ts';
import type { ProviderOperation } from '../../../shared/types.ts';

import type { ThetaTransaction, ThetaAccountTxResponse } from './theta-explorer.types.ts';

@RegisterApiClient({
  baseUrl: 'https://explorer-api.thetatoken.org/api',
  blockchain: 'theta',
  capabilities: {
    supportedOperations: ['getRawAddressTransactions'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 10,
      requestsPerHour: 3600,
      requestsPerMinute: 60,
      requestsPerSecond: 1,
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Theta Explorer API for transaction and account data',
  displayName: 'Theta Explorer',
  name: 'theta-explorer',
  requiresApiKey: false,
})
export class ThetaExplorerApiClient extends BlockchainApiClient {
  constructor(config: ProviderConfig) {
    super(config);
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(`Executing operation: ${operation.type}`);

    switch (operation.type) {
      case 'getRawAddressTransactions': {
        const { address, since } = operation;
        this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);
        return this.getRawAddressTransactions(address, since) as Promise<T>;
      }
      default:
        throw new Error(`Unsupported operation: ${operation.type}`);
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/supply/theta',
      method: 'GET' as const,
      validate: (response: unknown) => {
        const data = response as { total_supply?: number };
        return data && typeof data.total_supply === 'number';
      },
    };
  }

  private async getRawAddressTransactions(address: string, _since?: number): Promise<ThetaTransaction[]> {
    try {
      const allTransactions: ThetaTransaction[] = [];

      const allTypeTxs = await this.getTransactions(address);
      allTransactions.push(...allTypeTxs);

      this.logger.debug(`Found ${allTransactions.length} total transactions for ${address} (${allTypeTxs.length})`);
      return allTransactions;
    } catch (error) {
      this.logger.error(
        `Failed to fetch raw address transactions for ${address} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getTransactions(address: string): Promise<ThetaTransaction[]> {
    const transactions: ThetaTransaction[] = [];
    let currentPage = 1;
    const limitPerPage = 100;
    let hasMorePages = true;

    while (hasMorePages) {
      const params = new URLSearchParams({
        isEqualType: 'false',
        limitNumber: limitPerPage.toString(),
        pageNumber: currentPage.toString(),
      });

      try {
        const response = await this.httpClient.get<ThetaAccountTxResponse>(
          `/accounttx/${address.toLowerCase()}?${params.toString()}`
        );

        const pageTxs = response.body || [];
        transactions.push(...pageTxs);

        this.logger.debug(`Fetched page ${currentPage}/${response.totalPageNumber}: ${pageTxs.length} transactions`);

        hasMorePages = currentPage < response.totalPageNumber;
        currentPage++;

        if (currentPage > 100) {
          this.logger.warn('Reached maximum page limit (100), stopping pagination');
          break;
        }
      } catch (error) {
        // Theta Explorer returns 404 when no transactions are found for a type
        if (error instanceof Error && error.message.includes('HTTP 404')) {
          this.logger.debug(`No transactions found for ${maskAddress(address)}`);
          break;
        }
        throw error;
      }
    }

    return transactions;
  }
}
