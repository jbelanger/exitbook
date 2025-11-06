import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../shared/blockchain/base/api-client.js';
import type { ProviderConfig, ProviderOperation } from '../../../shared/blockchain/index.js';
import { RegisterApiClient } from '../../../shared/blockchain/index.js';
import type { RawBalanceData, TransactionWithRawData } from '../../../shared/blockchain/types/index.js';
import { maskAddress } from '../../../shared/blockchain/utils/address-utils.js';
import { transformNearBalance } from '../balance-utils.js';
import { mapNearBlocksTransaction } from '../mapper-utils.js';
import type { NearTransaction } from '../types.js';
import { isValidNearAccountId } from '../utils.js';

import {
  NearBlocksAccountSchema,
  NearBlocksTransactionsResponseSchema,
  type NearBlocksAccount,
  type NearBlocksTransaction,
  type NearBlocksTransactionsResponse,
} from './nearblocks.schemas.js';

@RegisterApiClient({
  apiKeyEnvVar: 'NEARBLOCKS_API_KEY',
  baseUrl: 'https://api.nearblocks.io',
  blockchain: 'near',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 5,
      requestsPerHour: 1000,
      requestsPerMinute: 60,
      requestsPerSecond: 2,
    },
    retries: 3,
    timeout: 30000,
  },
  description: 'NearBlocks API for NEAR blockchain transaction data and account balances',
  displayName: 'NearBlocks',
  name: 'nearblocks',
  requiresApiKey: false,
})
export class NearBlocksApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super(config);

    // Initialize HTTP client with optional API key
    if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
      this.reinitializeHttpClient({
        baseUrl: this.baseUrl,
        defaultHeaders: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
    }
  }

  async execute<T>(operation: ProviderOperation, _config?: Record<string, unknown>): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getAddressTransactions':
        return (await this.getAddressTransactions({
          address: operation.address,
        })) as Result<T, Error>;
      case 'getAddressBalances':
        return (await this.getAddressBalances({
          address: operation.address,
        })) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/v1/stats',
      method: 'GET' as const,
      validate: (response: unknown) => {
        // NearBlocks stats endpoint returns basic chain statistics
        return response !== null && response !== undefined && typeof response === 'object';
      },
    };
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    if (!isValidNearAccountId(address)) {
      return err(new Error(`Invalid NEAR account ID: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<NearBlocksAccount>(`/v1/account/${address}`);

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    // Validate response with schema
    const parseResult = NearBlocksAccountSchema.safeParse(response);
    if (!parseResult.success) {
      return err(new Error('Invalid account data from NearBlocks'));
    }

    const accountData = parseResult.data;
    const balanceData = transformNearBalance(accountData.amount);

    this.logger.debug(
      `Successfully retrieved raw address balance - Address: ${maskAddress(address)}, NEAR: ${balanceData.decimalAmount}`
    );

    return ok(balanceData);
  }

  private async getAddressTransactions(params: {
    address: string;
  }): Promise<Result<TransactionWithRawData<NearTransaction>[], Error>> {
    const { address } = params;

    if (!isValidNearAccountId(address)) {
      return err(new Error(`Invalid NEAR account ID: ${address}`));
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    // Fetch transactions with pagination
    const allTransactions: NearBlocksTransaction[] = [];
    let page = 1;
    const perPage = 50; // Max allowed by NearBlocks
    const maxPages = 20; // Limit to 1000 transactions (20 * 50)

    while (page <= maxPages) {
      const result = await this.httpClient.get<NearBlocksTransactionsResponse>(
        `/v1/account/${address}/txns?page=${page}&per_page=${perPage}`
      );

      if (result.isErr()) {
        // If first page fails, return error
        if (page === 1) {
          this.logger.error(
            `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
          );
          return err(result.error);
        }
        // If subsequent pages fail, break and return what we have
        this.logger.warn(
          `Failed to fetch page ${page} - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
        );
        break;
      }

      const response = result.value;

      // Validate response with schema
      const parseResult = NearBlocksTransactionsResponseSchema.safeParse(response);
      if (!parseResult.success) {
        this.logger.error(`Provider data validation failed on page ${page}`);
        if (page === 1) {
          return err(new Error('Provider data validation failed'));
        }
        break;
      }

      const transactionsData = parseResult.data;

      if (!transactionsData.txns || transactionsData.txns.length === 0) {
        // No more transactions
        break;
      }

      allTransactions.push(...transactionsData.txns);

      this.logger.debug(
        `Fetched page ${page} - Address: ${maskAddress(address)}, Transactions: ${transactionsData.txns.length}`
      );

      // If we got fewer transactions than requested, we've reached the end
      if (transactionsData.txns.length < perPage) {
        break;
      }

      page++;
    }

    this.logger.debug(
      `Total raw transactions fetched - Address: ${maskAddress(address)}, Count: ${allTransactions.length}`
    );

    // Map and normalize transactions
    const transactions: TransactionWithRawData<NearTransaction>[] = [];
    for (const rawTx of allTransactions) {
      const mapResult = mapNearBlocksTransaction(rawTx, { providerName: this.name });

      if (mapResult.isErr()) {
        const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
        this.logger.error(`Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`);
        return err(new Error(`Provider data validation failed: ${errorMessage}`));
      }

      transactions.push({
        normalized: mapResult.value,
        raw: rawTx,
      });
    }

    this.logger.debug(
      `Successfully retrieved and normalized transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}`
    );

    return ok(transactions);
  }
}
