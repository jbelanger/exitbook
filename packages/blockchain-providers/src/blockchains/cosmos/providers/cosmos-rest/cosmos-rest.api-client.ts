import type { CursorState, PaginationCursor } from '@exitbook/foundation';
import { getErrorMessage } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import { maskAddress } from '@exitbook/foundation';

import type {
  OneShotOperation,
  OneShotOperationResult,
  RawBalanceData,
  StreamingBatchResult,
  StreamingOperation,
} from '../../../../contracts/index.js';
import type {
  NormalizedTransactionBase,
  ProviderConfig,
  ProviderFactory,
  ProviderOperation,
} from '../../../../contracts/index.js';
import { BaseApiClient } from '../../../../runtime/base-api-client.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../runtime/streaming/adapter.js';
import { convertBalance, createZeroBalance, findNativeBalance } from '../../balance-utils.js';
import type { CosmosChainConfig } from '../../chain-config.interface.js';
import { COSMOS_CHAINS, getCosmosChainConfig } from '../../chain-registry.js';
import type { CosmosTransaction } from '../../types.js';
import { validateBech32Address } from '../../utils.js';

import { mapCosmosRestTransaction } from './cosmos-rest.mapper-utils.js';
import type { CosmosRestApiResponse, CosmosBalanceResponse, CosmosTxResponse } from './cosmos-rest.schemas.js';
import { CosmosRestApiResponseSchema, CosmosBalanceResponseSchema } from './cosmos-rest.schemas.js';

/**
 * Extended provider config that includes chainName
 */
interface CosmosRestProviderConfig extends ProviderConfig {
  chainName?: string;
}

interface CosmosAccountEventSearch {
  complete: boolean;
  key: string;
  pageToken?: string | undefined;
  query: string;
}

interface CosmosAccountEventSearchCursor {
  complete?: boolean | undefined;
  key?: string | undefined;
  pageToken?: string | undefined;
}

interface CosmosAccountEventSearchMetadata {
  accountEventSearches?: CosmosAccountEventSearchCursor[] | undefined;
}

const DEFAULT_COSMOS_ACCOUNT_EVENT_SEARCH_TEMPLATES = [
  { key: 'message_sender', query: "message.sender='${address}'" },
  { key: 'coin_spent', query: "coin_spent.spender='${address}'" },
  { key: 'coin_received', query: "coin_received.receiver='${address}'" },
  { key: 'transfer_sender', query: "transfer.sender='${address}'" },
  { key: 'transfer_recipient', query: "transfer.recipient='${address}'" },
  { key: 'withdraw_rewards', query: "withdraw_rewards.delegator='${address}'" },
  { key: 'delegate', query: "delegate.delegator='${address}'" },
  { key: 'unbond', query: "unbond.delegator='${address}'" },
  { key: 'redelegate', query: "redelegate.delegator='${address}'" },
] as const;

function materializeCosmosEventQuery(queryTemplate: string, address: string): string {
  return queryTemplate.includes('${address}') ? queryTemplate.replaceAll('${address}', address) : queryTemplate;
}

function buildCosmosAccountEventSearches(chainConfig: CosmosChainConfig, address: string): CosmosAccountEventSearch[] {
  const configuredSearches =
    chainConfig.eventFilters === undefined
      ? []
      : [
          { key: 'configured_sender', query: chainConfig.eventFilters.sender },
          { key: 'configured_receiver', query: chainConfig.eventFilters.receiver },
        ];

  const searches = [...configuredSearches, ...DEFAULT_COSMOS_ACCOUNT_EVENT_SEARCH_TEMPLATES].map((search) => ({
    complete: false,
    key: search.key,
    query: materializeCosmosEventQuery(search.query, address),
  }));

  const uniqueSearches = new Map<string, CosmosAccountEventSearch>();
  for (const search of searches) {
    const identity = search.query;
    if (!uniqueSearches.has(identity)) {
      uniqueSearches.set(identity, search);
    }
  }

  return Array.from(uniqueSearches.values());
}

function restoreCosmosAccountEventSearches(
  searches: CosmosAccountEventSearch[],
  metadata: CosmosAccountEventSearchMetadata | undefined
): void {
  const cursorsByKey = new Map((metadata?.accountEventSearches ?? []).map((cursor) => [cursor.key, cursor]));
  for (const search of searches) {
    const cursor = cursorsByKey.get(search.key);
    if (cursor === undefined) {
      continue;
    }

    search.complete = cursor.complete ?? false;
    search.pageToken = cursor.pageToken;
  }
}

function serializeCosmosAccountEventSearches(searches: CosmosAccountEventSearch[]): CosmosAccountEventSearchCursor[] {
  return searches.map((search) => ({
    complete: search.complete,
    key: search.key,
    pageToken: search.pageToken,
  }));
}

function pairCosmosTxResponses(response: CosmosRestApiResponse): CosmosTxResponse[] {
  const txResponses = response.tx_responses || [];
  const txs = response.txs || [];

  return txResponses.map((txResponse, index) => {
    if (txResponse.tx) {
      return txResponse;
    }
    if (txs[index]) {
      return { ...txResponse, tx: txs[index] };
    }
    return txResponse;
  });
}

// This class is instantiated via per-chain factories exported at the bottom of this file.
export class CosmosRestApiClient extends BaseApiClient {
  private chainConfig: CosmosChainConfig;

  constructor(config: CosmosRestProviderConfig) {
    // Get chain config to determine base URL
    const chainName = config.chainName || 'fetch';
    const chainConfig = getCosmosChainConfig(chainName);

    if (!chainConfig) {
      throw new Error(`Unknown Cosmos chain: ${chainName}. Available chains: ${Object.keys(COSMOS_CHAINS).join(', ')}`);
    }

    if (!chainConfig.restEndpoints || chainConfig.restEndpoints.length === 0) {
      throw new Error(`No REST endpoints configured for chain: ${chainName}`);
    }

    // Override baseUrl with chain-specific REST endpoint
    const restEndpoint = chainConfig.restEndpoints[0];
    if (!restEndpoint) {
      throw new Error(`No REST endpoints available for chain: ${chainName}`);
    }

    const configWithBaseUrl = {
      ...config,
      baseUrl: restEndpoint,
    };

    super(configWithBaseUrl);

    this.chainConfig = chainConfig;

    this.logger.debug(
      `Initialized CosmosRestApiClient for chain: ${this.chainConfig.chainName} (${this.chainConfig.displayName}) - BaseUrl: ${this.baseUrl}`
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
    // No replay window needed for Cosmos REST API
    return cursor;
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
    return {
      endpoint: '/cosmos/base/tendermint/v1beta1/node_info',
      validate: (response: unknown) => {
        return Boolean(response && typeof response === 'object');
      },
    };
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    if (!validateBech32Address(address, this.chainConfig.bech32Prefix)) {
      return err(new Error(`Invalid ${this.chainConfig.displayName} address: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const endpoint = `/cosmos/bank/v1beta1/balances/${address}`;
    const result = await this.httpClient.get<CosmosBalanceResponse>(endpoint, {
      schema: CosmosBalanceResponseSchema,
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

    const nativeBalance = findNativeBalance(response.balances, this.chainConfig.nativeDenom);

    if (!nativeBalance) {
      this.logger.debug(
        `No native currency balance found for address - Address: ${maskAddress(address)}, Expected denom: ${this.chainConfig.nativeDenom}, Denoms found: ${response.balances.map((b) => b.denom).join(', ')}`
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

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<CosmosTransaction>, Error>> {
    const BATCH_SIZE = 50;

    const accountEventSearches = buildCosmosAccountEventSearches(this.chainConfig, address);
    let isInitialized = false;

    const fetchPage = async (ctx: StreamingPageContext): Promise<Result<StreamingPage<CosmosTxResponse>, Error>> => {
      // Initialize: restore pagination tokens from resume cursor (FIRST CALL ONLY)
      if (!isInitialized) {
        restoreCosmosAccountEventSearches(
          accountEventSearches,
          ctx.resumeCursor?.metadata?.['custom'] as CosmosAccountEventSearchMetadata | undefined
        );
        isInitialized = true;
      }

      const allTxResponses: CosmosTxResponse[] = [];

      for (const search of accountEventSearches) {
        if (search.complete) {
          continue;
        }

        const params = new URLSearchParams({
          'pagination.limit': BATCH_SIZE.toString(),
          'pagination.count_total': 'false',
          order_by: 'ORDER_BY_DESC',
        });
        params.append(this.chainConfig.restTxSearchEventParam ?? 'query', search.query);

        if (search.pageToken) {
          params.append('pagination.key', search.pageToken);
        }

        const endpoint = `/cosmos/tx/v1beta1/txs?${params.toString()}`;
        const result = await this.httpClient.get<CosmosRestApiResponse>(endpoint, {
          schema: CosmosRestApiResponseSchema,
        });

        if (result.isErr()) {
          this.logger.error(
            `Failed to fetch Cosmos account event search "${search.key}" for ${maskAddress(address)} - Error: ${getErrorMessage(result.error)}`
          );
          return err(result.error);
        }

        const response = result.value;
        allTxResponses.push(...pairCosmosTxResponses(response));

        const nextKey = response.pagination?.next_key;
        const hasMore = Boolean(nextKey && nextKey !== '');
        search.pageToken = hasMore && nextKey ? nextKey : undefined;

        if (!hasMore) {
          search.complete = true;
          this.logger.debug(`Cosmos account event search "${search.key}" complete for ${maskAddress(address)}`);
        }
      }

      // Deduplicate by txhash, preferring versions with tx body
      const uniqueTxs = new Map<string, CosmosTxResponse>();
      for (const tx of allTxResponses) {
        const existing = uniqueTxs.get(tx.txhash);
        if (!existing) {
          uniqueTxs.set(tx.txhash, tx);
        } else if (!existing.tx && tx.tx) {
          // Replace with version that has tx body (critical for mapper)
          uniqueTxs.set(tx.txhash, tx);
          this.logger.debug(
            `Merged tx body for txhash ${tx.txhash} - replaced incomplete version with complete version`
          );
        }
      }

      const items = Array.from(uniqueTxs.values());

      // Sort by block height descending
      items.sort((a, b) => {
        const heightA = parseInt(a.height, 10);
        const heightB = parseInt(b.height, 10);
        return heightB - heightA;
      });

      const hasMore = accountEventSearches.some((search) => !search.complete);

      return ok({
        items,
        nextPageToken: accountEventSearches.find((search) => !search.complete)?.pageToken,
        isComplete: !hasMore,
        customMetadata: {
          accountEventSearches: serializeCosmosAccountEventSearches(accountEventSearches),
        },
      });
    };

    return createStreamingIterator<CosmosTxResponse, CosmosTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapCosmosRestTransaction(raw, address, this.name, this.chainConfig);
        if (mapped.isErr()) {
          const errorMessage = mapped.error.type === 'error' ? mapped.error.message : mapped.error.reason;

          // Skip transactions that are not relevant or not supported (e.g., Akash escrow messages)
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

export const cosmosRestFactories: ProviderFactory[] = Object.entries(COSMOS_CHAINS)
  .filter(([, chainConfig]) => chainConfig.restTxSearchEnabled !== false)
  .map(([chainName, chainConfig]) => ({
    create: (config: ProviderConfig) =>
      new CosmosRestApiClient({
        ...config,
        chainName,
      }),
    metadata: {
      baseUrl: chainConfig.restEndpoints?.[0] ?? '',
      blockchain: chainName,
      capabilities: {
        supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
        supportedTransactionTypes: ['normal'],
        supportedCursorTypes: ['blockNumber', 'txHash', 'timestamp', 'pageToken'],
        preferredCursorType: 'pageToken',
        replayWindow: { blocks: 0 },
      },
      defaultConfig: {
        rateLimit: {
          burstLimit: 5,
          requestsPerHour: 1000,
          requestsPerMinute: 100,
          requestsPerSecond: 5,
        },
        retries: 3,
        timeout: 30000,
      },
      description: `Cosmos SDK REST API client for ${chainConfig.displayName} using standard /cosmos/tx/v1beta1/txs endpoints`,
      displayName: `${chainConfig.displayName} REST API`,
      name: 'cosmos-rest',
      requiresApiKey: false,
      supportedChains: [chainName],
    },
  }));
