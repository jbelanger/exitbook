import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';
import { z, type ZodSchema } from 'zod';

import type {
  ProviderConfig,
  ProviderOperation,
  RawBalanceData,
  StreamingBatchResult,
  TransactionWithRawData,
} from '../../../../core/index.js';
import { RegisterApiClient, BaseApiClient, maskAddress } from '../../../../core/index.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../core/streaming/streaming-adapter.js';
import { calculateTatumBalance, createRawBalanceData } from '../../balance-utils.js';
import { BITCOIN_STREAMING_DEDUP_WINDOW } from '../../bitcoin-streaming.constants.js';
import type { BitcoinChainConfig } from '../../chain-config.interface.js';
import { getBitcoinChainConfig } from '../../chain-registry.js';
import type { BitcoinTransaction } from '../../schemas.js';

import { mapTatumTransaction } from './mapper-utils.js';
import {
  TatumBitcoinBalanceSchema,
  TatumBitcoinTransactionSchema,
  type TatumBitcoinTransaction,
  type TatumBitcoinBalance,
} from './tatum.schemas.js';

@RegisterApiClient({
  apiKeyEnvVar: 'TATUM_API_KEY',
  baseUrl: 'https://api.tatum.io/v3/bitcoin',
  blockchain: 'bitcoin',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances', 'hasAddressTransactions'],
    supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 5 },
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
  description: 'Multi-blockchain API provider supporting Bitcoin via unified Tatum API',
  displayName: 'Tatum Bitcoin API',
  name: 'tatum',
  requiresApiKey: true,
  supportedChains: ['bitcoin'],
})
export class TatumBitcoinApiClient extends BaseApiClient {
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
      baseUrl: `https://api.tatum.io/v3/${this.blockchain}`,
      defaultHeaders: {
        accept: 'application/json',
        'x-api-key': this.apiKey,
      },
    });

    this.logger.debug(
      `Initialized TatumBitcoinApiClient - BaseUrl: ${this.baseUrl}, HasApiKey: ${this.apiKey !== 'YourApiKeyToken'}`
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

  async execute<T>(operation: ProviderOperation): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getAddressTransactions':
        return (await this.getAddressTransactions(operation.address)) as Result<T, Error>;
      case 'getAddressBalances':
        return (await this.getAddressBalances(operation.address)) as Result<T, Error>;
      case 'hasAddressTransactions':
        return (await this.hasAddressTransactions(operation.address)) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  async *executeStreaming<T>(
    operation: ProviderOperation,
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
        yield err(new Error(`Streaming not yet implemented for operation: ${operation.type}`));
    }
  }

  /**
   * Check if address has any transactions
   */
  async hasAddressTransactions(address: string): Promise<Result<boolean, Error>> {
    this.logger.debug(`Checking if address has transactions - Address: ${maskAddress(address)}`);

    const txResult = await this.makeRequest<TatumBitcoinTransaction[]>(
      `/transaction/address/${address}`,
      {
        offset: 0,
        pageSize: 1,
      },
      z.array(TatumBitcoinTransactionSchema)
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

    const balanceResult = await this.makeRequest<TatumBitcoinBalance>(
      `/address/balance/${address}`,
      undefined,
      TatumBitcoinBalanceSchema
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
      `Successfully retrieved lightweight address info - Address: ${maskAddress(address)}, BalanceBTC: ${balanceBTC}`
    );

    return ok(createRawBalanceData(balanceSats, balanceBTC, this.chainConfig.nativeCurrency));
  }

  /**
   * Get raw address transactions - no transformation, just raw Tatum API data
   */
  async getAddressTransactions(
    address: string,
    params?: {
      blockFrom?: number | undefined;
      blockTo?: number | undefined;
      offset?: number | undefined;
      pageSize?: number | undefined;
      txType?: 'incoming' | 'outgoing' | undefined;
    }
  ): Promise<Result<TransactionWithRawData<BitcoinTransaction>[], Error>> {
    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    const queryParams = {
      offset: params?.offset || 0,
      pageSize: Math.min(params?.pageSize || 50, 50),
      ...(params?.blockFrom && { blockFrom: params.blockFrom }),
      ...(params?.blockTo && { blockTo: params.blockTo }),
      ...(params?.txType && { txType: params.txType }),
    };

    const result = await this.makeRequest<TatumBitcoinTransaction[]>(
      `/transaction/address/${address}`,
      queryParams,
      z.array(TatumBitcoinTransactionSchema)
    );

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const rawTransactions = result.value;

    if (!Array.isArray(rawTransactions)) {
      this.logger.debug(`No transactions found - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    // Normalize transactions immediately using mapper
    const transactions: TransactionWithRawData<BitcoinTransaction>[] = [];
    for (const rawTx of rawTransactions) {
      const mapResult = mapTatumTransaction(rawTx, {}, this.chainConfig);

      if (mapResult.isErr()) {
        // Fail fast - provider returned invalid data
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
      `Retrieved and normalized transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}`
    );

    return ok(transactions);
  }

  override getHealthCheckConfig() {
    return {
      endpoint: '/address/balance/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
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
    ): Promise<Result<StreamingPage<TatumBitcoinTransaction>, Error>> => {
      // Parse offset from pageToken (offset-based pagination)
      const offset = ctx.pageToken ? parseInt(ctx.pageToken, 10) : 0;

      const queryParams: Record<string, unknown> = {
        offset,
        pageSize,
      };

      // Apply replay window if we have a block cursor
      if (ctx.replayedCursor?.type === 'blockNumber') {
        queryParams.blockFrom = ctx.replayedCursor.value;
      }

      const result = await this.makeRequest<TatumBitcoinTransaction[]>(
        `/transaction/address/${address}`,
        queryParams,
        z.array(TatumBitcoinTransactionSchema)
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

    return createStreamingIterator<TatumBitcoinTransaction, BitcoinTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapTatumTransaction(raw, {}, this.chainConfig);
        if (mapped.isErr()) {
          const errorMessage = mapped.error.type === 'error' ? mapped.error.message : mapped.error.reason;
          this.logger.error(
            `Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`
          );
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }

        return ok({
          raw,
          normalized: mapped.value,
        });
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
    schema?: ZodSchema<T>
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
