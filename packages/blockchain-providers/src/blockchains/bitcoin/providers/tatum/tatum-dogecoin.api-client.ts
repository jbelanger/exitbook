import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';
import { z, type ZodType } from 'zod';

import type {
  NormalizedTransactionBase,
  OneShotOperation,
  ProviderConfig,
  ProviderOperation,
  RawBalanceData,
  StreamingBatchResult,
  StreamingOperation,
} from '../../../../core/index.js';
import { RegisterApiClient, BaseApiClient, maskAddress } from '../../../../core/index.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../core/streaming/streaming-adapter.js';
import { createRawBalanceData } from '../../balance-utils.js';
import type { BitcoinChainConfig } from '../../chain-config.interface.js';
import { getBitcoinChainConfig } from '../../chain-registry.js';
import { BITCOIN_STREAMING_DEDUP_WINDOW } from '../../constants.js';
import type { BitcoinTransaction } from '../../schemas.js';

import { mapTatumDogecoinTransaction } from './mapper-utils.js';
import {
  TatumDogecoinBalanceSchema,
  TatumDogecoinTransactionSchema,
  type TatumDogecoinTransaction,
  type TatumDogecoinBalance,
} from './tatum-dogecoin.schemas.js';
import { calculateTatumBalance } from './utils.js';

@RegisterApiClient({
  apiKeyEnvVar: 'TATUM_API_KEY',
  baseUrl: 'https://api.tatum.io/v3/dogecoin',
  blockchain: 'dogecoin',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances', 'hasAddressTransactions'],
    supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 4 },
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 50,
      requestsPerHour: 10800,
      requestsPerMinute: 180,
      requestsPerSecond: 3,
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Tatum API provider for Dogecoin (values as strings in DOGE)',
  displayName: 'Tatum Dogecoin API',
  name: 'tatum',
  requiresApiKey: true,
  supportedChains: ['dogecoin'],
})
export class TatumDogecoinApiClient extends BaseApiClient {
  private readonly chainConfig: BitcoinChainConfig;

  constructor(config: ProviderConfig) {
    super(config);

    const chainConfig = getBitcoinChainConfig(config.blockchain);
    if (!chainConfig) {
      throw new Error(`Unsupported blockchain: ${config.blockchain}`);
    }
    this.chainConfig = chainConfig;

    // Reinitialize HTTP client with Tatum-specific headers
    this.reinitializeHttpClient({
      baseUrl: 'https://api.tatum.io/v3/dogecoin',
      defaultHeaders: {
        accept: 'application/json',
        'x-api-key': this.apiKey,
      },
    });

    this.logger.debug(
      `Initialized TatumDogecoinApiClient - BaseUrl: ${this.baseUrl}, HasApiKey: ${this.apiKey !== 'YourApiKeyToken'}`
    );
  }

  extractCursors(transaction: BitcoinTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    if (transaction.blockHeight !== undefined) {
      cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
    }

    if (transaction.timestamp) {
      cursors.push({
        type: 'timestamp',
        value: transaction.timestamp,
      });
    }

    return cursors;
  }

  applyReplayWindow(cursor: PaginationCursor): PaginationCursor {
    const replayWindow = this.capabilities.replayWindow;
    if (!replayWindow || cursor.type !== 'blockNumber') return cursor;

    return {
      type: 'blockNumber',
      value: Math.max(0, cursor.value - (replayWindow.blocks || 0)),
    };
  }

  async execute<T>(operation: OneShotOperation): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getAddressBalances':
        return (await this.getAddressBalances(operation.address)) as Result<T, Error>;
      case 'hasAddressTransactions':
        return (await this.hasAddressTransactions(operation.address)) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  async *executeStreaming<T extends NormalizedTransactionBase = NormalizedTransactionBase>(
    operation: StreamingOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    // Route to appropriate streaming implementation
    switch (operation.type) {
      case 'getAddressTransactions':
        yield* this.streamAddressTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      default:
        yield err(new Error(`Streaming not yet implemented for operation: ${(operation as ProviderOperation).type}`));
    }
  }

  /**
   * Check if address has any transactions
   */
  async hasAddressTransactions(address: string): Promise<Result<boolean, Error>> {
    this.logger.debug(`Checking if address has transactions - Address: ${maskAddress(address)}`);

    const txResult = await this.makeRequest<TatumDogecoinTransaction[]>(
      `/transaction/address/${address}`,
      {
        offset: 0,
        pageSize: 1,
      },
      z.array(TatumDogecoinTransactionSchema)
    );

    if (txResult.isErr()) {
      this.logger.error(
        `Failed to check address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(txResult.error)}`
      );
      return err(txResult.error);
    }

    const hasTransactions = Array.isArray(txResult.value) && txResult.value.length > 0;

    this.logger.debug(
      `Address transaction check complete - Address: ${maskAddress(address)}, HasTransactions: ${hasTransactions}`
    );

    return ok(hasTransactions);
  }

  /**
   * Get lightweight address info for efficient gap scanning
   */
  async getAddressBalances(address: string): Promise<Result<RawBalanceData, Error>> {
    this.logger.debug(`Fetching lightweight address info - Address: ${maskAddress(address)}`);

    const balanceResult = await this.makeRequest<TatumDogecoinBalance>(
      `/address/balance/${address}`,
      undefined,
      TatumDogecoinBalanceSchema
    );

    if (balanceResult.isErr()) {
      this.logger.error(
        `Failed to get address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(balanceResult.error)}`
      );
      return err(balanceResult.error);
    }

    const balanceData = balanceResult.value;
    const { balanceBTC, balanceSats } = calculateTatumBalance(balanceData.incoming, balanceData.outgoing);

    this.logger.debug(
      `Successfully retrieved lightweight address info - Address: ${maskAddress(address)}, BalanceDOGE: ${balanceBTC}`
    );

    return ok(createRawBalanceData(balanceSats, balanceBTC, this.chainConfig.nativeCurrency));
  }

  override getHealthCheckConfig() {
    return {
      endpoint: '/address/balance/DTw4VxsDbQG6Dq2AqmTQTwGQrXhGUJJqCg',
      validate: (response: unknown) => {
        return response !== null && response !== undefined;
      },
    };
  }

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<BitcoinTransaction>, Error>> {
    const pageSize = 50; // Tatum max page size

    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<TatumDogecoinTransaction>, Error>> => {
      // Parse offset from pageToken (offset-based pagination)
      const offset = ctx.pageToken ? parseInt(ctx.pageToken, 10) : 0;

      const queryParams: Record<string, unknown> = {
        offset,
        pageSize,
      };

      // Apply replay window if we have a block cursor
      if (ctx.replayedCursor?.type === 'blockNumber') {
        queryParams['blockFrom'] = ctx.replayedCursor.value;
      }

      const result = await this.makeRequest<TatumDogecoinTransaction[]>(
        `/transaction/address/${address}`,
        queryParams,
        z.array(TatumDogecoinTransactionSchema)
      );

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch address transactions for ${maskAddress(address)} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const items = result.value;
      const hasMore = items.length === pageSize;
      const nextOffset = hasMore ? offset + pageSize : undefined;

      return ok({
        items,
        nextPageToken: nextOffset !== undefined ? String(nextOffset) : undefined,
        isComplete: !hasMore,
      });
    };

    return createStreamingIterator<TatumDogecoinTransaction, BitcoinTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapTatumDogecoinTransaction(raw, this.chainConfig);
        if (mapped.isErr()) {
          const errorMessage = mapped.error.type === 'error' ? mapped.error.message : mapped.error.reason;
          this.logger.error(
            `Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`
          );
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }

        return ok([
          {
            raw,
            normalized: mapped.value,
          },
        ]);
      },
      extractCursors: (tx) => this.extractCursors(tx),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: BITCOIN_STREAMING_DEDUP_WINDOW,
      logger: this.logger,
    });
  }

  /**
   * Make a request to the Tatum API with common error handling
   */
  private async makeRequest<T>(
    endpoint: string,
    params?: Record<string, unknown>,
    schema?: ZodType<T>
  ): Promise<Result<T, Error>> {
    this.validateApiKey();

    // Build URL with query parameters
    let url = endpoint;
    if (params && Object.keys(params).length > 0) {
      const queryString = new URLSearchParams(
        Object.entries(params)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([key, value]) => [key, String(value)] as [string, string])
      ).toString();
      url = `${endpoint}?${queryString}`;
    }

    const result = schema ? await this.httpClient.get<T>(url, { schema }) : await this.httpClient.get<T>(url);

    if (result.isErr()) {
      this.logger.error(
        `Tatum API request failed - Blockchain: ${this.blockchain}, Endpoint: ${endpoint}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    return ok(result.value);
  }
}
