import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type {
  ProviderConfig,
  ProviderOperation,
  RawBalanceData,
  TransactionWithRawData,
} from '../../../../core/index.ts';
import { RegisterApiClient, BaseApiClient, maskAddress } from '../../../../core/index.ts';
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
  type NearBlocksAccount,
  type NearBlocksActivitiesResponse,
  type NearBlocksActivity,
  type NearBlocksFtTransaction,
  type NearBlocksFtTransactionsResponse,
  type NearBlocksReceipt,
  type NearBlocksReceiptsResponse,
  type NearBlocksTransaction,
  type NearBlocksTransactionsResponse,
} from './nearblocks.schemas.js';

@RegisterApiClient({
  apiKeyEnvVar: 'NEARBLOCKS_API_KEY',
  baseUrl: 'https://api.nearblocks.io',
  blockchain: 'near',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressTokenTransactions', 'getAddressBalances'],
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

    const result = await this.httpClient.get<NearBlocksReceiptsResponse>(
      `/v1/account/${address}/receipts?page=${page}&per_page=${perPage}`
    );

    if (result.isErr()) {
      this.logger.error(
        `Failed to get account receipts - Address: ${maskAddress(address)}, Page: ${page}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    // Validate response with schema
    const parseResult = NearBlocksReceiptsResponseSchema.safeParse(response);
    if (!parseResult.success) {
      const validationErrors = parseResult.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      const errorCount = parseResult.error.issues.length;
      this.logger.error(
        `Provider data validation failed - Address: ${maskAddress(address)}, Page: ${page}, Errors (showing first 5 of ${errorCount}): ${validationErrors}`
      );
      return err(new Error(`Provider data validation failed: ${validationErrors}`));
    }

    const receiptsData = parseResult.data;

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

    const result = await this.httpClient.get<NearBlocksActivitiesResponse>(url);

    if (result.isErr()) {
      this.logger.error(
        `Failed to get account activities - Address: ${maskAddress(address)}, Cursor: ${cursor || 'initial'}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    // Debug: Log raw response structure
    this.logger.debug(
      `Raw activities response - Address: ${maskAddress(address)}, ResponseKeys: ${JSON.stringify(Object.keys(response || {}))}, ResponseType: ${typeof response}, IsArray: ${Array.isArray(response)}`
    );
    if (response && typeof response === 'object') {
      this.logger.debug(
        `Raw activities response sample - Address: ${maskAddress(address)}, Response: ${JSON.stringify(response).slice(0, 500)}`
      );
    }

    // Validate response with schema
    const parseResult = NearBlocksActivitiesResponseSchema.safeParse(response);
    if (!parseResult.success) {
      const validationErrors = parseResult.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      const errorCount = parseResult.error.issues.length;
      this.logger.error(
        `Provider data validation failed - Address: ${maskAddress(address)}, Cursor: ${cursor || 'initial'}, Errors (showing first 5 of ${errorCount}): ${validationErrors}, RawResponse: ${JSON.stringify(response)}`
      );
      return err(new Error(`Provider data validation failed: ${validationErrors}`));
    }

    const activitiesData = parseResult.data;

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

    const result = await this.httpClient.get<NearBlocksFtTransactionsResponse>(
      `/v1/account/${address}/ft-txns?page=${page}&per_page=${perPage}`
    );

    if (result.isErr()) {
      this.logger.error(
        `Failed to get account FT transactions - Address: ${maskAddress(address)}, Page: ${page}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    // Validate response with schema
    const parseResult = NearBlocksFtTransactionsResponseSchema.safeParse(response);
    if (!parseResult.success) {
      const validationErrors = parseResult.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      const errorCount = parseResult.error.issues.length;
      this.logger.error(
        `Provider data validation failed - Address: ${maskAddress(address)}, Page: ${page}, Errors (showing first 5 of ${errorCount}): ${validationErrors}`
      );
      return err(new Error(`Provider data validation failed: ${validationErrors}`));
    }

    const ftTransactionsData = parseResult.data;

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

    const result = await this.httpClient.get<NearBlocksAccount>(`/v1/account/${address}`);

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    // Validate response with schema
    const parseResult = NearBlocksAccountSchema.safeParse(response);
    if (!parseResult.success) {
      return err(new Error('Invalid account data from NearBlocks'));
    }

    // Extract first account from the array
    const accounts = parseResult.data.account;
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
      const result = await this.httpClient.get<NearBlocksTransactionsResponse>(
        `/v1/account/${address}/txns-only?page=${page}&per_page=${perPage}`
      );

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

      const response = result.value;

      // Debug: Log raw response structure (only on first page to avoid spam)
      if (page === 1) {
        this.logger.debug(
          `Raw transactions response - Address: ${maskAddress(address)}, Page: ${page}, ResponseKeys: ${JSON.stringify(Object.keys(response || {}))}, ResponseType: ${typeof response}, IsArray: ${Array.isArray(response)}`
        );
        if (response && typeof response === 'object') {
          this.logger.debug(
            `Raw transactions response sample - Address: ${maskAddress(address)}, Response: ${JSON.stringify(response).slice(0, 500)}`
          );
        }
      }

      // Validate response with schema
      const parseResult = NearBlocksTransactionsResponseSchema.safeParse(response);
      if (!parseResult.success) {
        const validationErrors = parseResult.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
        const errorCount = parseResult.error.issues.length;
        this.logger.error(
          `Provider data validation failed on page ${page} - Address: ${maskAddress(address)}, Errors (showing first 5 of ${errorCount}): ${validationErrors}, RawResponse: ${JSON.stringify(response)}`
        );
        if (page === 1) {
          return err(new Error(`Provider data validation failed: ${validationErrors}`));
        }
        break;
      }

      const transactionsData = parseResult.data;

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
}
