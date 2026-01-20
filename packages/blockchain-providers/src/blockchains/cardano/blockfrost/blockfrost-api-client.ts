import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { BaseApiClient } from '../../../core/base/api-client.js';
import type { NormalizedTransactionBase, ProviderConfig } from '../../../core/index.js';
import { RegisterApiClient } from '../../../core/index.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../core/streaming/streaming-adapter.js';
import type {
  OneShotOperation,
  ProviderOperation,
  RawBalanceData,
  StreamingBatchResult,
  StreamingOperation,
} from '../../../core/types/index.js';
import { maskAddress } from '../../../core/utils/address-utils.js';
import type { CardanoTransaction } from '../schemas.js';
import { createRawBalanceData } from '../utils.js';

import { lovelaceToAda, mapBlockfrostTransaction } from './blockfrost.mapper-utils.js';
import type { BlockfrostTransactionHash, BlockfrostTransactionWithMetadata } from './blockfrost.schemas.js';
import {
  BlockfrostAddressSchema,
  BlockfrostTransactionDetailsSchema,
  BlockfrostTransactionHashSchema,
  BlockfrostTransactionUtxosSchema,
} from './blockfrost.schemas.js';

/**
 * Blockfrost API client for Cardano blockchain data.
 *
 * Implements a three-call pattern to fetch complete transaction data:
 * 1. GET /addresses/{address}/transactions - Fetches transaction hashes with basic metadata
 * 2. GET /txs/{hash} - Fetches complete transaction details including fees and block info
 * 3. GET /txs/{hash}/utxos - Fetches detailed UTXO data for each transaction
 *
 * Blockfrost requires an API key provided via the BLOCKFROST_API_KEY environment variable.
 * The API key is sent in the "project_id" header for authentication.
 *
 * Rate limits: Default 10 req/sec with burst limit of 500 req/min.
 */
@RegisterApiClient({
  apiKeyEnvVar: 'BLOCKFROST_API_KEY',
  baseUrl: 'https://cardano-mainnet.blockfrost.io/api/v0',
  blockchain: 'cardano',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances', 'hasAddressTransactions'],
    supportedTransactionTypes: ['normal'],
    supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 2 },
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 500,
      requestsPerHour: 36000,
      requestsPerMinute: 600,
      requestsPerSecond: 10,
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Cardano blockchain API with comprehensive transaction and UTXO data',
  displayName: 'Blockfrost Cardano API',
  name: 'blockfrost',
  requiresApiKey: true,
})
export class BlockfrostApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super(config);

    this.logger.debug(`Initialized BlockfrostApiClient from registry metadata - BaseUrl: ${this.baseUrl}`);
  }

  extractCursors(transaction: CardanoTransaction): PaginationCursor[] {
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
        return (await this.getAddressBalances({
          address: operation.address,
        })) as Result<T, Error>;
      case 'hasAddressTransactions':
        return (await this.hasAddressTransactions({
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
    // Route to appropriate streaming implementation
    switch (operation.type) {
      case 'getAddressTransactions': {
        const streamType = operation.streamType || 'normal';
        if (streamType !== 'normal') {
          yield err(new Error(`Unsupported transaction type: ${streamType} for operation: ${operation.type}`));
          return;
        }
        yield* this.streamAddressTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      }
      default:
        yield err(new Error(`Streaming not yet implemented for operation: ${(operation as ProviderOperation).type}`));
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/health',
      validate: (response: unknown) => {
        return typeof response === 'object' && response !== null && 'is_healthy' in response;
      },
    };
  }

  /**
   * Get address balance information.
   *
   * Fetches the balance for a Cardano address from /addresses/{address}.
   * Returns the ADA balance with lovelace as the raw amount.
   *
   * BlockFrost returns 404 for addresses that have never been used on-chain.
   * These are treated as zero balance rather than an error.
   *
   * @param params - Parameters containing the Cardano address
   * @returns Result containing balance data with raw and decimal amounts
   */
  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    this.logger.debug(`Fetching address balance - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get(`/addresses/${address}`, {
      headers: { project_id: this.apiKey },
      schema: BlockfrostAddressSchema,
    });

    if (result.isErr()) {
      const errorMessage = getErrorMessage(result.error);

      // BlockFrost returns 404 for addresses that have never been used on-chain
      // Treat 404 as zero balance rather than an error
      if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
        this.logger.debug(
          `Address has no activity (404 response), returning zero balance - Address: ${maskAddress(address)}`
        );
        const balanceData = createRawBalanceData('0', '0');
        return ok(balanceData);
      }

      this.logger.error(`Failed to fetch address balance - Address: ${maskAddress(address)}, Error: ${errorMessage}`);
      return err(result.error);
    }

    const addressInfo = result.value;

    // Find the lovelace amount (ADA native currency)
    // Empty amount array indicates zero balance
    const lovelaceAmount = addressInfo.amount.find((asset) => asset.unit === 'lovelace');
    const lovelaceQuantity = lovelaceAmount?.quantity ?? '0';

    const ada = lovelaceToAda(lovelaceQuantity);
    const balanceData = createRawBalanceData(lovelaceQuantity, ada);

    this.logger.debug(
      `Successfully retrieved address balance - Address: ${maskAddress(address)}, ADA: ${ada}, Lovelace: ${lovelaceQuantity}`
    );

    return ok(balanceData);
  }

  /**
   * Check if an address has any transactions.
   *
   * Uses the /addresses/{address}/transactions endpoint with a limit of 1
   * to efficiently check for transaction existence.
   *
   * @param params - Parameters containing the Cardano address
   * @returns Result containing boolean indicating if address has transactions
   */
  private async hasAddressTransactions(params: { address: string }): Promise<Result<boolean, Error>> {
    const { address } = params;

    this.logger.debug(`Checking if address has transactions - Address: ${maskAddress(address)}`);

    // Fetch just one transaction hash to check if any exist
    const txHashesResult = await this.fetchTransactionHashes(address, 1);

    if (txHashesResult.isErr()) {
      const errorMessage = getErrorMessage(txHashesResult.error);

      // BlockFrost returns 404 for addresses that have never been used
      // Treat 404 as "no transactions" rather than an error
      if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
        this.logger.debug(`Address has no transactions (404 response) - Address: ${maskAddress(address)}`);
        return ok(false);
      }

      this.logger.error(
        `Failed to check address transactions - Address: ${maskAddress(address)}, Error: ${errorMessage}`
      );
      return err(txHashesResult.error);
    }

    const hasTransactions = txHashesResult.value.length > 0;

    this.logger.debug(
      `Address transaction check complete - Address: ${maskAddress(address)}, HasTransactions: ${hasTransactions}`
    );

    return ok(hasTransactions);
  }

  /**
   * Fetch all transaction hashes for an address with pagination.
   *
   * Blockfrost returns up to 100 transactions per page in descending order (newest first).
   * This method handles pagination automatically to fetch all transactions.
   *
   * @param address - Cardano address to fetch transactions for
   * @param limit - Optional maximum number of transactions to fetch
   * @returns Result containing array of transaction hash entries
   */
  private async fetchTransactionHashes(
    address: string,
    limit?: number
  ): Promise<Result<BlockfrostTransactionHash[], Error>> {
    const allTxHashes: BlockfrostTransactionHash[] = [];
    let page = 1;
    let hasMore = true;
    const maxPages = 100; // Safety limit to prevent infinite loops

    while (hasMore && page <= maxPages) {
      // If a limit is specified, adjust the count to fetch only what's needed
      const remainingToFetch = limit !== undefined ? limit - allTxHashes.length : 100;
      const count = Math.min(remainingToFetch, 100);

      if (count <= 0) {
        break;
      }

      const endpoint = `/addresses/${address}/transactions?order=desc&count=${count}&page=${page}`;

      const result = await this.httpClient.get<BlockfrostTransactionHash[]>(endpoint, {
        headers: { project_id: this.apiKey },
      });

      if (result.isErr()) {
        const errorMessage = getErrorMessage(result.error);

        // BlockFrost returns 404 for addresses that have never been used on-chain
        // Treat 404 as "no transactions" rather than an error
        if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
          this.logger.debug(`Address has no transactions (404 response) - Address: ${maskAddress(address)}`);
          return ok([]);
        }

        this.logger.error(
          `Failed to fetch transaction hashes page - Address: ${maskAddress(address)}, Page: ${page}, Error: ${errorMessage}`
        );
        return err(result.error);
      }

      const txHashes = result.value;

      if (!Array.isArray(txHashes) || txHashes.length === 0) {
        hasMore = false;
        break;
      }

      this.logger.debug(
        `Retrieved transaction hash batch - Address: ${maskAddress(address)}, Page: ${page}, BatchSize: ${txHashes.length}`
      );

      allTxHashes.push(...txHashes);

      // Stop if we've reached the limit
      if (limit !== undefined && allTxHashes.length >= limit) {
        break;
      }

      // If we got less than the requested count, we've reached the end
      hasMore = txHashes.length === count;
      page++;
    }

    if (page > maxPages) {
      this.logger.warn(
        `Reached maximum page limit - Address: ${maskAddress(address)}, Pages: ${maxPages}, Transactions: ${allTxHashes.length}`
      );
    }

    return ok(allTxHashes);
  }

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<CardanoTransaction>, Error>> {
    // Use smaller page size to minimize API usage (each tx = 3 API calls: hash + details + utxos)
    // 10 transactions = 31 API calls per batch (1 for hashes + 10 details + 10 utxos)
    const pageSize = 10;

    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<BlockfrostTransactionWithMetadata>, Error>> => {
      // Parse page number from pageToken (page-based pagination)
      const page = ctx.pageToken ? parseInt(ctx.pageToken, 10) : 1;

      // Build query parameters
      const queryParams = new URLSearchParams({
        order: 'desc',
        count: String(pageSize),
        page: String(page),
      });

      // Apply replay window if we have a block cursor
      // Note: Blockfrost doesn't support filtering by block height in the transactions endpoint
      // So we'll fetch all pages and filter in the streaming adapter via deduplication

      const endpoint = `/addresses/${address}/transactions?${queryParams.toString()}`;

      // Fetch transaction hashes for this page
      const hashesResult = await this.httpClient.get<BlockfrostTransactionHash[]>(endpoint, {
        headers: { project_id: this.apiKey },
        schema: z.array(BlockfrostTransactionHashSchema),
      });

      if (hashesResult.isErr()) {
        const errorMessage = getErrorMessage(hashesResult.error);

        // BlockFrost returns 404 for addresses that have never been used on-chain
        // Treat 404 as "no transactions" rather than an error
        if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
          this.logger.debug(`Address has no transactions (404 response) - Address: ${maskAddress(address)}`);
          return ok({
            items: [],
            nextPageToken: undefined,
            isComplete: true,
          });
        }

        this.logger.error(`Failed to fetch transaction hashes for ${maskAddress(address)} - Error: ${errorMessage}`);
        return err(hashesResult.error);
      }

      const txHashes = hashesResult.value;

      if (!Array.isArray(txHashes) || txHashes.length === 0) {
        return ok({
          items: [],
          nextPageToken: undefined,
          isComplete: true,
        });
      }

      // For each transaction hash, fetch complete details and UTXO data
      const transactions: BlockfrostTransactionWithMetadata[] = [];

      for (const txHashEntry of txHashes) {
        const txHash = txHashEntry.tx_hash;

        // Fetch complete transaction details (including fees, block hash, status)
        const detailsResult = await this.httpClient.get(`/txs/${txHash}`, {
          headers: { project_id: this.apiKey },
          schema: BlockfrostTransactionDetailsSchema,
        });

        if (detailsResult.isErr()) {
          this.logger.error(
            `Failed to fetch transaction details - TxHash: ${txHash}, Address: ${maskAddress(address)}, Error: ${getErrorMessage(detailsResult.error)}`
          );
          return err(detailsResult.error);
        }

        const txDetails = detailsResult.value;

        // Fetch UTXO details for this transaction
        const utxoResult = await this.httpClient.get(`/txs/${txHash}/utxos`, {
          headers: { project_id: this.apiKey },
          schema: BlockfrostTransactionUtxosSchema,
        });

        if (utxoResult.isErr()) {
          this.logger.error(
            `Failed to fetch UTXO data for transaction - TxHash: ${txHash}, Address: ${maskAddress(address)}, Error: ${getErrorMessage(utxoResult.error)}`
          );
          return err(utxoResult.error);
        }

        const rawUtxo = utxoResult.value;

        // Combine UTXO data with transaction metadata
        const combinedData: BlockfrostTransactionWithMetadata = {
          ...rawUtxo,
          block_height: txDetails.block_height,
          block_time: txDetails.block_time,
          block_hash: txDetails.block,
          fees: txDetails.fees,
          tx_index: txHashEntry.tx_index,
          valid_contract: txDetails.valid_contract,
        };

        transactions.push(combinedData);
      }

      // If we got a full page, there might be more
      const hasMore = txHashes.length === pageSize;
      const nextPage = hasMore ? page + 1 : undefined;

      return ok({
        items: transactions,
        nextPageToken: nextPage !== undefined ? String(nextPage) : undefined,
        isComplete: !hasMore,
      });
    };

    return createStreamingIterator<BlockfrostTransactionWithMetadata, CardanoTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapBlockfrostTransaction(raw);
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
      dedupWindowSize: 500,
      logger: this.logger,
    });
  }
}
