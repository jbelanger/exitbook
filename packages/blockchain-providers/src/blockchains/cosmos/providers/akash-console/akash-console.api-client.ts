import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { NormalizedTransactionBase, ProviderConfig, ProviderOperation } from '../../../../core/index.js';
import { BaseApiClient, RegisterApiClient } from '../../../../core/index.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../core/streaming/streaming-adapter.js';
import type {
  OneShotOperation,
  RawBalanceData,
  StreamingBatchResult,
  StreamingOperation,
} from '../../../../core/types/index.js';
import { maskAddress } from '../../../../core/utils/address-utils.js';
import { convertBalance, createZeroBalance } from '../../balance-utils.js';
import type { CosmosChainConfig } from '../../chain-config.interface.js';
import { COSMOS_CHAINS } from '../../chain-registry.js';
import type { CosmosTransaction } from '../../types.js';

import type {
  AkashBalanceResponse,
  AkashTransactionDetail,
  AkashTransactionListResponse,
} from './akash-console.schemas.js';
import {
  AkashBalanceResponseSchema,
  AkashTransactionDetailSchema,
  AkashTransactionListResponseSchema,
} from './akash-console.schemas.js';
import { mapAkashConsoleTransaction } from './mapper-utils.js';

@RegisterApiClient({
  baseUrl: 'https://console-api.akash.network/v1',
  blockchain: 'akash',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
    supportedTransactionTypes: ['normal'],
    supportedCursorTypes: ['blockNumber', 'txHash', 'timestamp'],
    preferredCursorType: 'blockNumber',
    replayWindow: { blocks: 0 },
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 5,
      // Conservative limits due to N+1 query pattern (1 list + N detail calls per batch)
      // With BATCH_SIZE=20, each batch makes 21 API calls
      requestsPerHour: 1000, // ~47 batches/hour (~940 transactions)
      requestsPerMinute: 100, // ~4 batches/minute (~80 transactions)
      requestsPerSecond: 5, // Allows parallel detail fetches within batch
    },
    retries: 3,
    timeout: 30000,
  },
  description: 'Akash Console API with full historical transaction data and clean REST interface',
  displayName: 'Akash Console API',
  name: 'akash-console',
  requiresApiKey: false,
  supportedChains: ['akash'],
})
export class AkashConsoleApiClient extends BaseApiClient {
  private chainConfig: CosmosChainConfig;

  constructor(config: ProviderConfig) {
    super(config);

    // Use Akash chain config
    this.chainConfig = COSMOS_CHAINS['akash'] as CosmosChainConfig;

    this.logger.debug(
      `Initialized AkashConsoleApiClient for chain: ${this.chainConfig.chainName} - BaseUrl: ${this.baseUrl}`
    );
  }

  extractCursors(transaction: CosmosTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    // Primary cursor: block number
    if (transaction.blockHeight !== undefined) {
      cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
    }

    // Alternative cursor: transaction hash
    cursors.push({ type: 'txHash', value: transaction.id });

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
    // No replay window needed for Akash Console API
    return cursor;
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
    const testAddress = 'akash1asagzdynnr5h6c7sq3qgn4azjmsewt0lr97wj5';
    return {
      endpoint: `/addresses/${testAddress}`,
      validate: (response: unknown) => {
        return Boolean(response && typeof response === 'object');
      },
    };
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    if (!this.validateAddress(address)) {
      return err(new Error(`Invalid ${this.chainConfig.displayName} address: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const endpoint = `/addresses/${address}`;
    const result = await this.httpClient.get<AkashBalanceResponse>(endpoint, {
      schema: AkashBalanceResponseSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to fetch raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    /**
     * Balance field semantics:
     * - `available`: Spendable balance in uakt (liquid, not locked/delegated)
     * - `total`: Total balance in uakt (includes delegated/staked funds)
     * - `delegated`: Amount currently staked to validators
     * - `rewards`: Unclaimed staking rewards
     *
     * We use `available` to match standard Cosmos bank balance semantics
     * (liquid funds only). This is consistent with other providers that query
     * /cosmos/bank/v1beta1/balances which returns only spendable balances.
     *
     * Users who want to track staked funds should use separate staking queries.
     */
    const availableUakt = response.available;
    if (availableUakt <= 0) {
      this.logger.debug(`No available balance found for address - Address: ${maskAddress(address)}`);
      return ok(createZeroBalance(this.chainConfig.nativeCurrency, this.chainConfig.nativeDecimals) as RawBalanceData);
    }

    const balanceResult = convertBalance(
      String(availableUakt),
      this.chainConfig.nativeDecimals,
      this.chainConfig.nativeCurrency
    );

    this.logger.debug(
      `Found raw balance for ${maskAddress(address)}: ${balanceResult.decimalAmount} ${this.chainConfig.nativeCurrency}`
    );

    return ok(balanceResult as RawBalanceData);
  }

  private validateAddress(address: string): boolean {
    // Use bech32Prefix from chainConfig for validation
    const addressRegex = new RegExp(`^${this.chainConfig.bech32Prefix}1[a-z0-9]{38}$`);
    return addressRegex.test(address);
  }

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<CosmosTransaction>, Error>> {
    // NOTE: Reduced batch size to account for N+1 query pattern (see below)
    // BATCH_SIZE=50 means 51 API calls per batch (1 list + 50 details)
    // This is a known limitation of the Akash Console API - no bulk detail endpoint exists
    const BATCH_SIZE = 20;

    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<AkashTransactionDetail>, Error>> => {
      // Akash Console API uses skip/limit pagination
      // The pageToken is used to track the skip offset
      const skip = ctx.pageToken ? parseInt(ctx.pageToken, 10) : 0;

      const endpoint = `/addresses/${address}/transactions/${skip}/${BATCH_SIZE}`;

      this.logger.debug(
        `Fetching transactions - Address: ${maskAddress(address)}, Skip: ${skip}, Limit: ${BATCH_SIZE}`
      );

      // Fetch transaction list (lightweight)
      const listResult = await this.httpClient.get<AkashTransactionListResponse>(endpoint, {
        schema: AkashTransactionListResponseSchema,
      });

      if (listResult.isErr()) {
        this.logger.error(
          `Failed to fetch address transactions for ${maskAddress(address)} - Error: ${getErrorMessage(listResult.error)}`
        );
        return err(listResult.error);
      }

      const listResponse = listResult.value;
      const transactions = listResponse.results || [];

      this.logger.debug(
        `Fetched ${transactions.length} transactions from list endpoint - Address: ${maskAddress(address)}`
      );

      // If no transactions, we're done
      if (transactions.length === 0) {
        return ok({
          items: [],
          nextPageToken: undefined,
          isComplete: true,
        });
      }

      /**
       * N+1 QUERY PATTERN - PERFORMANCE CONSIDERATION
       *
       * The Akash Console API requires separate API calls for transaction details:
       * - /addresses/{address}/transactions/{skip}/{limit} returns lightweight list (no sender/recipient in messages)
       * - /transactions/{hash} returns full details with complete message data
       *
       * This means BATCH_SIZE=20 transactions requires 21 API calls (1 list + 20 details).
       *
       * Why we can't avoid this:
       * - List endpoint omits critical data (from_address, to_address in message.data)
       * - No bulk detail endpoint exists (as of 2026-01-19)
       * - Detail endpoint doesn't support batch fetching
       *
       * Mitigations applied:
       * - Reduced BATCH_SIZE from 50 to 20 to stay within rate limits
       * - HttpClient applies rate limiting per provider config (5 req/sec burst)
       * - Failed detail fetches are logged but don't halt the batch
       * - Promise.all parallelizes fetches within rate limit constraints
       *
       * Impact on rate limits (default config):
       * - 20 tx/batch × 21 calls = 420 calls/batch
       * - At 5 req/sec burst = ~4 seconds per batch minimum
       * - At 100 req/min limit = safe (21 calls < 100)
       */
      const detailPromises = transactions.map(async (tx) => {
        const detailResult = await this.httpClient.get<AkashTransactionDetail>(`/transactions/${tx.hash}`, {
          schema: AkashTransactionDetailSchema,
        });

        return { hash: tx.hash, result: detailResult };
      });

      const detailResults = await Promise.all(detailPromises);

      // Separate successes and failures
      const items: AkashTransactionDetail[] = [];
      const failures: { error: Error; hash: string }[] = [];

      for (const { hash, result } of detailResults) {
        if (result.isErr()) {
          failures.push({ hash, error: result.error });
        } else {
          items.push(result.value);
        }
      }

      if (failures.length > 0) {
        const sampleFailures = failures.slice(0, 3).map(({ hash, error }) => ({
          hash,
          message: getErrorMessage(error),
        }));
        const sampleHashes = failures
          .slice(0, 5)
          .map(({ hash }) => hash)
          .join(', ');
        this.logger.error(
          { sampleFailures },
          `Failed to fetch ${failures.length} transaction details for ${maskAddress(address)}. Sample hashes: ${sampleHashes}`
        );
        return err(
          new Error(
            `Akash Console detail fetch failed for ${failures.length} transactions (sample: ${sampleHashes}; errors: ${JSON.stringify(sampleFailures)})`
          )
        );
      }

      this.logger.debug(`Successfully fetched ${items.length} transaction details - Address: ${maskAddress(address)}`);

      // Determine if there are more pages
      // If we got fewer items than requested, we're done
      const hasMore = transactions.length === BATCH_SIZE;

      // Next page token is the new skip value (current skip + items fetched)
      const nextPageToken = hasMore ? (skip + transactions.length).toString() : undefined;

      return ok({
        items,
        nextPageToken,
        isComplete: !hasMore,
      });
    };

    return createStreamingIterator<AkashTransactionDetail, CosmosTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapAkashConsoleTransaction(raw, address);
        if (mapped.isErr()) {
          const errorMessage = mapped.error.type === 'error' ? mapped.error.message : mapped.error.reason;

          // Skip transactions that are not relevant or not supported
          if (mapped.error.type === 'skip') {
            this.logger.debug(`Skipping transaction - Address: ${maskAddress(address)}, Reason: ${errorMessage}`);
            return ok([]); // Return empty array to skip this transaction
          }

          // Fatal error - stop processing
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
