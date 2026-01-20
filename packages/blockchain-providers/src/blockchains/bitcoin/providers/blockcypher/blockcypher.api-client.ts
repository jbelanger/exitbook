/**
 * BlockCypher Bitcoin API Client
 *
 * ⚠️ PERFORMANCE WARNING: This provider should be LOWER PRIORITY in the failover chain.
 *
 * BlockCypher's API design is inefficient for fetching address transactions:
 * - Initial call returns only transaction references (hashes)
 * - Requires separate API call for EACH transaction's full details
 * - Example: Genesis address with 50 transactions = 51 API requests (1 + 50)
 * - With 100 requests/hour limit, can only process ~2 high-transaction addresses per hour
 *
 * Prioritize mempool.space or blockchain.com which may offer more efficient batch endpoints.
 * Use BlockCypher as emergency fallback or for addresses with few transactions only.
 */

import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage, hasStringProperty } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

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
import { calculateSimpleBalance, createRawBalanceData } from '../../balance-utils.js';
import { BITCOIN_STREAMING_DEDUP_WINDOW } from '../../bitcoin-streaming.constants.js';
import type { BitcoinChainConfig } from '../../chain-config.interface.js';
import { getBitcoinChainConfig } from '../../chain-registry.js';
import type { BitcoinTransaction } from '../../schemas.js';

import {
  BlockCypherAddressSchema,
  BlockCypherOutputSchema,
  BlockCypherInputSchema,
  BlockCypherTransactionSchema,
  type BlockCypherTransaction,
  type BlockCypherAddress,
} from './blockcypher.schemas.js';
import { mapBlockCypherTransaction } from './mapper-utils.js';

@RegisterApiClient({
  apiKeyEnvVar: 'BLOCKCYPHER_API_KEY',
  baseUrl: 'https://api.blockcypher.com/v1/btc/main',
  blockchain: 'bitcoin',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances', 'hasAddressTransactions'],
    supportedTransactionTypes: ['normal'],
    supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 4 },
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 5, // Allow short bursts
      requestsPerHour: 100, // Hard limit per BlockCypher docs
      requestsPerMinute: 100, // Spread out to ~600/hour equivalent, but capped by hourly limit
      requestsPerSecond: 3, // Conservative rate for sustained usage
    },
    retries: 3,
    timeout: 15000, // Longer timeout for BlockCypher
  },
  description:
    'Bitcoin blockchain API with high-performance transaction data and balance queries (API key optional for GET requests)',
  displayName: 'BlockCypher API',
  name: 'blockcypher',
  requiresApiKey: false,
})
export class BlockCypherApiClient extends BaseApiClient {
  private readonly chainConfig: BitcoinChainConfig;

  constructor(config: ProviderConfig) {
    super(config);

    const chainConfig = getBitcoinChainConfig(config.blockchain);
    if (!chainConfig) {
      throw new Error(`Unsupported blockchain: ${config.blockchain}`);
    }
    this.chainConfig = chainConfig;

    this.logger.debug(
      `Initialized BlockCypherApiClient from registry metadata - BaseUrl: ${this.baseUrl}, HasApiKey: ${this.apiKey !== 'YourApiKeyToken'}`
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
      endpoint: '/',
      validate: (response: unknown) => {
        const data = response as { name?: string };
        return hasStringProperty(data, 'name');
      },
    };
  }

  private buildEndpoint(endpoint: string): string {
    if (this.apiKey) {
      const separator = endpoint.includes('?') ? '&' : '?';
      return `${endpoint}${separator}token=${this.apiKey}`;
    }
    return endpoint;
  }

  /**
   * Fetch a complete transaction with all inputs and outputs (handles pagination)
   */
  private async fetchCompleteTransaction(txHash: string): Promise<Result<BlockCypherTransaction, Error>> {
    const initialResult = await this.httpClient.get<BlockCypherTransaction>(
      this.buildEndpoint(`/txs/${txHash}?limit=100`),
      { schema: BlockCypherTransactionSchema }
    );

    if (initialResult.isErr()) {
      return err(initialResult.error);
    }

    const transaction = { ...initialResult.value };
    while (transaction.next_outputs) {
      this.logger.debug(`Fetching next outputs for transaction ${txHash}: ${transaction.next_outputs}`);

      const nextOutputsResult = await this.httpClient.get<{
        next_outputs?: string | undefined;
        outputs: BlockCypherTransaction['outputs'];
      }>(transaction.next_outputs.replace('https://api.blockcypher.com/v1/btc/main', ''), {
        schema: z.object({
          next_outputs: z.string().optional(),
          outputs: z.array(BlockCypherOutputSchema),
        }),
      });

      if (nextOutputsResult.isErr()) {
        this.logger.warn(
          `Failed to fetch paginated outputs for transaction ${txHash}: ${getErrorMessage(nextOutputsResult.error)}`
        );
        break; // Don't fail the entire transaction for pagination issues
      }

      const nextOutputsResponse = nextOutputsResult.value;
      transaction.outputs.push(...nextOutputsResponse.outputs);
      transaction.next_outputs = nextOutputsResponse.next_outputs;

      // Update output count
      if (transaction.vout_sz) {
        transaction.vout_sz = transaction.outputs.length;
      }
    }

    // Handle paginated inputs if needed (less common but possible)
    while (transaction.next_inputs) {
      this.logger.debug(`Fetching next inputs for transaction ${txHash}: ${transaction.next_inputs}`);

      const nextInputsResult = await this.httpClient.get<{
        inputs: BlockCypherTransaction['inputs'];
        next_inputs?: string | undefined;
      }>(transaction.next_inputs.replace('https://api.blockcypher.com/v1/btc/main', ''), {
        schema: z.object({
          inputs: z.array(BlockCypherInputSchema),
          next_inputs: z.string().optional(),
        }),
      });

      if (nextInputsResult.isErr()) {
        this.logger.warn(
          `Failed to fetch paginated inputs for transaction ${txHash}: ${getErrorMessage(nextInputsResult.error)}`
        );
        break; // Don't fail the entire transaction for pagination issues
      }

      const nextInputsResponse = nextInputsResult.value;
      transaction.inputs.push(...nextInputsResponse.inputs);
      transaction.next_inputs = nextInputsResponse.next_inputs;

      // Update input count
      if (transaction.vin_sz) {
        transaction.vin_sz = transaction.inputs.length;
      }
    }

    this.logger.debug(
      `Complete transaction fetched - TxHash: ${txHash}, Inputs: ${transaction.inputs.length}, Outputs: ${transaction.outputs.length}${transaction.next_outputs || transaction.next_inputs ? ' (had pagination)' : ''}`
    );

    return ok(transaction);
  }

  /**
   * Check if address has any transactions
   */
  private async hasAddressTransactions(params: { address: string }): Promise<Result<boolean, Error>> {
    const { address } = params;

    this.logger.debug(`Checking if address has transactions - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<BlockCypherAddress>(this.buildEndpoint(`/addrs/${address}/balance`), {
      schema: BlockCypherAddressSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to check address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const addressInfo = result.value;
    const hasTransactions = addressInfo.final_n_tx > 0;

    this.logger.debug(
      `Address transaction check complete - Address: ${maskAddress(address)}, HasTransactions: ${hasTransactions}`
    );

    return ok(hasTransactions);
  }

  /**
   * Get raw address info
   */
  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    this.logger.debug(`Fetching raw address info - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<BlockCypherAddress>(this.buildEndpoint(`/addrs/${address}/balance`), {
      schema: BlockCypherAddressSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address info - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const addressInfo = result.value;
    const { balanceBTC, balanceSats } = calculateSimpleBalance(addressInfo.final_balance);

    this.logger.debug(
      `Successfully retrieved raw address info - Address: ${maskAddress(address)}, Balance: ${addressInfo.final_balance}`
    );

    return ok(createRawBalanceData(balanceSats, balanceBTC, this.chainConfig.nativeCurrency));
  }

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<BitcoinTransaction>, Error>> {
    const pageSize = 50; // BlockCypher max page size for transaction references

    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<BlockCypherTransaction>, Error>> => {
      // Build endpoint with pagination
      // BlockCypher uses 'before' parameter with block height for pagination
      let endpoint = `/addrs/${address}?limit=${pageSize}`;

      // Use pageToken for pagination (contains the last tx_hash from previous page)
      if (ctx.pageToken) {
        endpoint += `&before=${ctx.pageToken}`;
      }

      // Apply replay window if we have a block cursor
      if (ctx.replayedCursor?.type === 'blockNumber') {
        // BlockCypher doesn't support filtering by blockFrom directly,
        // but we can use the block height in the 'before' parameter
        endpoint += `&before=${ctx.replayedCursor.value}`;
      }

      // Fetch transaction references
      const addressResult = await this.httpClient.get<BlockCypherAddress>(this.buildEndpoint(endpoint), {
        schema: BlockCypherAddressSchema,
      });

      if (addressResult.isErr()) {
        this.logger.error(
          `Failed to fetch address transactions for ${maskAddress(address)} - Error: ${getErrorMessage(addressResult.error)}`
        );
        return err(addressResult.error);
      }

      const addressInfo = addressResult.value;

      if (!addressInfo.txrefs || addressInfo.txrefs.length === 0) {
        return ok({
          items: [],
          nextPageToken: undefined,
          isComplete: true,
        });
      }

      // Extract unique transaction hashes
      const uniqueTxHashes = [...new Set(addressInfo.txrefs.map((ref) => ref.tx_hash))];

      // Fetch detailed transaction data for each hash
      const transactions: BlockCypherTransaction[] = [];

      for (const txHash of uniqueTxHashes) {
        const txResult = await this.fetchCompleteTransaction(txHash);

        if (txResult.isErr()) {
          this.logger.warn(
            `Failed to fetch transaction details - TxHash: ${txHash}, Error: ${getErrorMessage(txResult.error)}`
          );
          continue;
        }

        transactions.push(txResult.value);
      }

      // Determine if there are more pages
      // BlockCypher indicates more data via hasMore field or by checking if we got a full page
      const hasMore = addressInfo.hasMore === true || addressInfo.txrefs.length === pageSize;

      // Next page token is the block height of the last transaction reference
      const nextPageToken =
        hasMore && addressInfo.txrefs.length > 0
          ? String(addressInfo.txrefs[addressInfo.txrefs.length - 1]!.block_height)
          : undefined;

      return ok({
        items: transactions,
        nextPageToken,
        isComplete: !hasMore,
      });
    };

    return createStreamingIterator<BlockCypherTransaction, BitcoinTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapBlockCypherTransaction(raw, this.chainConfig);
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
}
