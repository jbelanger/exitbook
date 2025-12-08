import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { ProviderConfig, ProviderOperation, StreamingBatchResult } from '../../../../core/index.js';
import { BaseApiClient, RegisterApiClient } from '../../../../core/index.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../core/streaming/streaming-adapter.js';
import type { RawBalanceData, TransactionWithRawData } from '../../../../core/types/index.js';
import { maskAddress } from '../../../../core/utils/address-utils.js';
import { convertToMainUnit, createRawBalanceData } from '../../balance-utils.js';
import type { SubstrateChainConfig } from '../../chain-config.interface.js';
import { getSubstrateChainConfig } from '../../chain-registry.js';
import type { SubstrateTransaction } from '../../types.js';
import { isValidSS58Address } from '../../utils.js';

import { convertTaostatsTransaction, isTransactionRelevant } from './taostats.mapper-utils.js';
import type { TaostatsBalanceResponse, TaostatsTransaction } from './taostats.schemas.js';
import { TaostatsBalanceResponseSchema, TaostatsTransactionsResponseSchema } from './taostats.schemas.js';

@RegisterApiClient({
  apiKeyEnvVar: 'TAOSTATS_API_KEY',
  baseUrl: 'https://api.taostats.io/api',
  blockchain: 'bittensor',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
    supportedCursorTypes: ['blockNumber', 'timestamp'],
    preferredCursorType: 'blockNumber',
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 1,
      requestsPerHour: 300,
      requestsPerMinute: 5,
      requestsPerSecond: 0.08,
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Bittensor network provider with Taostats API integration',
  displayName: 'Taostats',
  name: 'taostats',
  requiresApiKey: true,
  supportedChains: ['bittensor'],
})
export class TaostatsApiClient extends BaseApiClient {
  private readonly chainConfig: SubstrateChainConfig;

  constructor(config: ProviderConfig) {
    super(config);

    // Get chain config
    const chainConfig = getSubstrateChainConfig(config.blockchain);
    if (!chainConfig) {
      throw new Error(`Unsupported blockchain for Taostats provider: ${config.blockchain}`);
    }
    this.chainConfig = chainConfig;

    // Taostats doesn't use "Bearer" prefix for authorization
    this.reinitializeHttpClient({
      defaultHeaders: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(this.apiKey && {
          Authorization: this.apiKey,
        }),
      },
    });

    this.logger.debug(
      `Initialized TaostatsApiClient for ${config.blockchain} - BaseUrl: ${this.baseUrl}, TokenSymbol: ${this.chainConfig.nativeCurrency}`
    );
  }

  extractCursors(transaction: SubstrateTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    // Primary cursor: block height
    if (transaction.blockHeight !== undefined) {
      cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
    }

    // Alternative cursor: timestamp
    if (transaction.timestamp) {
      cursors.push({ type: 'timestamp', value: transaction.timestamp });
    }

    return cursors;
  }

  applyReplayWindow(cursor: PaginationCursor): PaginationCursor {
    // No replay window needed for Taostats offset-based pagination
    return cursor;
  }

  async execute<T>(operation: ProviderOperation): Promise<Result<T, Error>> {
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

  async *executeStreaming<T>(
    operation: ProviderOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    switch (operation.type) {
      case 'getAddressTransactions':
        yield* this.streamAddressTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      default:
        yield err(new Error(`Streaming not yet implemented for operation: ${operation.type}`));
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/account/latest/v1?network=finney&limit=1',
      validate: (response: unknown) => {
        return !!(response && typeof response === 'object' && 'data' in response);
      },
    };
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    // Validate address format
    if (!isValidSS58Address(address)) {
      return err(new Error(`Invalid SS58 address for ${this.blockchain}: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<TaostatsBalanceResponse>(
      `/account/latest/v1?network=finney&address=${address}`,
      { schema: TaostatsBalanceResponseSchema }
    );

    if (result.isErr()) {
      this.logger.error(
        `Failed to fetch raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;
    const balanceRao = response.data?.[0]?.balance_total || '0';

    // Convert from smallest unit (rao) to main unit (TAO)
    const balanceDecimal = convertToMainUnit(balanceRao, this.chainConfig.nativeDecimals);

    this.logger.debug(
      `Found raw balance for ${maskAddress(address)}: ${balanceDecimal} ${this.chainConfig.nativeCurrency}`
    );

    return ok(
      createRawBalanceData(balanceRao, balanceDecimal, this.chainConfig.nativeDecimals, this.chainConfig.nativeCurrency)
    );
  }

  private async getAddressTransactions(params: {
    address: string;
  }): Promise<Result<TransactionWithRawData<SubstrateTransaction>[], Error>> {
    const { address } = params;

    // Validate address format
    if (!isValidSS58Address(address)) {
      return err(new Error(`Invalid SS58 address for ${this.blockchain}: ${address}`));
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    const transactions: TaostatsTransaction[] = [];
    let offset = 0;
    const maxPages = 100; // Safety limit to prevent infinite loops
    const limit = 100;
    let hasMorePages = true;

    while (hasMorePages && Math.floor(offset / limit) < maxPages) {
      // Build query parameters
      const params = new URLSearchParams({
        network: 'finney',
        address: address,
        limit: limit.toString(),
        offset: offset.toString(),
      });

      const endpoint = `/transfer/v1?${params.toString()}`;
      const result = await this.httpClient.get<{ data?: TaostatsTransaction[] }>(endpoint, {
        schema: TaostatsTransactionsResponseSchema,
      });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const response = result.value;
      const pageTransactions = response.data || [];

      transactions.push(...pageTransactions);
      offset += limit;

      // Check if there are more pages
      hasMorePages = pageTransactions.length === limit;

      this.logger.debug(
        `Fetched page ${Math.floor(offset / limit)}: ${pageTransactions.length} transactions${hasMorePages ? ' (more pages available)' : ' (last page)'}`
      );

      // Safety check to prevent infinite pagination
      if (Math.floor(offset / limit) >= maxPages) {
        this.logger.warn(`Reached maximum page limit (${maxPages}), stopping pagination`);
        break;
      }
    }

    // Normalize transactions using pure mapping function
    const relevantAddresses = new Set([address]);
    const normalizedTransactions: TransactionWithRawData<SubstrateTransaction>[] = [];
    for (const rawTx of transactions) {
      // Skip transactions that aren't relevant to this address
      if (!isTransactionRelevant(rawTx, relevantAddresses)) {
        continue;
      }

      const mapResult = convertTaostatsTransaction(rawTx, this.chainConfig.nativeCurrency);

      if (mapResult.isErr()) {
        const error = mapResult.error;
        const errorMessage = error.type === 'error' ? error.message : error.reason;
        this.logger.error(`Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`);
        return err(new Error(`Provider data validation failed: ${errorMessage}`));
      }

      normalizedTransactions.push({
        raw: rawTx,
        normalized: mapResult.value,
      });
    }

    this.logger.debug(
      `Successfully retrieved and normalized transactions - Address: ${maskAddress(address)}, Count: ${normalizedTransactions.length}, PagesProcessed: ${Math.floor(offset / limit)}`
    );

    return ok(normalizedTransactions);
  }

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<SubstrateTransaction>, Error>> {
    const fetchPage = async (ctx: StreamingPageContext): Promise<Result<StreamingPage<TaostatsTransaction>, Error>> => {
      const limit = 100;

      // Parse offset from pageToken, or start from 0
      const offset = ctx.pageToken ? parseInt(ctx.pageToken, 10) : 0;

      // Build query parameters
      const params = new URLSearchParams({
        network: 'finney',
        address: address,
        limit: limit.toString(),
        offset: offset.toString(),
      });

      const endpoint = `/transfer/v1?${params.toString()}`;
      const result = await this.httpClient.get<{ data?: TaostatsTransaction[] }>(endpoint, {
        schema: TaostatsTransactionsResponseSchema,
      });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch transactions - Address: ${maskAddress(address)}, Offset: ${offset}, Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const response = result.value;
      const items = response.data || [];

      // Filter for relevant transactions only
      const relevantAddresses = new Set([address]);
      const relevantItems = items.filter((tx) => isTransactionRelevant(tx, relevantAddresses));

      // Check if there are more pages
      const hasMore = items.length === limit;
      const nextOffset = offset + limit;
      const nextPageToken = hasMore ? nextOffset.toString() : undefined;

      return ok({
        items: relevantItems,
        nextPageToken,
        isComplete: !hasMore,
      });
    };

    return createStreamingIterator<TaostatsTransaction, SubstrateTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = convertTaostatsTransaction(raw, this.chainConfig.nativeCurrency);
        if (mapped.isErr()) {
          const errorMessage = mapped.error.type === 'error' ? mapped.error.message : mapped.error.reason;
          this.logger.error(
            `Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`
          );
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }
        return ok({ raw, normalized: mapped.value });
      },
      extractCursors: (tx) => this.extractCursors(tx),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: 100,
      logger: this.logger,
    });
  }
}
