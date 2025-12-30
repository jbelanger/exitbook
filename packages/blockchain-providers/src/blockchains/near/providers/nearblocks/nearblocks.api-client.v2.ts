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
import type { NearReceiptEvent } from '../../schemas.v2.js';
import { isValidNearAccountId } from '../../utils.v2.js';

import { mapNearBlocksTransactionToReceiptEvents } from './mapper-utils.v2.js';
import {
  NearBlocksAccountSchema,
  NearBlocksActivitiesResponseSchema,
  NearBlocksFtTransactionsResponseSchema,
  NearBlocksReceiptsV2ResponseSchema,
  NearBlocksTransactionsResponseSchema,
  NearBlocksTransactionV2Schema,
  type NearBlocksActivity,
  type NearBlocksFtTransaction,
  type NearBlocksReceiptV2,
  type NearBlocksTransactionV2,
} from './nearblocks.schemas.js';

// Enrichment pagination limits to avoid unbounded requests while still covering multi-receipt batches
const MAX_ENRICHMENT_EXTRA_PAGES = 5;

/**
 * NearBlocks API Client V2 - Receipt-based event model
 *
 * This V2 client implements the receipt-centric NEAR transaction model:
 * - One receipt = one event (with arrays of balance changes and token transfers)
 * - Uses NEAR-native schemas (signer_id, receiver_id, predecessor_id, etc.)
 * - Proper fee handling (tokens_burnt, payer = predecessor)
 * - Multi-receipt transaction support
 *
 * Key differences from V1:
 * - Returns NearReceiptEvent[] instead of NearTransaction
 * - Uses V2 schemas and mappers
 * - Enrichment happens at fetch time, not streaming time
 */
@RegisterApiClient({
  apiKeyEnvVar: 'NEARBLOCKS_API_KEY',
  baseUrl: 'https://api.nearblocks.io',
  blockchain: 'near',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
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
  description: 'NearBlocks API V2 for NEAR blockchain with receipt-based event model',
  displayName: 'NearBlocks V2',
  name: 'nearblocks-v2',
  requiresApiKey: false,
})
export class NearBlocksApiClientV2 extends BaseApiClient {
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

  extractCursors(event: NearReceiptEvent): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    // Primary cursor: timestamp (NEAR block timestamps converted from nanoseconds to milliseconds as integers)
    if (event.timestamp) {
      cursors.push({ type: 'timestamp', value: event.timestamp });
    }

    // Alternative cursor: block height if available
    if (event.blockHeight !== undefined) {
      cursors.push({ type: 'blockNumber', value: event.blockHeight });
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
    // Route to appropriate streaming implementation
    switch (operation.type) {
      case 'getAddressTransactions':
        if (!isValidNearAccountId(operation.address)) {
          yield err(new Error(`Invalid NEAR account ID: ${operation.address}`));
          return;
        }
        yield* this.streamAddressReceiptEvents(operation.address, resumeCursor) as AsyncIterableIterator<
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
   * Fetch transaction details from NearBlocks API
   * @param accountId - NEAR account ID
   * @param transactionHash - Transaction hash
   * @returns Transaction with embedded receipts
   */
  async fetchTransactionDetails(
    accountId: string,
    transactionHash: string
  ): Promise<Result<NearBlocksTransactionV2, Error>> {
    if (!isValidNearAccountId(accountId)) {
      return err(new Error(`Invalid NEAR account ID: ${accountId}`));
    }

    this.logger.debug(
      `Fetching transaction details - Account: ${maskAddress(accountId)}, TxHash: ${transactionHash.substring(0, 10)}...`
    );

    const result = await this.httpClient.get(`/v1/account/${accountId}/txns/${transactionHash}`, {
      schema: NearBlocksTransactionV2Schema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to get transaction details - Account: ${maskAddress(accountId)}, TxHash: ${transactionHash.substring(0, 10)}..., Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    this.logger.debug(
      `Fetched transaction details - Account: ${maskAddress(accountId)}, TxHash: ${transactionHash.substring(0, 10)}...`
    );

    return ok(result.value);
  }

  /**
   * Fetch account receipts from NearBlocks API (cursor-based pagination)
   * Note: NearBlocks counts 50 records as 2 API credits, so we use 25 to stay at 1 credit per request
   * @param accountId - NEAR account ID
   * @param cursor - Pagination cursor (omit for first page)
   * @param perPage - Items per page (default: 25, max: 25 to use 1 API credit)
   * @returns Receipts and next cursor
   */
  async fetchAccountReceipts(params: {
    accountId: string;
    cursor?: string;
    perPage?: number;
  }): Promise<Result<{ nextCursor?: string; receipts: NearBlocksReceiptV2[] }, Error>> {
    const { accountId, cursor, perPage = 25 } = params;

    if (!isValidNearAccountId(accountId)) {
      return err(new Error(`Invalid NEAR account ID: ${accountId}`));
    }

    this.logger.debug(`Fetching account receipts - Address: ${maskAddress(accountId)}, Cursor: ${cursor || 'initial'}`);

    const url = cursor
      ? `/v1/account/${accountId}/receipts?cursor=${cursor}&per_page=${perPage}&order=asc`
      : `/v1/account/${accountId}/receipts?per_page=${perPage}&order=asc`;

    const result = await this.httpClient.get(url, {
      schema: NearBlocksReceiptsV2ResponseSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to get account receipts - Address: ${maskAddress(accountId)}, Cursor: ${cursor || 'initial'}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const receiptsData = result.value;

    this.logger.debug(
      `Fetched receipts - Address: ${maskAddress(accountId)}, Cursor: ${cursor || 'initial'}, Count: ${receiptsData.txns.length}`
    );

    if (receiptsData.txns.length >= perPage && !receiptsData.cursor) {
      this.logger.error(
        `Missing cursor for receipts page with ${receiptsData.txns.length} items - Address: ${maskAddress(accountId)}`
      );
      return err(
        new Error(
          `NearBlocks receipts response missing cursor with ${receiptsData.txns.length} items. ` +
            `Cannot safely paginate without risking data loss.`
        )
      );
    }

    // Extract next cursor from response (NearBlocks provides a cursor string)
    const nextCursor = receiptsData.cursor ?? undefined;

    return ok({ receipts: receiptsData.txns, ...(nextCursor ? { nextCursor } : {}) });
  }

  /**
   * Fetch account activities (balance changes) from NearBlocks API (cursor-based pagination)
   * @param accountId - NEAR account ID
   * @param cursor - Pagination cursor (omit for first page)
   * @param perPage - Items per page (default: 25, max: 250)
   * @returns Activities and next cursor
   */
  async fetchAccountActivity(params: {
    accountId: string;
    cursor?: string;
    perPage?: number;
  }): Promise<Result<{ activities: NearBlocksActivity[]; nextCursor?: string }, Error>> {
    const { accountId, cursor, perPage = 25 } = params;

    if (!isValidNearAccountId(accountId)) {
      return err(new Error(`Invalid NEAR account ID: ${accountId}`));
    }

    this.logger.debug(
      `Fetching account activities - Address: ${maskAddress(accountId)}, Cursor: ${cursor || 'initial'}`
    );

    const url = cursor
      ? `/v1/account/${accountId}/activities?cursor=${cursor}&per_page=${perPage}&order=asc`
      : `/v1/account/${accountId}/activities?per_page=${perPage}&order=asc`;

    const result = await this.httpClient.get(url, { schema: NearBlocksActivitiesResponseSchema });

    if (result.isErr()) {
      this.logger.error(
        `Failed to get account activities - Address: ${maskAddress(accountId)}, Cursor: ${cursor || 'initial'}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const activitiesData = result.value;

    this.logger.debug(
      `Fetched activities - Address: ${maskAddress(accountId)}, Cursor: ${cursor || 'initial'}, Count: ${activitiesData.activities.length}`
    );

    if (activitiesData.activities.length >= perPage && !activitiesData.cursor) {
      this.logger.error(
        `Missing cursor for activities page with ${activitiesData.activities.length} items - Address: ${maskAddress(accountId)}`
      );
      return err(
        new Error(
          `NearBlocks activities response missing cursor with ${activitiesData.activities.length} items. ` +
            `Cannot safely paginate without risking data loss.`
        )
      );
    }

    // Extract next cursor from response
    const nextCursor = activitiesData.cursor ?? undefined;

    return ok({ activities: activitiesData.activities, ...(nextCursor ? { nextCursor } : {}) });
  }

  /**
   * Fetch account FT (fungible token) transfers from NearBlocks API (cursor-based pagination)
   * Note: NearBlocks counts 50 records as 2 API credits, so we use 25 to stay at 1 credit per request
   * @param accountId - NEAR account ID
   * @param cursor - Pagination cursor (omit for first page)
   * @param perPage - Items per page (default: 25, max: 25 to use 1 API credit)
   * @returns FT transfers and next cursor
   */
  async fetchAccountFtTransfers(params: {
    accountId: string;
    cursor?: string;
    perPage?: number;
  }): Promise<Result<{ nextCursor?: string; transfers: NearBlocksFtTransaction[] }, Error>> {
    const { accountId, cursor, perPage = 25 } = params;

    if (!isValidNearAccountId(accountId)) {
      return err(new Error(`Invalid NEAR account ID: ${accountId}`));
    }

    this.logger.debug(
      `Fetching account FT transfers - Address: ${maskAddress(accountId)}, Cursor: ${cursor || 'initial'}`
    );

    const url = cursor
      ? `/v1/account/${accountId}/ft-txns?cursor=${cursor}&per_page=${perPage}&order=asc`
      : `/v1/account/${accountId}/ft-txns?per_page=${perPage}&order=asc`;

    const result = await this.httpClient.get(url, {
      schema: NearBlocksFtTransactionsResponseSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to get account FT transfers - Address: ${maskAddress(accountId)}, Cursor: ${cursor || 'initial'}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const ftTransfersData = result.value;

    this.logger.debug(
      `Fetched FT transfers - Address: ${maskAddress(accountId)}, Cursor: ${cursor || 'initial'}, Count: ${ftTransfersData.txns.length}`
    );

    if (ftTransfersData.txns.length >= perPage && !ftTransfersData.cursor) {
      this.logger.error(
        `Missing cursor for FT transfers page with ${ftTransfersData.txns.length} items - Address: ${maskAddress(accountId)}`
      );
      return err(
        new Error(
          `NearBlocks FT transfers response missing cursor with ${ftTransfersData.txns.length} items. ` +
            `Cannot safely paginate without risking data loss.`
        )
      );
    }

    // Extract next cursor from response
    const nextCursor = ftTransfersData.cursor ?? undefined;

    return ok({ transfers: ftTransfersData.txns, ...(nextCursor ? { nextCursor } : {}) });
  }

  /**
   * Fetch enriched transaction with all related data (V2 main entry point)
   * This orchestrates multiple API calls to build complete receipt events
   *
   * Process:
   * 1. Fetch base transaction (includes first receipt)
   * 2. Fetch ALL receipts using cursor pagination until all for this tx are found
   * 3. Fetch ALL activities using cursor pagination until all for this tx are found
   * 4. Fetch ALL FT transfers using cursor pagination until all for this tx are found
   * 5. Map and correlate using V2 mapper
   *
   * @param accountId - NEAR account ID
   * @param transactionHash - Transaction hash
   * @returns Array of receipt events (one per receipt)
   */
  async fetchReceiptEventsForTransaction(params: {
    accountId: string;
    transactionHash: string;
  }): Promise<Result<NearReceiptEvent[], Error>> {
    const { accountId, transactionHash } = params;

    this.logger.debug(
      `Fetching receipt events for transaction - Account: ${maskAddress(accountId)}, TxHash: ${transactionHash.substring(0, 10)}...`
    );

    // 1. Fetch base transaction
    const txnResult = await this.fetchTransactionDetails(accountId, transactionHash);
    if (txnResult.isErr()) {
      return err(new Error(`Failed to fetch transaction: ${txnResult.error.message}`));
    }
    const transaction = txnResult.value;

    // 2. Fetch ALL receipts for this transaction using pagination
    const allReceipts: NearBlocksReceiptV2[] = [];
    let receiptsCursor: string | undefined;
    let receiptsPage = 0;
    const MAX_ACCOUNT_SCAN_PAGES = 100; // Safety cap to prevent infinite loops
    let hasMoreReceipts = true;

    while (hasMoreReceipts && receiptsPage < MAX_ACCOUNT_SCAN_PAGES) {
      const receiptsResult = await this.fetchAccountReceipts({
        accountId,
        ...(receiptsCursor ? { cursor: receiptsCursor } : {}),
        perPage: 25,
      });

      if (receiptsResult.isErr()) {
        return err(new Error(`Failed to fetch receipts: ${receiptsResult.error.message}`));
      }

      const { receipts, nextCursor } = receiptsResult.value;

      // Filter and collect receipts for this transaction
      const matchingReceipts = receipts.filter((r) => r.transaction_hash === transactionHash);
      allReceipts.push(...matchingReceipts);

      receiptsCursor = nextCursor;
      receiptsPage++;

      // Continue if there's a cursor and we got results
      hasMoreReceipts = !!(nextCursor && receipts.length > 0);
    }

    // Safety cap check
    if (receiptsPage >= MAX_ACCOUNT_SCAN_PAGES && hasMoreReceipts) {
      return err(
        new Error(
          `Hit safety cap (${MAX_ACCOUNT_SCAN_PAGES} pages) while fetching receipts for transaction ${transactionHash}`
        )
      );
    }

    // 3. Fetch ALL activities for this transaction using pagination
    const allActivities: NearBlocksActivity[] = [];
    let activitiesCursor: string | undefined;
    let activitiesPage = 0;
    let hasMoreActivities = true;

    while (hasMoreActivities && activitiesPage < MAX_ACCOUNT_SCAN_PAGES) {
      const activityResult = await this.fetchAccountActivity({
        accountId,
        ...(activitiesCursor ? { cursor: activitiesCursor } : {}),
        perPage: 25,
      });

      if (activityResult.isErr()) {
        return err(new Error(`Failed to fetch activities: ${activityResult.error.message}`));
      }

      const { activities, nextCursor } = activityResult.value;

      // Filter and collect activities for this transaction
      const matchingActivities = activities.filter((a) => a.transaction_hash === transactionHash);
      allActivities.push(...matchingActivities);

      activitiesCursor = nextCursor;
      activitiesPage++;

      hasMoreActivities = !!(nextCursor && activities.length > 0);
    }

    if (activitiesPage >= MAX_ACCOUNT_SCAN_PAGES && hasMoreActivities) {
      return err(
        new Error(
          `Hit safety cap (${MAX_ACCOUNT_SCAN_PAGES} pages) while fetching activities for transaction ${transactionHash}`
        )
      );
    }

    // 4. Fetch ALL FT transfers for this transaction using pagination
    const allFtTransfers: NearBlocksFtTransaction[] = [];
    let ftCursor: string | undefined;
    let ftPage = 0;
    let hasMoreFtTransfers = true;

    while (hasMoreFtTransfers && ftPage < MAX_ACCOUNT_SCAN_PAGES) {
      const ftResult = await this.fetchAccountFtTransfers({
        accountId,
        ...(ftCursor ? { cursor: ftCursor } : {}),
        perPage: 25,
      });

      if (ftResult.isErr()) {
        return err(new Error(`Failed to fetch FT transfers: ${ftResult.error.message}`));
      }

      const { transfers, nextCursor } = ftResult.value;

      // Filter and collect FT transfers for this transaction
      const matchingTransfers = transfers.filter((t) => t.transaction_hash === transactionHash);
      allFtTransfers.push(...matchingTransfers);

      ftCursor = nextCursor;
      ftPage++;

      hasMoreFtTransfers = !!(nextCursor && transfers.length > 0);
    }

    if (ftPage >= MAX_ACCOUNT_SCAN_PAGES && hasMoreFtTransfers) {
      return err(
        new Error(
          `Hit safety cap (${MAX_ACCOUNT_SCAN_PAGES} pages) while fetching FT transfers for transaction ${transactionHash}`
        )
      );
    }

    // 5. Map and correlate using V2 mapper
    const eventsResult = mapNearBlocksTransactionToReceiptEvents({
      transaction,
      ...(allReceipts.length > 0 ? { receipts: allReceipts } : {}),
      ...(allActivities.length > 0 ? { activities: allActivities } : {}),
      ...(allFtTransfers.length > 0 ? { ftTransfers: allFtTransfers } : {}),
      providerName: this.name,
    });

    if (eventsResult.isErr()) {
      return err(new Error(`Failed to map transaction to receipt events: ${eventsResult.error.message}`));
    }

    const events = eventsResult.value;

    this.logger.debug(
      `Successfully fetched receipt events - Account: ${maskAddress(accountId)}, TxHash: ${transactionHash.substring(0, 10)}..., Events: ${events.length}`
    );

    return ok(events);
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
   * Stream address receipt events with batch-level enrichment
   * Fetches transactions page by page, enriching each batch with activities and receipts
   * Uses cursor-based pagination for consistency and resume capability
   *
   * V2 difference: Returns NearReceiptEvent[] instead of NearTransaction
   */
  private streamAddressReceiptEvents(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<NearReceiptEvent>, Error>> {
    // Track enrichment cursors across batches
    let receiptsCursor: string | undefined;
    let activitiesCursor: string | undefined;
    let ftTransfersCursor: string | undefined;
    let txnsCursor: string | undefined;

    // Extract cursors from resume state if available
    const resumeMetadata = resumeCursor?.metadata?.custom as
      | {
          activitiesCursor?: string;
          ftTransfersCursor?: string;
          prevBalances?: Record<string, string>;
          receiptsCursor?: string;
          txnsCursor?: string;
        }
      | undefined;
    if (resumeMetadata) {
      receiptsCursor = resumeMetadata.receiptsCursor;
      activitiesCursor = resumeMetadata.activitiesCursor;
      ftTransfersCursor = resumeMetadata.ftTransfersCursor;
      txnsCursor = resumeMetadata.txnsCursor;
    }

    // Maps to store batch-level enrichment data
    let receiptsByTxHash = new Map<string, NearBlocksReceiptV2[]>();
    let activitiesByReceiptId = new Map<string, NearBlocksActivity[]>();
    let ftTransfersByReceiptId = new Map<string, NearBlocksFtTransaction[]>();
    // Track last known balances to derive deltas when NearBlocks omits delta_nonstaked_amount
    const previousBalances = new Map<string, bigint>(
      Object.entries(resumeMetadata?.prevBalances ?? {}).map(([account, balance]) => [account, BigInt(balance)])
    );

    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<NearBlocksTransactionV2>, Error>> => {
      const perPage = 25; // Use 25 records per request to consume 1 API credit

      // Use cursor from context (for resume) or tracked cursor
      const cursor = ctx.pageToken || txnsCursor;
      const url = cursor
        ? `/v1/account/${address}/txns-only?cursor=${cursor}&per_page=${perPage}&order=asc`
        : `/v1/account/${address}/txns-only?per_page=${perPage}&order=asc`;

      this.logger.debug(`Fetching transactions - Address: ${maskAddress(address)}, Cursor: ${cursor || 'initial'}`);

      const result = await this.httpClient.get(url, {
        schema: NearBlocksTransactionsResponseSchema,
      });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch transactions for ${maskAddress(address)} cursor ${cursor || 'initial'} - Error: ${getErrorMessage(result.error)}`
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

      if (transactions.length >= perPage && !transactionsData.cursor) {
        this.logger.error(
          `Missing cursor for transactions page with ${transactions.length} items - Address: ${maskAddress(address)}`
        );
        return err(
          new Error(
            `NearBlocks transactions response missing cursor with ${transactions.length} items. ` +
              `Cannot safely paginate without risking data loss.`
          )
        );
      }

      // Reset maps for new batch
      receiptsByTxHash = new Map<string, NearBlocksReceiptV2[]>();
      activitiesByReceiptId = new Map<string, NearBlocksActivity[]>();
      ftTransfersByReceiptId = new Map<string, NearBlocksFtTransaction[]>();

      const txHashes = new Set(transactions.map((tx) => tx.transaction_hash));

      // Fetch receipts for this batch (with safety cap)
      let receiptsPage = 0;
      while (receiptsPage < MAX_ENRICHMENT_EXTRA_PAGES) {
        const receiptsResult = await this.fetchAccountReceipts({
          accountId: address,
          ...(receiptsCursor ? { cursor: receiptsCursor } : {}),
          perPage,
        });

        if (receiptsResult.isErr()) {
          this.logger.error(
            `Failed to fetch receipts for batch - Address: ${maskAddress(address)}, Error: ${receiptsResult.error.message}`
          );
          return err(new Error(`Receipt enrichment failed for batch: ${receiptsResult.error.message}`));
        }

        const { receipts, nextCursor } = receiptsResult.value;
        receiptsCursor = nextCursor;

        for (const receipt of receipts) {
          if (txHashes.has(receipt.transaction_hash)) {
            const existing = receiptsByTxHash.get(receipt.transaction_hash) || [];
            existing.push(receipt);
            receiptsByTxHash.set(receipt.transaction_hash, existing);
          }
        }

        receiptsPage += 1;
        if (!nextCursor || receipts.length === 0) break;
      }

      // Error if we hit the safety cap - indicates incomplete data
      if (receiptsPage >= MAX_ENRICHMENT_EXTRA_PAGES && receiptsCursor) {
        this.logger.error(
          `Hit safety cap (${MAX_ENRICHMENT_EXTRA_PAGES} pages) fetching receipts for batch - Address: ${maskAddress(address)}`
        );
        return err(
          new Error(
            `Receipt enrichment incomplete: hit ${MAX_ENRICHMENT_EXTRA_PAGES} page limit. Batch may have incomplete receipts.`
          )
        );
      }

      // Fetch activities for this batch
      const receiptIds = new Set(
        Array.from(receiptsByTxHash.values()).flatMap((receiptList) => receiptList.map((receipt) => receipt.receipt_id))
      );

      let activitiesPage = 0;
      if (receiptIds.size > 0) {
        while (activitiesPage < MAX_ENRICHMENT_EXTRA_PAGES) {
          const activitiesResult = await this.fetchAccountActivity({
            accountId: address,
            ...(activitiesCursor ? { cursor: activitiesCursor } : {}),
            perPage,
          });

          if (activitiesResult.isErr()) {
            this.logger.error(
              `Failed to fetch activities for batch - Address: ${maskAddress(address)}, Error: ${activitiesResult.error.message}`
            );
            return err(new Error(`Activity enrichment failed for batch: ${activitiesResult.error.message}`));
          }

          const { activities, nextCursor } = activitiesResult.value;
          activitiesCursor = nextCursor;

          const sortedActivities = [...activities].sort((a, b) => {
            const timestampA = BigInt(a.block_timestamp);
            const timestampB = BigInt(b.block_timestamp);
            return timestampA < timestampB ? -1 : timestampA > timestampB ? 1 : 0;
          });

          for (const activity of sortedActivities) {
            const accountId = activity.affected_account_id;
            const currentBalance = BigInt(activity.absolute_nonstaked_amount);
            const previousBalance = previousBalances.get(accountId);

            if (
              (activity.delta_nonstaked_amount === undefined || activity.delta_nonstaked_amount === null) &&
              previousBalance !== undefined
            ) {
              const delta = currentBalance - previousBalance;
              activity.delta_nonstaked_amount = delta.toString();
            }

            previousBalances.set(accountId, currentBalance);

            if (activity.receipt_id && receiptIds.has(activity.receipt_id)) {
              const existing = activitiesByReceiptId.get(activity.receipt_id) || [];
              existing.push(activity);
              activitiesByReceiptId.set(activity.receipt_id, existing);
            }
          }

          activitiesPage += 1;
          if (!nextCursor || activities.length === 0) break;
        }
      }

      // Error if we hit the safety cap
      if (activitiesPage >= MAX_ENRICHMENT_EXTRA_PAGES && activitiesCursor) {
        this.logger.error(
          `Hit safety cap (${MAX_ENRICHMENT_EXTRA_PAGES} pages) fetching activities for batch - Address: ${maskAddress(address)}`
        );
        return err(
          new Error(
            `Activity enrichment incomplete: hit ${MAX_ENRICHMENT_EXTRA_PAGES} page limit. Batch may have incomplete activities.`
          )
        );
      }

      // Fetch FT transfers for this batch
      let ftTransfersPage = 0;
      if (receiptIds.size > 0) {
        while (ftTransfersPage < MAX_ENRICHMENT_EXTRA_PAGES) {
          const ftResult = await this.fetchAccountFtTransfers({
            accountId: address,
            ...(ftTransfersCursor ? { cursor: ftTransfersCursor } : {}),
            perPage,
          });

          if (ftResult.isErr()) {
            this.logger.error(
              `Failed to fetch FT transfers for batch - Address: ${maskAddress(address)}, Error: ${ftResult.error.message}`
            );
            return err(new Error(`FT transfer enrichment failed for batch: ${ftResult.error.message}`));
          }

          const { transfers, nextCursor } = ftResult.value;
          ftTransfersCursor = nextCursor;

          for (const transfer of transfers) {
            if (transfer.receipt_id && receiptIds.has(transfer.receipt_id)) {
              const existing = ftTransfersByReceiptId.get(transfer.receipt_id) || [];
              existing.push(transfer);
              ftTransfersByReceiptId.set(transfer.receipt_id, existing);
            }
          }

          ftTransfersPage += 1;
          if (!nextCursor || transfers.length === 0) break;
        }
      }

      // Error if we hit the safety cap
      if (ftTransfersPage >= MAX_ENRICHMENT_EXTRA_PAGES && ftTransfersCursor) {
        this.logger.error(
          `Hit safety cap (${MAX_ENRICHMENT_EXTRA_PAGES} pages) fetching FT transfers for batch - Address: ${maskAddress(address)}`
        );
        return err(
          new Error(
            `FT transfer enrichment incomplete: hit ${MAX_ENRICHMENT_EXTRA_PAGES} page limit. Batch may have incomplete FT transfers.`
          )
        );
      }

      // Extract next cursor from response for transactions
      // NearBlocks returns cursor as string | null | undefined, normalize to string | undefined
      const nextCursor = transactionsData.cursor ?? undefined;
      txnsCursor = nextCursor;

      const hasMore = transactions.length >= perPage && nextCursor;
      const nextPageToken = hasMore ? nextCursor : undefined;

      return ok({
        items: transactions,
        nextPageToken,
        isComplete: !hasMore,
        customMetadata: {
          receiptsCursor,
          activitiesCursor,
          ftTransfersCursor,
          txnsCursor,
          prevBalances: Object.fromEntries(
            Array.from(previousBalances.entries()).map(([account, balance]) => [account, balance.toString()])
          ),
        },
      });
    };

    return createStreamingIterator<NearBlocksTransactionV2, NearReceiptEvent>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        // Get enrichment data for this transaction
        const txHash = raw.transaction_hash;
        const receipts = receiptsByTxHash.get(txHash) || [];
        const allActivities: NearBlocksActivity[] = [];
        const allFtTransfers: NearBlocksFtTransaction[] = [];

        // Collect activities and FT transfers for all receipts in this transaction
        for (const receipt of receipts) {
          const activities = activitiesByReceiptId.get(receipt.receipt_id) || [];
          const ftTransfers = ftTransfersByReceiptId.get(receipt.receipt_id) || [];
          allActivities.push(...activities);
          allFtTransfers.push(...ftTransfers);
        }

        // Map transaction to receipt events using V2 mapper
        const eventsResult = mapNearBlocksTransactionToReceiptEvents({
          transaction: raw,
          ...(receipts.length > 0 ? { receipts } : {}),
          ...(allActivities.length > 0 ? { activities: allActivities } : {}),
          ...(allFtTransfers.length > 0 ? { ftTransfers: allFtTransfers } : {}),
          providerName: this.name,
        });

        if (eventsResult.isErr()) {
          this.logger.error(
            `Failed to map transaction to receipt events - Address: ${maskAddress(address)}, TxHash: ${txHash.substring(0, 10)}..., Error: ${eventsResult.error.message}`
          );
          return err(new Error(`Failed to map transaction: ${eventsResult.error.message}`));
        }

        const events = eventsResult.value;

        // Return as TransactionWithRawData array
        return ok(
          events.map((event) => ({
            raw: raw,
            normalized: event,
          }))
        );
      },
      extractCursors: (tx) => this.extractCursors(tx),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: 500,
      logger: this.logger,
    });
  }
}
