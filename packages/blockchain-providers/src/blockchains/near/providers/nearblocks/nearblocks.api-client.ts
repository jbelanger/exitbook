import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type {
  ProviderConfig,
  ProviderOperation,
  RawBalanceData,
  StreamingBatchResult,
  TransactionWithRawData,
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
  mapNearBlocksFtTransactionToTokenTransfer,
  mapNearBlocksTransaction,
  parseNearBlocksTimestamp,
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

@RegisterApiClient({
  apiKeyEnvVar: 'NEARBLOCKS_API_KEY',
  baseUrl: 'https://api.nearblocks.io',
  blockchain: 'near',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressTokenTransactions', 'getAddressBalances'],
    supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 20 },
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

  /**
   * @deprecated Use executeStreaming instead
   */
  async execute<T>(operation: ProviderOperation): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getAddressTransactions':
        return (await this.getAddressTransactions({
          address: operation.address,
        })) as Result<T, Error>;
      case 'getAddressTokenTransactions':
        return (await this.getAddressTokenTransactions({
          address: operation.address,
        })) as Result<T, Error>;
      case 'getAddressBalances':
        return (await this.getAddressBalances({
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
      case 'getAddressTokenTransactions':
        yield* this.streamAddressTokenTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      default:
        yield err(new Error(`Streaming not yet implemented for operation: ${operation.type}`));
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
    const balanceData = transformNearBalance(accountData.amount);

    this.logger.debug(
      `Successfully retrieved raw address balance - Address: ${maskAddress(address)}, NEAR: ${balanceData.decimalAmount}`
    );

    return ok(balanceData);
  }

  private async getAddressTransactions(params: {
    address: string;
  }): Promise<Result<TransactionWithRawData<NearTransaction>[], Error>> {
    const { address } = params;

    if (!isValidNearAccountId(address)) {
      return err(new Error(`Invalid NEAR account ID: ${address}`));
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    // Fetch transactions with pagination
    // Note: NearBlocks counts 50 records as 2 API credits, so we use 25 to stay at 1 credit per request
    const allTransactions: NearBlocksTransaction[] = [];
    let page = 1;
    const perPage = 25; // Use 25 records per request to consume 1 API credit (50 would consume 2 credits)
    const maxPages = 40; // Limit to 1000 transactions (40 * 25)

    while (page <= maxPages) {
      const result = await this.httpClient.get(`/v1/account/${address}/txns-only?page=${page}&per_page=${perPage}`, {
        schema: NearBlocksTransactionsResponseSchema,
      });

      if (result.isErr()) {
        // If first page fails, return error
        if (page === 1) {
          this.logger.error(
            `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
          );
          return err(result.error);
        }
        // If subsequent pages fail, break and return what we have
        this.logger.warn(
          `Failed to fetch page ${page} - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
        );
        break;
      }

      const transactionsData = result.value;

      if (!transactionsData.txns || transactionsData.txns.length === 0) {
        // No more transactions
        break;
      }

      allTransactions.push(...transactionsData.txns);

      this.logger.debug(
        `Fetched page ${page} - Address: ${maskAddress(address)}, Transactions: ${transactionsData.txns.length}`
      );

      // If we got fewer transactions than requested, we've reached the end
      if (transactionsData.txns.length < perPage) {
        break;
      }

      page++;
    }

    this.logger.debug(
      `Total raw transactions fetched - Address: ${maskAddress(address)}, Count: ${allTransactions.length}`
    );

    // Fetch enrichment data (activities and receipts) in parallel
    const [activitiesResult, receiptsResult] = await Promise.all([
      this.fetchAllActivities(address),
      this.fetchAllReceipts(address),
    ]);

    // Build correlation maps for enrichment
    const receiptsByTxHash = new Map<string, NearBlocksReceipt[]>();
    const activitiesByReceiptId = new Map<string, NearBlocksActivity[]>();

    if (receiptsResult.isOk()) {
      for (const receipt of receiptsResult.value) {
        const txHash = receipt.transaction_hash;
        if (!receiptsByTxHash.has(txHash)) {
          receiptsByTxHash.set(txHash, []);
        }
        receiptsByTxHash.get(txHash)!.push(receipt);
      }
    } else {
      this.logger.warn(
        `Failed to fetch receipts for enrichment - Address: ${maskAddress(address)}, Error: ${receiptsResult.error.message}`
      );
    }

    if (activitiesResult.isOk()) {
      // Enrich activities with delta_nonstaked_amount before indexing
      // Sort activities chronologically (oldest first) by block_timestamp
      const sortedActivities = [...activitiesResult.value].sort((a, b) => {
        const timestampA = BigInt(a.block_timestamp);
        const timestampB = BigInt(b.block_timestamp);
        return timestampA < timestampB ? -1 : timestampA > timestampB ? 1 : 0;
      });

      // Track previous absolute_nonstaked_amount per affected_account_id
      const previousBalances = new Map<string, bigint>();

      for (const activity of sortedActivities) {
        const accountId = activity.affected_account_id;
        const currentBalance = BigInt(activity.absolute_nonstaked_amount);

        // Compute delta if we have a previous balance for this account
        const previousBalance = previousBalances.get(accountId);
        if (previousBalance !== undefined) {
          const delta = currentBalance - previousBalance;
          // Only set delta_nonstaked_amount if the API didn't already provide it
          if (activity.delta_nonstaked_amount === undefined) {
            activity.delta_nonstaked_amount = delta.toString();
          }
        }

        // Update previous balance for this account
        previousBalances.set(accountId, currentBalance);

        // Index by receipt_id for enrichment
        const receiptId = activity.receipt_id;
        if (receiptId) {
          if (!activitiesByReceiptId.has(receiptId)) {
            activitiesByReceiptId.set(receiptId, []);
          }
          activitiesByReceiptId.get(receiptId)!.push(activity);
        }
      }
    } else {
      this.logger.warn(
        `Failed to fetch activities for enrichment - Address: ${maskAddress(address)}, Error: ${activitiesResult.error.message}`
      );
    }

    this.logger.debug(
      `Built enrichment indexes - Address: ${maskAddress(address)}, Receipts: ${receiptsByTxHash.size}, Activities: ${activitiesByReceiptId.size}`
    );

    // Map and normalize transactions with enrichment
    const transactions: TransactionWithRawData<NearTransaction>[] = [];
    for (const rawTx of allTransactions) {
      const mapResult = mapNearBlocksTransaction(rawTx, { providerName: this.name });

      if (mapResult.isErr()) {
        const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
        this.logger.error(`Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`);
        return err(new Error(`Provider data validation failed: ${errorMessage}`));
      }

      let normalized = mapResult.value;

      // Enrich with account changes from activities
      const txHash = rawTx.transaction_hash;
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

      transactions.push({
        normalized,
        raw: rawTx,
      });
    }

    this.logger.debug(
      `Successfully retrieved and normalized transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}`
    );

    return ok(transactions);
  }

  private async getAddressTokenTransactions(params: {
    address: string;
  }): Promise<Result<TransactionWithRawData<NearTransaction>[], Error>> {
    const { address } = params;

    if (!isValidNearAccountId(address)) {
      return err(new Error(`Invalid NEAR account ID: ${address}`));
    }

    this.logger.debug(`Fetching token transactions - Address: ${maskAddress(address)}`);

    // Fetch all FT transactions with pagination
    const ftTxsResult = await this.fetchAllFtTransactions(address);

    if (ftTxsResult.isErr()) {
      return err(ftTxsResult.error);
    }

    const ftTxs = ftTxsResult.value;

    // Convert each FT transaction to a NearTransaction with tokenTransfers populated
    const transactions: TransactionWithRawData<NearTransaction>[] = [];

    for (const ftTx of ftTxs) {
      const tokenTransferResult = mapNearBlocksFtTransactionToTokenTransfer(ftTx, address);

      if (tokenTransferResult.isErr()) {
        const errorMessage =
          tokenTransferResult.error.type === 'error'
            ? tokenTransferResult.error.message
            : tokenTransferResult.error.reason;
        this.logger.warn(
          `Failed to map FT transaction to token transfer - TxHash: ${ftTx.transaction_hash}, Error: ${errorMessage}`
        );
        continue;
      }

      const tokenTransfer = tokenTransferResult.value;

      // Create a synthetic NearTransaction for this token transfer
      const transaction: NearTransaction = {
        amount: tokenTransfer.amount,
        currency: tokenTransfer.symbol || tokenTransfer.contractAddress,
        from: tokenTransfer.from,
        id: ftTx.transaction_hash || `ft-${ftTx.block_timestamp}`,
        providerName: this.name,
        status: 'success',
        timestamp: parseNearBlocksTimestamp(ftTx.block_timestamp),
        to: tokenTransfer.to,
        tokenTransfers: [tokenTransfer],
        type: 'token_transfer',
      };

      transactions.push({
        normalized: transaction,
        raw: ftTx,
      });
    }

    this.logger.debug(
      `Successfully retrieved token transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}`
    );

    return ok(transactions);
  }

  /**
   * Fetch all activities for an address with cursor-based pagination
   */
  private async fetchAllActivities(address: string): Promise<Result<NearBlocksActivity[], Error>> {
    const allActivities: NearBlocksActivity[] = [];
    let cursor: string | undefined = undefined;
    const perPage = 25;
    const maxPages = 40; // Limit to 1000 activities
    let page = 0;

    while (page < maxPages) {
      const result = await this.getAccountActivities(address, cursor, perPage);

      if (result.isErr()) {
        if (page === 0) {
          return err(result.error);
        }
        this.logger.warn(
          `Failed to fetch activities page ${page + 1} - Address: ${maskAddress(address)}, Error: ${result.error.message}`
        );
        break;
      }

      const activities = result.value;

      if (activities.length === 0) {
        break;
      }

      allActivities.push(...activities);

      // Get cursor from last activity for next page
      const lastActivity = activities[activities.length - 1];
      if (!lastActivity || activities.length < perPage) {
        break;
      }

      cursor = lastActivity.receipt_id ?? undefined;
      page++;
    }

    this.logger.debug(`Total activities fetched - Address: ${maskAddress(address)}, Count: ${allActivities.length}`);

    return ok(allActivities);
  }

  /**
   * Fetch all receipts for an address with page-based pagination
   */
  private async fetchAllReceipts(address: string): Promise<Result<NearBlocksReceipt[], Error>> {
    const allReceipts: NearBlocksReceipt[] = [];
    let page = 1;
    const perPage = 25;
    const maxPages = 40; // Limit to 1000 receipts

    while (page <= maxPages) {
      const result = await this.getAccountReceipts(address, page, perPage);

      if (result.isErr()) {
        if (page === 1) {
          return err(result.error);
        }
        this.logger.warn(
          `Failed to fetch receipts page ${page} - Address: ${maskAddress(address)}, Error: ${result.error.message}`
        );
        break;
      }

      const receipts = result.value;

      if (receipts.length === 0) {
        break;
      }

      allReceipts.push(...receipts);

      if (receipts.length < perPage) {
        break;
      }

      page++;
    }

    this.logger.debug(`Total receipts fetched - Address: ${maskAddress(address)}, Count: ${allReceipts.length}`);

    return ok(allReceipts);
  }

  /**
   * Fetch all FT transactions for an address with page-based pagination
   */
  private async fetchAllFtTransactions(address: string): Promise<Result<NearBlocksFtTransaction[], Error>> {
    const allFtTxs: NearBlocksFtTransaction[] = [];
    let page = 1;
    const perPage = 25;
    const maxPages = 40; // Limit to 1000 FT transactions

    while (page <= maxPages) {
      const result = await this.getAccountFtTransactions(address, page, perPage);

      if (result.isErr()) {
        if (page === 1) {
          return err(result.error);
        }
        this.logger.warn(
          `Failed to fetch FT transactions page ${page} - Address: ${maskAddress(address)}, Error: ${result.error.message}`
        );
        break;
      }

      const ftTxs = result.value;

      if (ftTxs.length === 0) {
        break;
      }

      allFtTxs.push(...ftTxs);

      if (ftTxs.length < perPage) {
        break;
      }

      page++;
    }

    this.logger.debug(`Total FT transactions fetched - Address: ${maskAddress(address)}, Count: ${allFtTxs.length}`);

    return ok(allFtTxs);
  }

  /**
   * Stream address transactions with batch-level enrichment
   * Fetches transactions page by page, enriching each batch with activities and receipts
   */
  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<NearTransaction>, Error>> {
    // Enrichment data maps shared across fetchPage and mapItem via closure
    let receiptsByTxHash = new Map<string, NearBlocksReceipt[]>();
    let activitiesByReceiptId = new Map<string, NearBlocksActivity[]>();

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

      // Fetch receipts for this page
      const receiptsResult = await this.httpClient.get(
        `/v1/account/${address}/receipts?page=${page}&per_page=${perPage}`,
        {
          schema: NearBlocksReceiptsResponseSchema,
        }
      );

      if (receiptsResult.isOk()) {
        for (const receipt of receiptsResult.value.txns) {
          const txHash = receipt.transaction_hash;
          if (!receiptsByTxHash.has(txHash)) {
            receiptsByTxHash.set(txHash, []);
          }
          receiptsByTxHash.get(txHash)!.push(receipt);
        }
      } else {
        this.logger.warn(
          `Failed to fetch receipts for page ${page} enrichment - Address: ${maskAddress(address)}, Error: ${receiptsResult.error.message}`
        );
      }

      // Fetch activities for this page
      const activitiesResult = await this.httpClient.get(`/v1/account/${address}/activities?per_page=${perPage}`, {
        schema: NearBlocksActivitiesResponseSchema,
      });

      if (activitiesResult.isOk()) {
        const sortedActivities = [...activitiesResult.value.activities].sort((a, b) => {
          const timestampA = BigInt(a.block_timestamp);
          const timestampB = BigInt(b.block_timestamp);
          return timestampA < timestampB ? -1 : timestampA > timestampB ? 1 : 0;
        });

        const previousBalances = new Map<string, bigint>();

        for (const activity of sortedActivities) {
          const accountId = activity.affected_account_id;
          const currentBalance = BigInt(activity.absolute_nonstaked_amount);

          const previousBalance = previousBalances.get(accountId);
          if (previousBalance !== undefined) {
            const delta = currentBalance - previousBalance;
            if (activity.delta_nonstaked_amount === undefined) {
              activity.delta_nonstaked_amount = delta.toString();
            }
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
      } else {
        this.logger.warn(
          `Failed to fetch activities for page ${page} enrichment - Address: ${maskAddress(address)}, Error: ${activitiesResult.error.message}`
        );
      }

      const hasMore = transactions.length >= perPage;
      const nextPageToken = hasMore ? String(page + 1) : undefined;

      return ok({
        items: transactions,
        nextPageToken,
        isComplete: !hasMore,
      });
    };

    return createStreamingIterator<NearBlocksTransaction, NearTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        // Map the base transaction
        const mapResult = mapNearBlocksTransaction(raw, { providerName: this.name });

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

        return ok({
          raw,
          normalized,
        });
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
      operation: { type: 'getAddressTokenTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const tokenTransferResult = mapNearBlocksFtTransactionToTokenTransfer(raw, address);

        if (tokenTransferResult.isErr()) {
          const errorMessage =
            tokenTransferResult.error.type === 'error'
              ? tokenTransferResult.error.message
              : tokenTransferResult.error.reason;
          this.logger.warn(
            `Failed to map FT transaction to token transfer - TxHash: ${raw.transaction_hash}, Error: ${errorMessage}`
          );
          return err(new Error(`Failed to map FT transaction: ${errorMessage}`));
        }

        const tokenTransfer = tokenTransferResult.value;

        // Create a synthetic NearTransaction for this token transfer
        const transaction: NearTransaction = {
          amount: tokenTransfer.amount,
          currency: tokenTransfer.symbol || tokenTransfer.contractAddress,
          from: tokenTransfer.from,
          id: raw.transaction_hash || `ft-${raw.block_timestamp}`,
          providerName: this.name,
          status: 'success',
          timestamp: parseNearBlocksTimestamp(raw.block_timestamp),
          to: tokenTransfer.to,
          tokenTransfers: [tokenTransfer],
          type: 'token_transfer',
        };

        return ok({
          raw,
          normalized: transaction,
        });
      },
      extractCursors: (tx) => this.extractCursors(tx),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: 500,
      logger: this.logger,
    });
  }
}
