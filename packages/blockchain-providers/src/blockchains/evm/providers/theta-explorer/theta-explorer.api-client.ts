import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { ProviderConfig, ProviderOperation } from '../../../../core/index.js';
import { BaseApiClient, RegisterApiClient } from '../../../../core/index.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../core/streaming/streaming-adapter.js';
import type { StreamingBatchResult, TransactionWithRawData } from '../../../../core/types/index.js';
import { maskAddress } from '../../../../core/utils/address-utils.js';
import type { EvmTransaction } from '../../types.js';

import { mapThetaExplorerTransaction } from './theta-explorer.mapper-utils.js';
import type { ThetaTransaction, ThetaAccountTxResponse } from './theta-explorer.schemas.js';

@RegisterApiClient({
  baseUrl: 'https://explorer-api.thetatoken.org/api',
  blockchain: 'theta',
  capabilities: {
    supportedOperations: ['getAddressTransactions'],
    supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 5 },
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
  constructor(config: ProviderConfig) {
    super(config);
  }

  extractCursors(transaction: EvmTransaction): PaginationCursor[] {
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
      const mapResult = mapThetaExplorerTransaction(rawTx);

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

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<EvmTransaction>, Error>> {
    const fetchPage = async (ctx: StreamingPageContext): Promise<Result<StreamingPage<ThetaTransaction>, Error>> => {
      // Parse page token to extract page number
      const pageNumber = ctx.pageToken ? parseInt(ctx.pageToken, 10) : 1;
      const limitPerPage = 100;

      // Check if we've reached the maximum page limit (100 pages)
      if (pageNumber > 100) {
        this.logger.warn('Reached maximum page limit (100), stopping pagination');
        return ok({
          items: [],
          nextPageToken: undefined,
          isComplete: true,
        });
      }

      const params = new URLSearchParams({
        limitNumber: limitPerPage.toString(),
        pageNumber: pageNumber.toString(),
      });

      const result = await this.httpClient.get<ThetaAccountTxResponse>(
        `/accounttx/${address.toLowerCase()}?${params.toString()}`
      );

      if (result.isErr()) {
        // Theta Explorer returns 404 when no transactions are found
        if (result.error.message.includes('HTTP 404')) {
          this.logger.debug(`No transactions found for ${maskAddress(address)}`);
          return ok({
            items: [],
            nextPageToken: undefined,
            isComplete: true,
          });
        }
        this.logger.error(
          `Failed to fetch transactions for ${maskAddress(address)} page ${pageNumber} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const response = result.value;
      const transactions = response.body || [];
      const hasMore = pageNumber < response.totalPageNumber;
      const nextPageToken = hasMore ? String(pageNumber + 1) : undefined;

      return ok({
        items: transactions,
        nextPageToken,
        isComplete: !hasMore,
      });
    };

    return createStreamingIterator<ThetaTransaction, EvmTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapThetaExplorerTransaction(raw);
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
}
