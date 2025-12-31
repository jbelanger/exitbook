import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage, parseDecimal } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type {
  NormalizedTransactionBase,
  ProviderConfig,
  ProviderOperation,
  RawBalanceData,
  StreamingBatchResult,
} from '../../../../core/index.ts';
import { RegisterApiClient, BaseApiClient, maskAddress } from '../../../../core/index.ts';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../core/streaming/streaming-adapter.js';
import { transformNearBalance } from '../../balance-utils.ts';
import type { NearTransaction } from '../../schemas.ts';
import { isValidNearAccountId } from '../../utils.ts';

import {
  mapNearBlocksActivityToAccountChange,
  mapNearBlocksFtTransactionToTransaction,
  mapNearBlocksTransaction,
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

// Enrichment pagination limits to avoid unbounded requests while still covering multi-receipt batches
const MAX_ENRICHMENT_EXTRA_PAGES = 5;

@RegisterApiClient({
  apiKeyEnvVar: 'NEARBLOCKS_API_KEY',
  baseUrl: 'https://api.nearblocks.io',
  blockchain: 'near',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
    supportedTransactionTypes: ['normal', 'token'],
    supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 3 },
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 1,
      requestsPerHour: 250,
      requestsPerMinute: 6, // NearBlocks: 50 records = 2 credits, so we use 25 records/request = 6 requests/min
      requestsPerSecond: 0.1,
    },
    retries: 3,
    timeout: 30000,
  },
  description: 'NearBlocks API for NEAR blockchain transaction data and account balances',
  displayName: 'NearBlocks',
  name: 'nearblocks',
  requiresApiKey: false,
})
export class NearBlocksApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super(config);

    // Initialize HTTP client with optional API key
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

  extractCursors(transaction: NearTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    // Primary cursor: timestamp (NEAR block timestamps are in nanoseconds)
    if (transaction.timestamp) {
      cursors.push({ type: 'timestamp', value: transaction.timestamp });
    }

    // Alternative cursor: block height if available
    if (transaction.blockHeight !== undefined) {
      cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
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
      case 'getAddressBalances':
        return (await this.getAddressBalances({
          address: operation.address,
        })) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  async *executeStreaming<T extends NormalizedTransactionBase = NormalizedTransactionBase>(
    operation: ProviderOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    if (operation.type !== 'getAddressTransactions') {
      yield err(new Error(`Streaming not yet implemented for operation: ${operation.type}`));
      return;
    }

    if (!isValidNearAccountId(operation.address)) {
      yield err(new Error(`Invalid NEAR account ID: ${operation.address}`));
      return;
    }

    // Route based on transaction type
    const transactionType = operation.transactionType || 'normal';
    switch (transactionType) {
      case 'normal':
        yield* this.streamAddressTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      case 'token':
        yield* this.streamAddressTokenTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      default:
        yield err(new Error(`Unsupported transaction type: ${transactionType}`));
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/v1/stats',
      method: 'GET' as const,
      validate: (response: unknown) => {
        // NearBlocks stats endpoint returns basic chain statistics
        return response !== null && response !== undefined && typeof response === 'object';
      },
    };
  }

  /**
   * Fetch account receipts from NearBlocks API
   * Note: NearBlocks counts 50 records as 2 API credits, so we use 25 to stay at 1 credit per request
   * @param address - NEAR account ID
   * @param page - Page number (default: 1)
   * @param perPage - Items per page (default: 25, max: 25 to use 1 API credit)
   * @returns Array of NearBlocks receipts
   */
  async getAccountReceipts(address: string, page = 1, perPage = 25): Promise<Result<NearBlocksReceipt[], Error>> {
    if (!isValidNearAccountId(address)) {
      return err(new Error(`Invalid NEAR account ID: ${address}`));
    }

    this.logger.debug(`Fetching account receipts - Address: ${maskAddress(address)}, Page: ${page}`);

    const result = await this.httpClient.get(`/v1/account/${address}/receipts?page=${page}&per_page=${perPage}`, {
      schema: NearBlocksReceiptsResponseSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to get account receipts - Address: ${maskAddress(address)}, Page: ${page}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const receiptsData = result.value;

    this.logger.debug(
      `Fetched receipts - Address: ${maskAddress(address)}, Page: ${page}, Count: ${receiptsData.txns.length}`
    );

    return ok(receiptsData.txns);
  }

  /**
   * Fetch account activities from NearBlocks API
   * @param address - NEAR account ID
   * @param cursor - Pagination cursor (omit for first page)
   * @param perPage - Items per page (default: 25, max: 250)
   * @returns Array of NearBlocks activities
   */
  async getAccountActivities(
    address: string,
    cursor?: string,
    perPage = 25
  ): Promise<Result<NearBlocksActivity[], Error>> {
    if (!isValidNearAccountId(address)) {
      return err(new Error(`Invalid NEAR account ID: ${address}`));
    }

    this.logger.debug(`Fetching account activities - Address: ${maskAddress(address)}, Cursor: ${cursor || 'initial'}`);

    const url = cursor
      ? `/v1/account/${address}/activities?cursor=${cursor}&per_page=${perPage}`
      : `/v1/account/${address}/activities?per_page=${perPage}`;

    const result = await this.httpClient.get(url, { schema: NearBlocksActivitiesResponseSchema });

    if (result.isErr()) {
      this.logger.error(
        `Failed to get account activities - Address: ${maskAddress(address)}, Cursor: ${cursor || 'initial'}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const activitiesData = result.value;

    this.logger.debug(
      `Fetched activities - Address: ${maskAddress(address)}, Cursor: ${cursor || 'initial'}, Count: ${activitiesData.activities.length}`
    );

    return ok(activitiesData.activities);
  }

  /**
   * Fetch account FT (fungible token) transactions from NearBlocks API
   * Note: NearBlocks counts 50 records as 2 API credits, so we use 25 to stay at 1 credit per request
   * @param address - NEAR account ID
   * @param page - Page number (default: 1)
   * @param perPage - Items per page (default: 25, max: 25 to use 1 API credit)
   * @returns Array of NearBlocks FT transactions
   */
  async getAccountFtTransactions(
    address: string,
    page = 1,
    perPage = 25
  ): Promise<Result<NearBlocksFtTransaction[], Error>> {
    if (!isValidNearAccountId(address)) {
      return err(new Error(`Invalid NEAR account ID: ${address}`));
    }

    this.logger.debug(`Fetching account FT transactions - Address: ${maskAddress(address)}, Page: ${page}`);

    const result = await this.httpClient.get(`/v1/account/${address}/ft-txns?page=${page}&per_page=${perPage}`, {
      schema: NearBlocksFtTransactionsResponseSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to get account FT transactions - Address: ${maskAddress(address)}, Page: ${page}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const ftTransactionsData = result.value;

    this.logger.debug(
      `Fetched FT transactions - Address: ${maskAddress(address)}, Page: ${page}, Count: ${ftTransactionsData.txns.length}`
    );

    return ok(ftTransactionsData.txns);
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

    // Extract first account from the array
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

  /**
   * Fetch receipts needed for the current transaction batch.
   * NearBlocks paginates receipts independently from transactions, so we may need to
   * walk several pages to cover all receipts emitted by the batch transactions.
   */
  private async fetchReceiptsForBatch(params: {
    address: string;
    perPage: number;
    startPage: number;
    txHashes: Set<string>;
  }): Promise<{ receiptsByTxHash: Map<string, NearBlocksReceipt[]>; truncated: boolean }> {
    const { address, startPage, perPage, txHashes } = params;

    const receiptsByTxHash = new Map<string, NearBlocksReceipt[]>();
    let page = startPage;
    let pagesFetched = 0;
    let truncated = false;

    while (pagesFetched === 0 || pagesFetched <= MAX_ENRICHMENT_EXTRA_PAGES) {
      const receiptsResult = await this.httpClient.get(
        `/v1/account/${address}/receipts?page=${page}&per_page=${perPage}`,
        {
          schema: NearBlocksReceiptsResponseSchema,
        }
      );

      if (receiptsResult.isErr()) {
        this.logger.warn(
          `Failed to fetch receipts page ${page} for enrichment - Address: ${maskAddress(address)}, Error: ${receiptsResult.error.message}`
        );
        truncated = pagesFetched > 0;
        break;
      }

      const receipts = receiptsResult.value.txns;

      for (const receipt of receipts) {
        const txHash = receipt.transaction_hash;
        if (!receiptsByTxHash.has(txHash)) {
          receiptsByTxHash.set(txHash, []);
        }
        receiptsByTxHash.get(txHash)!.push(receipt);
      }

      pagesFetched += 1;

      const coverageComplete = txHashes.size === 0 || Array.from(txHashes).every((hash) => receiptsByTxHash.has(hash));

      // Stop if we reached the end, covered all tx hashes, or hit our safeguard
      if (receipts.length < perPage) {
        truncated = !coverageComplete;
        break;
      }

      if (coverageComplete || pagesFetched > MAX_ENRICHMENT_EXTRA_PAGES) {
        truncated = !coverageComplete && pagesFetched > MAX_ENRICHMENT_EXTRA_PAGES;
        break;
      }

      page += 1;
    }

    return { receiptsByTxHash, truncated };
  }

  /**
   * Fetch activities needed for the current batch of receipts using cursor-based pagination.
   * We walk forward from the shared activities cursor to ensure we don't miss activities that
   * belong to receipts in the current transaction batch.
   */
  private async fetchActivitiesForBatch(params: {
    address: string;
    initialCursor?: string | undefined;
    perPage: number;
    previousBalances: Map<string, bigint>;
    targetReceiptIds: Set<string>;
  }): Promise<{
    activitiesByReceiptId: Map<string, NearBlocksActivity[]>;
    nextCursor?: string | undefined;
    truncated: boolean;
  }> {
    const { address, perPage, initialCursor, targetReceiptIds, previousBalances } = params;

    const activitiesByReceiptId = new Map<string, NearBlocksActivity[]>();
    let cursor = initialCursor;
    let pagesFetched = 0;
    let truncated = false;

    while (pagesFetched === 0 || pagesFetched <= MAX_ENRICHMENT_EXTRA_PAGES) {
      const activitiesUrl = cursor
        ? `/v1/account/${address}/activities?cursor=${cursor}&per_page=${perPage}`
        : `/v1/account/${address}/activities?per_page=${perPage}`;

      const activitiesResult = await this.httpClient.get(activitiesUrl, {
        schema: NearBlocksActivitiesResponseSchema,
      });

      if (activitiesResult.isErr()) {
        this.logger.warn(
          `Failed to fetch activities (cursor=${cursor || 'initial'}) for enrichment - Address: ${maskAddress(address)}, Error: ${activitiesResult.error.message}`
        );
        truncated = pagesFetched > 0;
        break;
      }

      const activitiesData = activitiesResult.value;
      const activities = activitiesData.activities;

      if (activities.length === 0) {
        cursor = activitiesData.cursor || cursor;
        break;
      }

      // Update global cursor to keep advancing across batches (prefer server-provided cursor when present)
      cursor = activitiesData.cursor ?? activities[activities.length - 1]?.receipt_id ?? cursor;

      const sortedActivities = [...activities].sort((a, b) => {
        const timestampA = BigInt(a.block_timestamp);
        const timestampB = BigInt(b.block_timestamp);
        return timestampA < timestampB ? -1 : timestampA > timestampB ? 1 : 0;
      });

      // Use the shared previousBalances map (seeded from cursor metadata on resume)
      for (const activity of sortedActivities) {
        const accountId = activity.affected_account_id;
        const currentBalance = BigInt(activity.absolute_nonstaked_amount);

        const previousBalance = previousBalances.get(accountId);
        if (previousBalance !== undefined && activity.delta_nonstaked_amount === undefined) {
          const delta = currentBalance - previousBalance;
          activity.delta_nonstaked_amount = delta.toString();
        }

        previousBalances.set(accountId, currentBalance);

        const receiptId = activity.receipt_id;
        if (receiptId) {
          if (!activitiesByReceiptId.has(receiptId)) {
            activitiesByReceiptId.set(receiptId, []);
          }
          activitiesByReceiptId.get(receiptId)!.push(activity);
        }
      }

      pagesFetched += 1;

      const coverageComplete =
        targetReceiptIds.size === 0 ||
        Array.from(targetReceiptIds).every((receiptId) => activitiesByReceiptId.has(receiptId));

      if (activities.length < perPage) {
        truncated = !coverageComplete;
        break;
      }

      if (coverageComplete || pagesFetched > MAX_ENRICHMENT_EXTRA_PAGES) {
        truncated = !coverageComplete && pagesFetched > MAX_ENRICHMENT_EXTRA_PAGES;
        break;
      }
    }

    return { activitiesByReceiptId, nextCursor: cursor, truncated };
  }

  /**
   * Stream address transactions with batch-level enrichment
   * Fetches transactions page by page, enriching each batch with activities and receipts
   * Activities use cursor-based pagination to maintain consistency across batches
   */
  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<NearTransaction>, Error>> {
    // Enrichment data maps shared across fetchPage and mapItem via closure
    let receiptsByTxHash = new Map<string, NearBlocksReceipt[]>();
    let activitiesByReceiptId = new Map<string, NearBlocksActivity[]>();
    // Track activities cursor across batches (activities use cursor-based pagination)
    // Restore from previous run to avoid re-fetching activities from page 1
    const customMeta = resumeCursor?.metadata?.custom as Record<string, unknown> | undefined;
    let activitiesCursor: string | undefined = (customMeta?.activitiesCursor as string) || undefined;
    // Track previous balances across batches for delta computation when API doesn't provide deltas
    const previousBalances = new Map<string, bigint>(
      Object.entries((customMeta?.prevBalances as Record<string, string>) || {}).map(([account, balance]) => [
        account,
        BigInt(balance),
      ])
    );

    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<NearBlocksTransaction>, Error>> => {
      // NearBlocks uses 1-based page numbering
      const page = ctx.pageToken ? parseInt(ctx.pageToken, 10) : 1;
      const perPage = 25; // Use 25 records per request to consume 1 API credit

      this.logger.debug(`Fetching transactions page ${page} - Address: ${maskAddress(address)}`);

      const result = await this.httpClient.get(`/v1/account/${address}/txns-only?page=${page}&per_page=${perPage}`, {
        schema: NearBlocksTransactionsResponseSchema,
      });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch transactions for ${maskAddress(address)} page ${page} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const transactionsData = result.value;

      if (!transactionsData.txns || transactionsData.txns.length === 0) {
        return ok({
          items: [],
          nextPageToken: undefined,
          isComplete: true,
        });
      }

      const transactions = transactionsData.txns;

      // Fetch enrichment data for this batch of transactions
      // Reset maps for new batch
      receiptsByTxHash = new Map<string, NearBlocksReceipt[]>();
      activitiesByReceiptId = new Map<string, NearBlocksActivity[]>();

      const txHashes = new Set(transactions.map((tx) => tx.transaction_hash));

      const { receiptsByTxHash: fetchedReceipts, truncated: receiptsTruncated } = await this.fetchReceiptsForBatch({
        address,
        startPage: page,
        perPage,
        txHashes,
      });
      receiptsByTxHash = fetchedReceipts;

      const receiptIds = new Set(
        Array.from(receiptsByTxHash.values()).flatMap((receiptList) => receiptList.map((receipt) => receipt.receipt_id))
      );

      const {
        activitiesByReceiptId: fetchedActivities,
        nextCursor,
        truncated: activitiesTruncated,
      } = await this.fetchActivitiesForBatch({
        address,
        perPage,
        initialCursor: activitiesCursor,
        targetReceiptIds: receiptIds,
        previousBalances,
      });

      activitiesByReceiptId = fetchedActivities;
      activitiesCursor = nextCursor;

      if (receiptsTruncated) {
        this.logger.warn(
          `Receipt enrichment truncated after ${MAX_ENRICHMENT_EXTRA_PAGES + 1} pages - Address: ${maskAddress(address)}, TxPage: ${page}`
        );
      }

      if (activitiesTruncated) {
        this.logger.warn(
          `Activity enrichment truncated after ${MAX_ENRICHMENT_EXTRA_PAGES + 1} pages - Address: ${maskAddress(address)}, TxPage: ${page}`
        );
      }

      const hasMore = transactions.length >= perPage;
      const nextPageToken = hasMore ? String(page + 1) : undefined;

      // Serialize balance state to cursor metadata (keep only recent accounts to avoid bloat)
      const prevBalances: Record<string, string> = {};
      for (const [account, balance] of previousBalances.entries()) {
        prevBalances[account] = balance.toString();
      }

      return ok({
        items: transactions,
        nextPageToken,
        isComplete: !hasMore,
        customMetadata: {
          prevBalances,
          activitiesCursor,
          enrichmentTruncated: receiptsTruncated || activitiesTruncated,
        },
      });
    };

    return createStreamingIterator<NearBlocksTransaction, NearTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        // Map the base transaction
        const mapResult = mapNearBlocksTransaction(raw);

        if (mapResult.isErr()) {
          const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
          this.logger.error(
            `Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`
          );
          return err(new Error(`Provider data validation failed: ${errorMessage}`));
        }

        let normalized = mapResult.value;

        // Enrich with account changes from the batch-level enrichment data
        const txHash = raw.transaction_hash;
        const receipts = receiptsByTxHash.get(txHash) || [];
        const accountChanges: { account: string; postBalance: string; preBalance: string }[] = [];

        for (const receipt of receipts) {
          const activities = activitiesByReceiptId.get(receipt.receipt_id) || [];
          for (const activity of activities) {
            const changeResult = mapNearBlocksActivityToAccountChange(activity, address);
            if (changeResult.isOk()) {
              accountChanges.push(changeResult.value);
            } else {
              const errorMessage =
                changeResult.error.type === 'error' ? changeResult.error.message : changeResult.error.reason;
              this.logger.warn(
                `Failed to map activity to account change - TxHash: ${txHash}, ReceiptId: ${receipt.receipt_id}, Error: ${errorMessage}`
              );
            }
          }
        }

        if (accountChanges.length > 0) {
          normalized = {
            ...normalized,
            accountChanges,
          };
        }

        return ok([
          {
            raw,
            normalized,
          },
        ]);
      },
      extractCursors: (tx) => this.extractCursors(tx),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: 500,
      logger: this.logger,
    });
  }

  /**
   * Stream address token (FT) transactions
   * Returns token transfers as synthetic NearTransaction objects
   */
  private streamAddressTokenTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<NearTransaction>, Error>> {
    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<NearBlocksFtTransaction>, Error>> => {
      // NearBlocks uses 1-based page numbering
      const page = ctx.pageToken ? parseInt(ctx.pageToken, 10) : 1;
      const perPage = 25; // Use 25 records per request to consume 1 API credit

      this.logger.debug(`Fetching FT transactions page ${page} - Address: ${maskAddress(address)}`);

      const result = await this.httpClient.get(`/v1/account/${address}/ft-txns?page=${page}&per_page=${perPage}`, {
        schema: NearBlocksFtTransactionsResponseSchema,
      });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch FT transactions for ${maskAddress(address)} page ${page} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const ftTransactionsData = result.value;

      if (!ftTransactionsData.txns || ftTransactionsData.txns.length === 0) {
        return ok({
          items: [],
          nextPageToken: undefined,
          isComplete: true,
        });
      }

      const ftTransactions = ftTransactionsData.txns;
      const hasMore = ftTransactions.length >= perPage;
      const nextPageToken = hasMore ? String(page + 1) : undefined;

      return ok({
        items: ftTransactions,
        nextPageToken,
        isComplete: !hasMore,
      });
    };

    return createStreamingIterator<NearBlocksFtTransaction, NearTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address, transactionType: 'token' },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const transactionResult = mapNearBlocksFtTransactionToTransaction(raw, address, this.name);

        if (transactionResult.isErr()) {
          const errorMessage =
            transactionResult.error.type === 'error' ? transactionResult.error.message : transactionResult.error.reason;
          this.logger.warn(`Failed to map FT transaction - TxHash: ${raw.transaction_hash}, Error: ${errorMessage}`);
          return err(new Error(`Failed to map FT transaction: ${errorMessage}`));
        }

        return ok([
          {
            raw,
            normalized: transactionResult.value,
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
