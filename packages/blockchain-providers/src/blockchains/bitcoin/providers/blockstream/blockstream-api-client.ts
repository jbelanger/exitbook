import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { progress } from '@exitbook/ui';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

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
import { calculateBlockstreamBalance, createRawBalanceData } from '../../balance-utils.js';
import { BITCOIN_STREAMING_DEDUP_WINDOW } from '../../bitcoin-streaming.constants.js';
import type { BitcoinChainConfig } from '../../chain-config.interface.js';
import { getBitcoinChainConfig } from '../../chain-registry.js';
import type { BitcoinTransaction } from '../../schemas.js';

import {
  BlockstreamAddressInfoSchema,
  BlockstreamTransactionSchema,
  type BlockstreamAddressInfo,
  type BlockstreamTransaction,
} from './blockstream.schemas.js';
import { mapBlockstreamTransaction } from './mapper-utils.js';

@RegisterApiClient({
  apiKeyEnvVar: 'BLOCKSTREAM_API_KEY',
  baseUrl: 'https://blockstream.info/api',
  blockchain: 'bitcoin',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances', 'hasAddressTransactions'],
    supportedCursorTypes: ['txHash', 'blockNumber', 'timestamp'],
    preferredCursorType: 'txHash',
    replayWindow: { blocks: 6 },
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 15,
      requestsPerHour: 12960,
      requestsPerMinute: 216,
      requestsPerSecond: 4,
    },
    retries: 3,
    timeout: 10000,
  },
  description:
    'Bitcoin blockchain explorer API with comprehensive transaction data and pagination support (no API key required)',
  displayName: 'Blockstream.info API',
  name: 'blockstream.info',
  requiresApiKey: false,
})
export class BlockstreamApiClient extends BaseApiClient {
  private readonly chainConfig: BitcoinChainConfig;

  constructor(config: ProviderConfig) {
    super(config);

    const chainConfig = getBitcoinChainConfig(config.blockchain);
    if (!chainConfig) {
      throw new Error(`Unsupported blockchain: ${config.blockchain}`);
    }
    this.chainConfig = chainConfig;

    this.logger.debug(`Initialized BlockstreamApiClient from registry metadata - BaseUrl: ${this.baseUrl}`);
  }

  extractCursors(transaction: BitcoinTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    // Primary cursor: transaction hash for Blockstream pagination
    cursors.push({ type: 'txHash', value: transaction.id });

    // Alternative cursor: block height
    if (transaction.blockHeight !== undefined) {
      cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
    }

    // Alternative cursor: timestamp
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
        return (await this.getAddressTransactions({
          address: operation.address,
        })) as Result<T, Error>;
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

  getHealthCheckConfig() {
    return {
      endpoint: '/blocks/tip/height',
      validate: (response: unknown) => {
        return typeof response === 'number' && response > 0;
      },
    };
  }

  /**
   * Check if address has any transactions
   */
  private async hasAddressTransactions(params: { address: string }): Promise<Result<boolean, Error>> {
    const { address } = params;

    this.logger.debug(`Checking if address has transactions - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<BlockstreamAddressInfo>(`/address/${address}`, {
      schema: BlockstreamAddressInfoSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to check address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const addressInfo = result.value;
    const { hasTransactions } = calculateBlockstreamBalance(addressInfo);

    this.logger.debug(
      `Address transaction check complete - Address: ${maskAddress(address)}, HasTransactions: ${hasTransactions}`
    );

    return ok(hasTransactions);
  }

  /**
   * Get lightweight address info for efficient gap scanning
   */
  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    this.logger.debug(`Fetching lightweight address info - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get<BlockstreamAddressInfo>(`/address/${address}`, {
      schema: BlockstreamAddressInfoSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to get address info - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const addressInfo = result.value;
    const { balanceBTC, totalBalanceSats } = calculateBlockstreamBalance(addressInfo);

    this.logger.debug(
      `Successfully retrieved lightweight address info - Address: ${maskAddress(address)}, BalanceBTC: ${balanceBTC}`
    );

    return ok(createRawBalanceData(totalBalanceSats, balanceBTC, this.chainConfig.nativeCurrency));
  }

  /**
   * Get raw transaction data without transformation for wallet-aware parsing
   */
  private async getAddressTransactions(params: {
    address: string;
  }): Promise<Result<TransactionWithRawData<BitcoinTransaction>[], Error>> {
    const { address } = params;

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);
    progress.log(`Fetching transactions for ${maskAddress(address)}`, 'BlockstreamAPI');

    const addressInfoResult = await this.httpClient.get<BlockstreamAddressInfo>(`/address/${address}`, {
      schema: BlockstreamAddressInfoSchema,
    });

    if (addressInfoResult.isErr()) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(addressInfoResult.error)}`
      );
      return err(addressInfoResult.error);
    }

    const addressInfo = addressInfoResult.value;

    if (addressInfo.chain_stats.tx_count === 0 && addressInfo.mempool_stats.tx_count === 0) {
      this.logger.debug(`No raw transactions found for address - Address: ${maskAddress(address)}`);
      progress.log('No transactions found', 'BlockstreamAPI');
      return ok([]);
    }

    const allTransactions: TransactionWithRawData<BitcoinTransaction>[] = [];
    let lastSeenTxid: string | undefined;
    let hasMore = true;
    let batchCount = 0;
    const maxBatches = 50;

    while (hasMore && batchCount < maxBatches) {
      const endpoint = lastSeenTxid ? `/address/${address}/txs/chain/${lastSeenTxid}` : `/address/${address}/txs`;

      const txResult = await this.httpClient.get<BlockstreamTransaction[]>(endpoint, {
        schema: z.array(BlockstreamTransactionSchema),
      });

      if (txResult.isErr()) {
        this.logger.error(
          `Failed to get raw address transactions batch - Address: ${maskAddress(address)}, Error: ${getErrorMessage(txResult.error)}`
        );
        return err(txResult.error);
      }

      const rawTransactions = txResult.value;

      if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
        hasMore = false;
        break;
      }

      this.logger.debug(
        `Retrieved raw transaction batch - Address: ${maskAddress(address)}, BatchSize: ${rawTransactions.length}, Batch: ${batchCount + 1}`
      );
      progress.update(
        `Retrieved batch ${batchCount + 1}`,
        allTransactions.length + rawTransactions.length,
        undefined,
        'BlockstreamAPI'
      );

      const validRawTransactions = rawTransactions.filter((tx): tx is BlockstreamTransaction => tx !== null);
      for (const rawTx of validRawTransactions) {
        const mapResult = mapBlockstreamTransaction(rawTx, this.chainConfig);

        if (mapResult.isErr()) {
          const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
          this.logger.error(
            `Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`
          );
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }

        allTransactions.push({
          raw: rawTx,
          normalized: mapResult.value,
        });
      }

      lastSeenTxid = rawTransactions.length > 0 ? rawTransactions[rawTransactions.length - 1]?.txid : undefined;
      hasMore = rawTransactions.length === 25;
      batchCount++;
    }

    this.logger.debug(
      `Successfully retrieved and normalized address transactions - Address: ${maskAddress(address)}, TotalTransactions: ${allTransactions.length}, BatchesProcessed: ${batchCount}`
    );
    progress.log(`Retrieved ${allTransactions.length} transactions in ${batchCount} batches`, 'BlockstreamAPI');

    return ok(allTransactions);
  }

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<BitcoinTransaction>, Error>> {
    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<BlockstreamTransaction>, Error>> => {
      let endpoint: string;

      // Blockstream uses txid-based pagination
      // First page: /address/:address/txs
      // Subsequent pages: /address/:address/txs/chain/:last_seen_txid
      if (ctx.pageToken) {
        endpoint = `/address/${address}/txs/chain/${ctx.pageToken}`;
      } else {
        endpoint = `/address/${address}/txs`;
      }

      const result = await this.httpClient.get<BlockstreamTransaction[]>(endpoint, {
        schema: z.array(BlockstreamTransactionSchema),
      });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch address transactions for ${maskAddress(address)} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const items = result.value;

      // Blockstream returns up to 25 transactions per page
      // If we get exactly 25, there might be more
      const pageSize = 25;
      const hasMore = items.length === pageSize;

      // Next page token is the txid of the last transaction
      const nextPageToken = hasMore && items.length > 0 ? items[items.length - 1]!.txid : undefined;

      return ok({
        items,
        nextPageToken,
        isComplete: !hasMore,
      });
    };

    return createStreamingIterator<BlockstreamTransaction, BitcoinTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapBlockstreamTransaction(raw, this.chainConfig);
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
}
