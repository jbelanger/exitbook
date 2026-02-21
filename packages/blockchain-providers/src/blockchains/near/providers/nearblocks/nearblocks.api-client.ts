import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage, parseDecimal } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type {
  NormalizedTransactionBase,
  OneShotOperation,
  OneShotOperationResult,
  ProviderConfig,
  ProviderFactory,
  ProviderMetadata,
  ProviderOperation,
  RawBalanceData,
  StreamingBatchResult,
  StreamingOperation,
} from '../../../../core/index.js';
import { BaseApiClient, maskAddress, validateOutput } from '../../../../core/index.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../core/streaming/streaming-adapter.js';
import { transformNearBalance } from '../../balance-utils.js';
import type {
  NearBalanceChange,
  NearReceipt,
  NearStreamEvent,
  NearTokenTransfer,
  NearTransaction,
} from '../../schemas.js';
import {
  NearBalanceChangeSchema,
  NearReceiptSchema,
  NearTokenTransferSchema,
  NearTransactionSchema,
} from '../../schemas.js';
import { isValidNearAccountId } from '../../utils.js';

import {
  mapRawActivityToBalanceChange,
  mapRawFtToTokenTransfer,
  mapRawReceiptToNearReceipt,
  mapRawTransactionToNearTransaction,
} from './mapper-utils.js';
import {
  NearBlocksAccountSchema,
  NearBlocksActivitiesResponseSchema,
  NearBlocksFtTransactionsResponseSchema,
  NearBlocksReceiptsResponseSchema,
  NearBlocksTransactionsResponseSchema,
  type NearBlocksActivity,
  type NearBlocksFtTransaction,
  type NearBlocksReceipt,
  type NearBlocksTransaction,
} from './nearblocks.schemas.js';

// NearBlocks API pagination: Optimal batch size balancing API limits, memory usage, and latency
const NEARBLOCKS_PAGE_SIZE = 25;

// Deduplication window: Covers replay overlap (3 blocks × ~70 txs/block = ~210 items max)
// Sized conservatively at 200 to prevent duplicates without excessive memory usage
const NEARBLOCKS_DEDUP_WINDOW_SIZE = 200;

/**
 * NearBlocks API Client
 *
 * Provides 4 transaction types for getAddressTransactions:
 * 1. transactions - Base transaction metadata
 * 2. receipts - Receipt execution records
 * 3. balance-changes - Balance changes
 * 4. token-transfers - Token transfers
 *
 * Features:
 * - No correlation at provider level (deferred to processor)
 * - Cursor-based pagination
 * - Two-hop correlation via receipts (transactions → receipts → balance changes)
 * - Each type independently resumable
 */
export const nearblocksMetadata: ProviderMetadata = {
  apiKeyEnvVar: 'NEARBLOCKS_API_KEY',
  baseUrl: 'https://api.nearblocks.io',
  blockchain: 'near',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
    supportedTransactionTypes: ['transactions', 'receipts', 'balance-changes', 'token-transfers'],
    supportedCursorTypes: ['pageToken', 'timestamp'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 3 },
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 1,
      requestsPerHour: 250,
      requestsPerMinute: 6,
      requestsPerSecond: 0.1,
    },
    retries: 3,
    timeout: 30000,
  },
  description: 'NearBlocks API for NEAR blockchain with 4 normalized transaction types for discrete streaming',
  displayName: 'NearBlocks',
  name: 'nearblocks',
  requiresApiKey: false,
};

export const nearblocksFactory: ProviderFactory = {
  create: (config: ProviderConfig) => new NearBlocksApiClient(config),
  metadata: nearblocksMetadata,
};

export class NearBlocksApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super(config);

    if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
      this.reinitializeHttpClient({
        baseUrl: this.baseUrl,
        defaultHeaders: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
    }
  }

  extractCursors(event: NearStreamEvent): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    // Access timestamp and blockHeight from normalized event based on stream type
    let timestamp: number | undefined;
    let blockHeight: number | undefined;

    switch (event.streamType) {
      case 'transactions':
        timestamp = event.timestamp;
        blockHeight = event.blockHeight;
        break;
      case 'receipts':
        timestamp = event.timestamp;
        blockHeight = event.blockHeight;
        break;
      case 'balance-changes':
        timestamp = event.timestamp;
        blockHeight = typeof event.blockHeight === 'string' ? parseInt(event.blockHeight, 10) : undefined;
        break;
      case 'token-transfers':
        timestamp = event.timestamp;
        blockHeight = event.blockHeight;
        break;
    }

    if (timestamp) {
      cursors.push({ type: 'timestamp', value: timestamp });
    }

    if (blockHeight !== undefined) {
      cursors.push({ type: 'blockNumber', value: blockHeight });
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

  async execute<TOperation extends OneShotOperation>(
    operation: TOperation
  ): Promise<Result<OneShotOperationResult<TOperation>, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getAddressBalances':
        return (await this.getAddressBalances({
          address: operation.address,
        })) as Result<OneShotOperationResult<TOperation>, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  async *executeStreaming<T extends NormalizedTransactionBase = NormalizedTransactionBase>(
    operation: StreamingOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    if (operation.type !== 'getAddressTransactions') {
      yield err(new Error(`Streaming not supported for operation: ${(operation as ProviderOperation).type}`));
      return;
    }

    if (!('address' in operation)) {
      yield err(new Error('Address required for streaming operations'));
      return;
    }

    if (!isValidNearAccountId(operation.address)) {
      yield err(new Error(`Invalid NEAR account ID: ${operation.address}`));
      return;
    }

    const address = operation.address;
    const streamType = operation.streamType || 'transactions';

    switch (streamType) {
      case 'transactions':
        yield* this.streamTransactions(address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      case 'receipts':
        yield* this.streamReceipts(address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      case 'balance-changes':
        yield* this.streamBalanceChanges(address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      case 'token-transfers':
        yield* this.streamTokenTransfers(address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      default:
        yield err(new Error(`Unsupported transaction type: ${streamType}`));
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/v1/stats',
      method: 'GET' as const,
      validate: (response: unknown) => {
        return response !== null && response !== undefined && typeof response === 'object';
      },
    };
  }

  /**
   * Stream transactions from /txns-only endpoint
   */
  private streamTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<NearTransaction>, Error>> {
    const resumeAfterDate = this.getResumeAfterDate(resumeCursor);
    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<NearBlocksTransaction>, Error>> => {
      const cursor = ctx.pageToken;

      const afterDate = !cursor ? resumeAfterDate : undefined;
      const url = cursor
        ? `/v1/account/${address}/txns-only?cursor=${cursor}&per_page=${NEARBLOCKS_PAGE_SIZE}&order=asc`
        : `/v1/account/${address}/txns-only?per_page=${NEARBLOCKS_PAGE_SIZE}&order=asc${
            afterDate ? `&after_date=${afterDate}` : ''
          }`;

      const result = await this.httpClient.get(url, {
        schema: NearBlocksTransactionsResponseSchema,
      });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch transactions - Address: ${maskAddress(address)}, Cursor: ${cursor || 'initial'}, Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const data = result.value;
      const txns = data.txns || [];

      this.logger.debug(
        `Fetched transactions - Address: ${maskAddress(address)}, Count: ${txns.length}, Next: ${data.cursor ? 'yes' : 'no'}`
      );

      return ok({
        items: txns,
        nextPageToken: data.cursor ?? undefined,
        isComplete: txns.length === 0 || !data.cursor,
      });
    };

    return createStreamingIterator<NearBlocksTransaction, NearTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address, streamType: 'transactions' },
      resumeCursor,
      fetchPage,
      mapItem: (txn) => {
        const mapResult = mapRawTransactionToNearTransaction(txn);
        if (mapResult.isErr()) {
          return err(mapResult.error);
        }

        const validationResult = validateOutput(mapResult.value, NearTransactionSchema, 'NearTransaction');
        if (validationResult.isErr()) {
          const errorMessage =
            validationResult.error.type === 'error' ? validationResult.error.message : validationResult.error.reason;
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }

        return ok([{ raw: txn, normalized: validationResult.value }]);
      },
      extractCursors: (event) => this.extractCursors(event),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: NEARBLOCKS_DEDUP_WINDOW_SIZE,
      logger: this.logger,
    });
  }

  private getResumeAfterDate(resumeCursor?: CursorState): string | undefined {
    const timestampCursor =
      resumeCursor?.primary.type === 'timestamp'
        ? resumeCursor.primary
        : resumeCursor?.alternatives?.find((cursor) => cursor.type === 'timestamp');

    if (!timestampCursor || timestampCursor.type !== 'timestamp') {
      return undefined;
    }

    const value = typeof timestampCursor.value === 'number' ? timestampCursor.value : Number(timestampCursor.value);
    if (!Number.isFinite(value)) {
      return undefined;
    }

    return new Date(value).toISOString().slice(0, 10);
  }

  /**
   * Stream receipts from /receipts endpoint
   */
  private streamReceipts(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<NearReceipt>, Error>> {
    const resumeAfterDate = this.getResumeAfterDate(resumeCursor);
    const fetchPage = async (ctx: StreamingPageContext): Promise<Result<StreamingPage<NearBlocksReceipt>, Error>> => {
      const cursor = ctx.pageToken;

      const afterDate = !cursor ? resumeAfterDate : undefined;
      const url = cursor
        ? `/v1/account/${address}/receipts?cursor=${cursor}&per_page=${NEARBLOCKS_PAGE_SIZE}&order=asc`
        : `/v1/account/${address}/receipts?per_page=${NEARBLOCKS_PAGE_SIZE}&order=asc${
            afterDate ? `&after_date=${afterDate}` : ''
          }`;

      const result = await this.httpClient.get(url, {
        schema: NearBlocksReceiptsResponseSchema,
      });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch receipts - Address: ${maskAddress(address)}, Cursor: ${cursor || 'initial'}, Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const data = result.value;
      const receipts = data.txns || [];

      this.logger.debug(
        `Fetched receipts - Address: ${maskAddress(address)}, Count: ${receipts.length}, Next: ${data.cursor ? 'yes' : 'no'}`
      );

      return ok({
        items: receipts,
        nextPageToken: data.cursor ?? undefined,
        isComplete: receipts.length === 0 || !data.cursor,
      });
    };

    return createStreamingIterator<NearBlocksReceipt, NearReceipt>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address, streamType: 'receipts' },
      resumeCursor,
      fetchPage,
      mapItem: (receipt) => {
        const mapResult = mapRawReceiptToNearReceipt(receipt);
        if (mapResult.isErr()) {
          return err(mapResult.error);
        }

        const validationResult = validateOutput(mapResult.value, NearReceiptSchema, 'NearReceipt');
        if (validationResult.isErr()) {
          const errorMessage =
            validationResult.error.type === 'error' ? validationResult.error.message : validationResult.error.reason;
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }

        return ok([{ raw: receipt, normalized: validationResult.value }]);
      },
      extractCursors: (event) => this.extractCursors(event),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: NEARBLOCKS_DEDUP_WINDOW_SIZE,
      logger: this.logger,
    });
  }

  /**
   * Stream balance changes from /activities endpoint
   * Fails if both transaction_hash and receipt_id are null (orphan)
   */
  private streamBalanceChanges(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<NearBalanceChange>, Error>> {
    const resumeAfterDate = this.getResumeAfterDate(resumeCursor);
    const fetchPage = async (ctx: StreamingPageContext): Promise<Result<StreamingPage<NearBlocksActivity>, Error>> => {
      const cursor = ctx.pageToken;

      const afterDate = !cursor ? resumeAfterDate : undefined;
      const url = cursor
        ? `/v1/account/${address}/activities?cursor=${cursor}&per_page=${NEARBLOCKS_PAGE_SIZE}&order=asc`
        : `/v1/account/${address}/activities?per_page=${NEARBLOCKS_PAGE_SIZE}&order=asc${
            afterDate ? `&after_date=${afterDate}` : ''
          }`;

      const result = await this.httpClient.get(url, {
        schema: NearBlocksActivitiesResponseSchema,
      });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch activities - Address: ${maskAddress(address)}, Cursor: ${cursor || 'initial'}, Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const data = result.value;
      const activities = data.activities || [];

      // Fail if both transaction_hash and receipt_id are missing (orphan detection)
      for (const activity of activities) {
        if (!activity.transaction_hash && !activity.receipt_id) {
          const error = new Error(
            `Activity missing both transaction_hash and receipt_id. ` +
              `Account: ${activity.affected_account_id}, Block: ${activity.block_height}`
          );
          this.logger.error(`Orphaned activity detected - ${error.message}`);
          return err(error);
        }
      }

      this.logger.debug(
        `Fetched activities - Address: ${maskAddress(address)}, Count: ${activities.length}, Next: ${data.cursor ? 'yes' : 'no'}`
      );

      return ok({
        items: activities,
        nextPageToken: data.cursor ?? undefined,
        isComplete: activities.length === 0 || !data.cursor,
      });
    };

    return createStreamingIterator<NearBlocksActivity, NearBalanceChange>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address, streamType: 'balance-changes' },
      resumeCursor,
      fetchPage,
      mapItem: (activity) => {
        const mapResult = mapRawActivityToBalanceChange(activity);
        if (mapResult.isErr()) {
          return err(mapResult.error);
        }

        const validationResult = validateOutput(mapResult.value, NearBalanceChangeSchema, 'NearBalanceChange');
        if (validationResult.isErr()) {
          const errorMessage =
            validationResult.error.type === 'error' ? validationResult.error.message : validationResult.error.reason;
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }

        return ok([{ raw: activity, normalized: validationResult.value }]);
      },
      extractCursors: (event) => this.extractCursors(event),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: NEARBLOCKS_DEDUP_WINDOW_SIZE,
      logger: this.logger,
    });
  }

  /**
   * Stream token transfers from /ft-txns endpoint
   */
  private streamTokenTransfers(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<NearTokenTransfer>, Error>> {
    const resumeAfterDate = this.getResumeAfterDate(resumeCursor);
    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<NearBlocksFtTransaction>, Error>> => {
      const cursor = ctx.pageToken;

      const afterDate = !cursor ? resumeAfterDate : undefined;
      const url = cursor
        ? `/v1/account/${address}/ft-txns?cursor=${cursor}&per_page=${NEARBLOCKS_PAGE_SIZE}&order=asc`
        : `/v1/account/${address}/ft-txns?per_page=${NEARBLOCKS_PAGE_SIZE}&order=asc${
            afterDate ? `&after_date=${afterDate}` : ''
          }`;

      const result = await this.httpClient.get(url, {
        schema: NearBlocksFtTransactionsResponseSchema,
      });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch FT transfers - Address: ${maskAddress(address)}, Cursor: ${cursor || 'initial'}, Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const data = result.value;
      const ftTransfers = data.txns || [];

      this.logger.debug(
        `Fetched FT transfers - Address: ${maskAddress(address)}, Count: ${ftTransfers.length}, Next: ${data.cursor ? 'yes' : 'no'}`
      );

      return ok({
        items: ftTransfers,
        nextPageToken: data.cursor ?? undefined,
        isComplete: ftTransfers.length === 0 || !data.cursor,
      });
    };

    return createStreamingIterator<NearBlocksFtTransaction, NearTokenTransfer>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address, streamType: 'token-transfers' },
      resumeCursor,
      fetchPage,
      mapItem: (ft) => {
        const mapResult = mapRawFtToTokenTransfer(ft);
        if (mapResult.isErr()) {
          return err(mapResult.error);
        }

        const validationResult = validateOutput(mapResult.value, NearTokenTransferSchema, 'NearTokenTransfer');
        if (validationResult.isErr()) {
          const errorMessage =
            validationResult.error.type === 'error' ? validationResult.error.message : validationResult.error.reason;
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }

        return ok([{ raw: ft, normalized: validationResult.value }]);
      },
      extractCursors: (event) => this.extractCursors(event),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: NEARBLOCKS_DEDUP_WINDOW_SIZE,
      logger: this.logger,
    });
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    if (!isValidNearAccountId(address)) {
      return err(new Error(`Invalid NEAR account ID: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.get(`/v1/account/${address}`, { schema: NearBlocksAccountSchema });

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const accountResponse = result.value;

    const accounts = accountResponse.account;
    if (accounts.length === 0) {
      return err(new Error('No account data returned from NearBlocks'));
    }

    if (accounts.length > 1) {
      this.logger.warn(
        `Unexpected: NearBlocks returned ${accounts.length} accounts for address ${maskAddress(address)}, using first account`
      );
    }

    const accountData = accounts[0]!;
    const amountYocto = accountData.amount;
    const lockedYocto = accountData.locked;

    let availableYocto = amountYocto.toString();
    if (lockedYocto !== null && lockedYocto !== undefined) {
      const lockedDecimal = parseDecimal(lockedYocto.toString());
      if (!lockedDecimal.isZero()) {
        const amountDecimal = parseDecimal(amountYocto.toString());
        const remaining = amountDecimal.minus(lockedDecimal);
        if (remaining.isNegative()) {
          this.logger.warn(
            `NearBlocks returned locked > amount for ${maskAddress(address)} (locked=${lockedDecimal.toFixed()}, amount=${amountDecimal.toFixed()}); using total amount`
          );
        } else {
          availableYocto = remaining.toFixed();
        }
      }
    }

    const balanceData = transformNearBalance(availableYocto);

    this.logger.debug(
      `Successfully retrieved raw address balance - Address: ${maskAddress(address)}, NEAR: ${balanceData.decimalAmount}`
    );

    return ok(balanceData);
  }
}
