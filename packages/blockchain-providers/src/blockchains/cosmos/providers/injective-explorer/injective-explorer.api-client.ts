import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { HttpClient } from '@exitbook/http';
import { err, ok, type Result } from 'neverthrow';

import type { NormalizedTransactionBase, ProviderConfig, ProviderOperation } from '../../../../core/index.js';
import { BaseApiClient, RegisterApiClient } from '../../../../core/index.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../core/streaming/streaming-adapter.js';
import type { RawBalanceData, StreamingBatchResult } from '../../../../core/types/index.js';
import { maskAddress } from '../../../../core/utils/address-utils.js';
import { convertBalance, createZeroBalance, findNativeBalance } from '../../balance-utils.js';
import type { CosmosChainConfig } from '../../chain-config.interface.js';
import { COSMOS_CHAINS } from '../../chain-registry.js';
import type { CosmosTransaction } from '../../types.js';

import type {
  InjectiveApiResponse,
  InjectiveBalanceResponse,
  InjectiveTransaction,
} from './injective-explorer.schemas.js';
import { InjectiveApiResponseSchema, InjectiveBalanceResponseSchema } from './injective-explorer.schemas.js';
import { mapInjectiveExplorerTransaction } from './mapper-utils.js';

@RegisterApiClient({
  baseUrl: 'https://sentry.exchange.grpc-web.injective.network',
  blockchain: 'injective',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
    supportedCursorTypes: ['blockNumber', 'txHash', 'timestamp'],
    preferredCursorType: 'blockNumber',
    replayWindow: { blocks: 2 },
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 5,
      requestsPerHour: 500,
      requestsPerMinute: 60,
      requestsPerSecond: 2,
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Direct connection to Injective Protocol blockchain explorer with comprehensive transaction data',
  displayName: 'Injective Explorer API',
  name: 'injective-explorer',
  requiresApiKey: false,
  supportedChains: ['injective'],
})
export class InjectiveExplorerApiClient extends BaseApiClient {
  private chainConfig: CosmosChainConfig;
  private restClient: HttpClient;

  constructor(config: ProviderConfig) {
    super(config);

    // Use provided chainConfig or default to Injective
    this.chainConfig = COSMOS_CHAINS['injective'] as CosmosChainConfig;

    // Create separate HTTP client for REST API (Bank module queries)
    this.restClient = new HttpClient({
      baseUrl: this.chainConfig.restEndpoints?.[0] ?? '',
      providerName: `${this.metadata.name}-rest`,
      rateLimit: config.rateLimit,
      retries: config.retries,
      timeout: config.timeout,
    });

    this.logger.debug(
      `Initialized InjectiveExplorerApiClient for chain: ${this.chainConfig.chainName} - BaseUrl: ${this.baseUrl}, RestUrl: ${this.chainConfig.restEndpoints?.[0] ?? ''}`
    );
  }

  extractCursors(transaction: CosmosTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    // Primary cursor: block number for Injective pagination
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
        yield* this.streamAddressTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      default:
        yield err(new Error(`Streaming not yet implemented for operation: ${operation.type}`));
    }
  }

  getHealthCheckConfig() {
    const testAddress = 'inj1qq6hgelyft8z5fnm6vyyn3ge3w2nway4ykdf6a';
    return {
      endpoint: `/api/explorer/v1/accountTxs/${testAddress}`,
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

    const endpoint = `/cosmos/bank/v1beta1/balances/${address}`;
    const result = await this.restClient.get<InjectiveBalanceResponse>(endpoint, {
      schema: InjectiveBalanceResponseSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to fetch raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    if (!response.balances || response.balances.length === 0) {
      this.logger.debug(`No balance found for address - Address: ${maskAddress(address)}`);
      return ok(createZeroBalance(this.chainConfig.nativeCurrency, this.chainConfig.nativeDecimals) as RawBalanceData);
    }

    const nativeBalance = findNativeBalance(response.balances, this.chainConfig.nativeCurrency);

    if (!nativeBalance) {
      this.logger.debug(
        `No native currency balance found for address - Address: ${maskAddress(address)}, Denoms found: ${response.balances.map((b) => b.denom).join(', ')}`
      );
      return ok(createZeroBalance(this.chainConfig.nativeCurrency, this.chainConfig.nativeDecimals) as RawBalanceData);
    }

    const balanceResult = convertBalance(
      nativeBalance.amount,
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
    const BATCH_SIZE = 50;

    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<InjectiveTransaction>, Error>> => {
      // Injective API uses skip/limit pagination
      // The pageToken is used to track the skip offset
      const skip = ctx.pageToken ? parseInt(ctx.pageToken, 10) : 0;

      const endpoint = `/api/explorer/v1/accountTxs/${address}`;
      const params = new URLSearchParams({
        skip: skip.toString(),
        limit: BATCH_SIZE.toString(),
      });

      const result = await this.httpClient.get<InjectiveApiResponse>(`${endpoint}?${params.toString()}`, {
        schema: InjectiveApiResponseSchema,
      });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch address transactions for ${maskAddress(address)} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const response = result.value;
      const items = response.data || [];

      // Determine if there are more pages
      // If we got fewer items than requested, we're done
      const hasMore = items.length === BATCH_SIZE;

      // Next page token is the new skip value (current skip + items fetched)
      const nextPageToken = hasMore ? (skip + items.length).toString() : undefined;

      return ok({
        items,
        nextPageToken,
        isComplete: !hasMore,
      });
    };

    return createStreamingIterator<InjectiveTransaction, CosmosTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapInjectiveExplorerTransaction(raw, address);
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
