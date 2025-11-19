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
import type { BitcoinChainConfig } from '../../chain-config.interface.js';
import { getBitcoinChainConfig } from '../../chain-registry.js';
import type { BitcoinTransaction } from '../../schemas.js';

import { mapTatumBCashTransaction } from './mapper-utils.js';
import {
  TatumBCashBalanceSchema,
  TatumBCashTransactionSchema,
  type TatumBCashTransaction,
  type TatumBCashBalance,
} from './tatum-bcash.schemas.js';

@RegisterApiClient({
  apiKeyEnvVar: 'TATUM_API_KEY',
  baseUrl: 'https://api.tatum.io/v3/bcash',
  blockchain: 'bitcoin-cash',
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
  description: 'Tatum API provider for Bitcoin Cash using bcash endpoint',
  displayName: 'Tatum Bitcoin Cash API',
  name: 'tatum',
  requiresApiKey: true,
  supportedChains: ['bitcoin-cash'],
})
export class TatumBCashApiClient extends BaseApiClient {
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
      baseUrl: 'https://api.tatum.io/v3/bcash',
      defaultHeaders: {
        accept: 'application/json',
        'x-api-key': this.apiKey,
      },
    });

    this.logger.debug(
      `Initialized TatumBCashApiClient - BaseUrl: ${this.baseUrl}, HasApiKey: ${this.apiKey !== 'YourApiKeyToken'}`
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

  /**
   * @deprecated Use executeStreaming instead
   */
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

    const normalizedAddress = this.normalizeAddressForApi(address);
    const txResult = await this.makeRequest<TatumBCashTransaction[]>(
      `/transaction/address/${normalizedAddress}`,
      {
        pageSize: 1,
        skip: 0,
      },
      z.array(TatumBCashTransactionSchema)
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

    const normalizedAddress = this.normalizeAddressForApi(address);
    const balanceResult = await this.makeRequest<TatumBCashBalance>(
      `/address/balance/${normalizedAddress}`,
      undefined,
      TatumBCashBalanceSchema
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
      `Successfully retrieved lightweight address info - Address: ${maskAddress(address)}, BalanceBCH: ${balanceBTC}`
    );

    return ok(createRawBalanceData(balanceSats, balanceBTC, this.chainConfig.nativeCurrency));
  }

  /**
   * Get raw address transactions - no transformation, just raw Tatum API data
   */
  async getAddressTransactions(
    address: string,
    params?: {
      pageSize?: number | undefined;
      skip?: number | undefined;
    }
  ): Promise<Result<TransactionWithRawData<BitcoinTransaction>[], Error>> {
    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    const normalizedAddress = this.normalizeAddressForApi(address);
    const queryParams = {
      pageSize: Math.min(params?.pageSize || 50, 50),
      skip: params?.skip || 0,
    };

    const result = await this.makeRequest<TatumBCashTransaction[]>(
      `/transaction/address/${normalizedAddress}`,
      queryParams,
      z.array(TatumBCashTransactionSchema)
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
      const mapResult = mapTatumBCashTransaction(rawTx, {}, this.chainConfig);

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
      endpoint: '/address/balance/qqqmuwfhm5arf9vlujftyxddngqfm0ckeuhdzmedl2',
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
    ): Promise<Result<StreamingPage<TatumBCashTransaction>, Error>> => {
      // Parse skip from pageToken (skip-based pagination for BCash)
      const skip = ctx.pageToken ? parseInt(ctx.pageToken, 10) : 0;

      const normalizedAddress = this.normalizeAddressForApi(address);
      const queryParams: Record<string, unknown> = {
        skip,
        pageSize,
      };

      // Note: BCash endpoint doesn't support blockFrom parameter
      // Replay window will be handled by deduplication

      const result = await this.makeRequest<TatumBCashTransaction[]>(
        `/transaction/address/${normalizedAddress}`,
        queryParams,
        z.array(TatumBCashTransactionSchema)
      );

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch address transactions for ${maskAddress(address)} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const items = result.value;
      const hasMore = items.length === pageSize;
      const nextSkip = hasMore ? skip + pageSize : undefined;

      return ok({
        items,
        nextPageToken: nextSkip !== undefined ? String(nextSkip) : undefined,
        isComplete: !hasMore,
      });
    };

    return createStreamingIterator<TatumBCashTransaction, BitcoinTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapTatumBCashTransaction(raw, {}, this.chainConfig);
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
      dedupWindowSize: 500,
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

  /**
   * Normalize address for Tatum BCash API calls
   * Remove bitcoincash: prefix if present for Tatum's bcash endpoint
   */
  private normalizeAddressForApi(address: string): string {
    if (address.toLowerCase().startsWith('bitcoincash:')) {
      return address.slice(12); // Remove 'bitcoincash:' prefix
    }
    return address;
  }
}
