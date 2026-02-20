import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import type {
  NormalizedTransactionBase,
  OneShotOperation,
  ProviderConfig,
  ProviderFactory,
  ProviderMetadata,
  ProviderOperation,
  RawBalanceData,
  StreamingBatchResult,
  StreamingOperation,
} from '../../../../core/index.js';
import { BaseApiClient, maskAddress } from '../../../../core/index.js';
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

import { mapMempoolSpaceTransaction } from './mapper-utils.js';
import {
  MempoolAddressInfoSchema,
  MempoolTransactionSchema,
  type MempoolAddressInfo,
  type MempoolTransaction,
} from './mempool-space.schemas.js';
import { calculateMempoolSpaceBalance } from './utils.js';

export const mempoolSpaceMetadata: ProviderMetadata = {
  baseUrl: 'https://mempool.space/api',
  blockchain: 'bitcoin',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances', 'hasAddressTransactions'],
    supportedTransactionTypes: ['normal'],
    supportedCursorTypes: ['txHash', 'blockNumber', 'timestamp'],
    preferredCursorType: 'txHash',
    replayWindow: { blocks: 4 },
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 8,
      requestsPerHour: 12960,
      requestsPerMinute: 120,
      requestsPerSecond: 0.4,
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Bitcoin blockchain explorer API with comprehensive transaction and balance data (no API key required)',
  displayName: 'Mempool.space API',
  name: 'mempool.space',
  requiresApiKey: false,
};

export const mempoolSpaceFactory: ProviderFactory = {
  create: (config: ProviderConfig) => new MempoolSpaceApiClient(config),
  metadata: mempoolSpaceMetadata,
};

export class MempoolSpaceApiClient extends BaseApiClient {
  private readonly chainConfig: BitcoinChainConfig;

  constructor(config: ProviderConfig) {
    super(config);

    const chainConfig = getBitcoinChainConfig(config.blockchain);
    if (!chainConfig) {
      throw new Error(`Unsupported blockchain: ${config.blockchain}`);
    }
    this.chainConfig = chainConfig;

    this.logger.debug(`Initialized MempoolSpaceApiClient from registry metadata - BaseUrl: ${this.baseUrl}`);
  }

  extractCursors(transaction: BitcoinTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    // Primary cursor: transaction hash for Mempool.space pagination
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

    const result = await this.httpClient.get<MempoolAddressInfo>(`/address/${address}`, {
      schema: MempoolAddressInfoSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to check address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const addressInfo = result.value;
    const { hasTransactions } = calculateMempoolSpaceBalance(addressInfo);

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

    const result = await this.httpClient.get<MempoolAddressInfo>(`/address/${address}`, {
      schema: MempoolAddressInfoSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to get address info - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const addressInfo = result.value;
    const { balanceBTC, totalBalanceSats } = calculateMempoolSpaceBalance(addressInfo);

    this.logger.debug(
      `Successfully retrieved lightweight address info - Address: ${maskAddress(address)}, BalanceBTC: ${balanceBTC}`
    );

    return ok(createRawBalanceData(totalBalanceSats, balanceBTC, this.chainConfig.nativeCurrency));
  }

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<BitcoinTransaction>, Error>> {
    const fetchPage = async (ctx: StreamingPageContext): Promise<Result<StreamingPage<MempoolTransaction>, Error>> => {
      let endpoint: string;

      // Mempool.space uses txid-based pagination
      // First page: /address/:address/txs/chain
      // Subsequent pages: /address/:address/txs/chain/:last_seen_txid
      if (ctx.pageToken) {
        endpoint = `/address/${address}/txs/chain/${ctx.pageToken}`;
      } else {
        endpoint = `/address/${address}/txs/chain`;
      }

      const result = await this.httpClient.get<MempoolTransaction[]>(endpoint, {
        schema: z.array(MempoolTransactionSchema),
      });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch address transactions for ${maskAddress(address)} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const items = result.value;

      // Mempool.space returns up to 25 transactions per page
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

    return createStreamingIterator<MempoolTransaction, BitcoinTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapMempoolSpaceTransaction(raw, this.chainConfig);
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
