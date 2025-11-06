import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { ProviderConfig, ProviderOperation } from '../../../../shared/blockchain/index.js';
import { BaseApiClient, RegisterApiClient } from '../../../../shared/blockchain/index.js';
import type { TransactionWithRawData } from '../../../../shared/blockchain/types/index.js';
import { maskAddress } from '../../../../shared/blockchain/utils/address-utils.js';
import type { EvmTransaction } from '../../types.js';

import { ThetaExplorerTransactionMapper } from './theta-explorer.mapper.js';
import type { ThetaTransaction, ThetaAccountTxResponse } from './theta-explorer.schemas.js';

@RegisterApiClient({
  baseUrl: 'https://explorer-api.thetatoken.org/api',
  blockchain: 'theta',
  capabilities: {
    supportedOperations: ['getAddressTransactions'],
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
export class ThetaExplorerApiClient extends BaseApiClient {
  private mapper: ThetaExplorerTransactionMapper;

  constructor(config: ProviderConfig) {
    super(config);
    this.mapper = new ThetaExplorerTransactionMapper();
  }

  async execute<T>(operation: ProviderOperation): Promise<Result<T, Error>> {
    this.logger.debug(`Executing operation: ${operation.type}`);

    switch (operation.type) {
      case 'getAddressTransactions': {
        const { address } = operation;
        this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);
        return (await this.getAddressTransactions(address)) as Result<T, Error>;
      }
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
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

  private async getAddressTransactions(
    address: string
  ): Promise<Result<TransactionWithRawData<EvmTransaction>[], Error>> {
    const result = await this.getTransactions(address);

    if (result.isErr()) {
      this.logger.error(
        `Failed to fetch raw address transactions for ${address} - Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const rawTransactions = result.value;

    if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
      this.logger.debug(`No raw transactions found - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    const transactions: TransactionWithRawData<EvmTransaction>[] = [];
    for (const rawTx of rawTransactions) {
      const mapResult = this.mapper.map(rawTx, {});

      if (mapResult.isErr()) {
        const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
        this.logger.error(`Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`);
        return err(new Error(`Provider data validation failed: ${errorMessage}`));
      }

      transactions.push({
        raw: rawTx,
        normalized: mapResult.value,
      });
    }

    this.logger.debug(
      `Successfully retrieved and normalized transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}`
    );
    return ok(transactions);
  }

  private async getTransactions(address: string): Promise<Result<ThetaTransaction[], Error>> {
    const transactions: ThetaTransaction[] = [];
    let currentPage = 1;
    const limitPerPage = 100;
    let hasMorePages = true;

    while (hasMorePages) {
      const params = new URLSearchParams({
        limitNumber: limitPerPage.toString(),
        pageNumber: currentPage.toString(),
      });

      const result = await this.httpClient.get<ThetaAccountTxResponse>(
        `/accounttx/${address.toLowerCase()}?${params.toString()}`
      );

      if (result.isErr()) {
        // Theta Explorer returns 404 when no transactions are found for a type
        if (result.error.message.includes('HTTP 404')) {
          this.logger.debug(`No transactions found for ${maskAddress(address)}`);
          break;
        }
        return err(result.error);
      }

      const response = result.value;
      const pageTxs = response.body || [];
      transactions.push(...pageTxs);

      this.logger.debug(`Fetched page ${currentPage}/${response.totalPageNumber}: ${pageTxs.length} transactions`);

      hasMorePages = currentPage < response.totalPageNumber;
      currentPage++;

      if (currentPage > 100) {
        this.logger.warn('Reached maximum page limit (100), stopping pagination');
        break;
      }
    }

    return ok(transactions);
  }
}
