import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

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
import { transformSolBalance } from '../../balance-utils.js';
import type { SolanaTransaction } from '../../schemas.js';
import { isValidSolanaAddress } from '../../utils.js';

import { mapSolscanTransaction } from './solscan.mapper-utils.js';
import type { SolscanTransaction, SolscanResponse } from './solscan.schemas.js';
import {
  SolscanAccountBalanceResponseSchema,
  SolscanAccountTransactionsResponseSchema,
  SolscanLegacyTransactionsResponseSchema,
} from './solscan.schemas.js';

export interface SolscanRawBalanceData {
  lamports: string;
}

@RegisterApiClient({
  apiKeyEnvVar: 'SOLSCAN_API_KEY',
  baseUrl: 'https://pro-api.solscan.io/v2.0',
  blockchain: 'solana',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
    supportedTransactionTypes: ['normal'],
    supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
    preferredCursorType: 'pageToken',
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 1,
      requestsPerMinute: 60,
      requestsPerSecond: 1,
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Solana blockchain explorer API with transaction and account data access',
  displayName: 'Solscan API',
  name: 'solscan',
  requiresApiKey: true,
})
export class SolscanApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super(config);

    // Override HTTP client to add browser-like headers for Solscan
    const defaultHeaders: Record<string, string> = {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',
      Connection: 'keep-alive',
      'Content-Type': 'application/json',
      DNT: '1',
      'Upgrade-Insecure-Requests': '1',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
      // Solscan Pro expects the API key in the custom `token` header
      defaultHeaders['token'] = this.apiKey;
    }

    this.reinitializeHttpClient({
      defaultHeaders,
    });
  }

  extractCursors(transaction: SolanaTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    if (transaction.timestamp) {
      cursors.push({ type: 'timestamp', value: transaction.timestamp });
    }

    if (transaction.blockHeight !== undefined) {
      cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
    }

    return cursors;
  }

  applyReplayWindow(cursor: PaginationCursor): PaginationCursor {
    // Offset-based pagination doesn't support replay window effectively
    // as the offset is just an index.
    return cursor;
  }

  async execute<T>(operation: OneShotOperation): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getAddressBalances':
        return (await this.getAddressBalances({
          address: operation.address,
        })) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  async *executeStreaming<T extends NormalizedTransactionBase = NormalizedTransactionBase>(
    operation: StreamingOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    if (operation.type !== 'getAddressTransactions') {
      yield err(new Error(`Streaming not yet implemented for operation: ${(operation as ProviderOperation).type}`));
      return;
    }

    // Route based on transaction type
    const streamType = operation.streamType || 'normal';
    switch (streamType) {
      case 'normal':
        yield* this.streamAddressTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      default:
        yield err(new Error(`Unsupported transaction type: ${streamType}`));
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/account/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      validate: (response: unknown) => {
        const data = response as SolscanResponse;
        return data && data.success !== false;
      },
    };
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    if (!isValidSolanaAddress(address)) {
      return err(new Error(`Invalid Solana address: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<SolscanResponse<{ lamports: string }>>(`/account/${address}`, {
      schema: SolscanAccountBalanceResponseSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    if (!response || !response.success || !response.data) {
      return err(new Error('Failed to fetch balance from Solscan API'));
    }

    const lamports = response.data.lamports || '0';
    const balanceData = transformSolBalance(lamports);

    this.logger.debug(
      `Successfully retrieved raw address balance - Address: ${maskAddress(address)}, SOL: ${balanceData.decimalAmount}`
    );

    return ok(balanceData);
  }

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<SolanaTransaction>, Error>> {
    const fetchPage = async (ctx: StreamingPageContext): Promise<Result<StreamingPage<SolscanTransaction>, Error>> => {
      const limit = 100;
      // Use pageToken as offset, default to 0
      const offset = ctx.pageToken ? parseInt(ctx.pageToken, 10) : 0;

      const queryParams = new URLSearchParams({
        account: address,
        limit: limit.toString(),
        offset: offset.toString(),
      });

      let items: SolscanTransaction[] = [];
      let fetchError: Error | undefined;

      // Try primary endpoint (V2)
      // LIMITATION: This endpoint requires a Solscan Pro API Key.
      // Standard/Free keys may receive 401 Unauthorized.
      const result = await this.httpClient.get<
        SolscanResponse<
          | SolscanTransaction[]
          | {
              data?: SolscanTransaction[];
              items?: SolscanTransaction[];
            }
        >
      >(`/account/transactions?${queryParams.toString()}`, { schema: SolscanAccountTransactionsResponseSchema });

      if (result.isOk()) {
        const response = result.value;
        if (response && response.success && response.data) {
          const data = response.data;
          if (Array.isArray(data)) {
            items = data;
          } else if (data && typeof data === 'object') {
            const maybeItems = (data as { items?: SolscanTransaction[] }).items;
            const maybeData = (data as { data?: SolscanTransaction[] }).data;

            if (Array.isArray(maybeItems)) {
              items = maybeItems;
            } else if (Array.isArray(maybeData)) {
              items = maybeData;
            }
          }
        }
      } else {
        fetchError = result.error;
        this.logger.warn(
          `Primary Solscan endpoint failed - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
        );
      }

      // If primary endpoint failed or returned no data, try legacy endpoint (V1)
      // This endpoint is deprecated but may work for some addresses/keys where V2 fails.
      if (items.length === 0) {
        this.logger.debug(`Attempting legacy Solscan endpoint - Address: ${maskAddress(address)}`);

        const legacyResult = await this.httpClient.get<SolscanResponse<SolscanTransaction[]>>(
          `/account/transaction?address=${address}&limit=${limit}&offset=${offset}`,
          { schema: SolscanLegacyTransactionsResponseSchema }
        );

        if (legacyResult.isOk()) {
          const legacyResponse = legacyResult.value;
          if (legacyResponse && legacyResponse.success && legacyResponse.data) {
            items = Array.isArray(legacyResponse.data) ? legacyResponse.data : [];
            // Clear error if legacy succeeded
            fetchError = undefined;
          }
        } else if (!fetchError) {
          // If primary succeeded (but empty) and legacy failed, keep primary success (empty)
          // If primary failed and legacy failed, keep primary error (or legacy error?)
          // Let's keep primary error if it exists, otherwise legacy error
          fetchError = legacyResult.error;
        }
      }

      if (fetchError && items.length === 0) {
        this.logger.error(
          `All Solscan endpoints failed - Address: ${maskAddress(address)}, Error: ${getErrorMessage(fetchError)}`
        );
        return err(fetchError);
      }

      // Calculate next offset
      const nextOffset = items.length < limit ? undefined : (offset + limit).toString();

      return ok({
        items,
        nextPageToken: nextOffset,
        isComplete: !nextOffset,
      });
    };

    return createStreamingIterator<SolscanTransaction, SolanaTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapSolscanTransaction(raw);
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
      dedupWindowSize: 200, // Keep some history for dedup, though offset pagination makes it tricky
      logger: this.logger,
    });
  }
}
