import type { CursorState, PaginationCursor } from '@exitbook/foundation';
import { getErrorMessage } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import { maskAddress } from '@exitbook/foundation';

import type {
  NormalizedTransactionBase,
  OneShotOperation,
  OneShotOperationResult,
  ProviderConfig,
  ProviderFactory,
  ProviderMetadata,
  ProviderOperation,
  StreamingBatchResult,
  StreamingOperation,
} from '../../../../contracts/index.js';
import { BaseApiClient } from '../../../../runtime/base-api-client.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../runtime/streaming/adapter.js';
import type { CosmosChainConfig } from '../../chain-config.interface.js';
import { getCosmosChainConfig } from '../../chain-registry.js';
import type { CosmosTransaction } from '../../types.js';
import { validateBech32Address } from '../../utils.js';

import { mapGetBlockCosmosTransaction } from './getblock.mapper-utils.js';
import type {
  GetBlockBlockResponse,
  GetBlockHydratedTx,
  GetBlockTxSearchResponse,
  GetBlockTxSearchTx,
} from './getblock.schemas.js';
import {
  GetBlockBlockResponseSchema,
  GetBlockStatusResponseSchema,
  GetBlockTxSearchResponseSchema,
} from './getblock.schemas.js';

interface GetBlockProviderConfig extends ProviderConfig {
  chainName?: string | undefined;
}

interface GetBlockAccountEventSearch {
  complete: boolean;
  key: string;
  page: number;
  query: string;
}

interface GetBlockAccountEventSearchCursor {
  complete?: boolean | undefined;
  key?: string | undefined;
  page?: number | undefined;
}

interface GetBlockAccountEventSearchMetadata {
  accountEventSearches?: GetBlockAccountEventSearchCursor[] | undefined;
}

const GETBLOCK_COSMOS_CHAIN = 'cosmoshub';
const GETBLOCK_TENDERMINT_PAGE_SIZE = 100;
const GETBLOCK_TIMESTAMP_HYDRATION_CONCURRENCY = 3;

const GETBLOCK_ACCOUNT_EVENT_SEARCH_TEMPLATES = [
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

export const getBlockCosmosMetadata: ProviderMetadata = {
  apiKeyEnvName: 'GETBLOCK_COSMOS_API_KEY',
  baseUrl: 'https://go.getblock.io',
  blockchain: GETBLOCK_COSMOS_CHAIN,
  capabilities: {
    supportedOperations: ['getAddressTransactions'],
    supportedTransactionTypes: ['normal'],
    supportedCursorTypes: ['blockNumber', 'txHash', 'timestamp', 'pageToken'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 0 },
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 3,
      requestsPerHour: 2000,
      requestsPerMinute: 120,
      requestsPerSecond: 3,
    },
    retries: 3,
    timeout: 30000,
  },
  description: 'GetBlock Tendermint RPC provider for Cosmos Hub indexed account transaction history',
  displayName: 'GetBlock Cosmos Hub Tendermint RPC',
  name: 'getblock-cosmos',
  requiresApiKey: true,
  supportedChains: [GETBLOCK_COSMOS_CHAIN],
};

export const getBlockCosmosFactory: ProviderFactory = {
  create: (config: ProviderConfig) =>
    new GetBlockCosmosApiClient({
      ...config,
      chainName: GETBLOCK_COSMOS_CHAIN,
    }),
  metadata: getBlockCosmosMetadata,
};

function materializeEventQuery(queryTemplate: string, address: string): string {
  return queryTemplate.replaceAll('${address}', address);
}

function buildAccountEventSearches(address: string): GetBlockAccountEventSearch[] {
  return GETBLOCK_ACCOUNT_EVENT_SEARCH_TEMPLATES.map((template) => ({
    complete: false,
    key: template.key,
    page: 1,
    query: materializeEventQuery(template.query, address),
  }));
}

function restoreAccountEventSearches(
  searches: GetBlockAccountEventSearch[],
  metadata: GetBlockAccountEventSearchMetadata | undefined
): void {
  const cursorsByKey = new Map((metadata?.accountEventSearches ?? []).map((cursor) => [cursor.key, cursor]));
  for (const search of searches) {
    const cursor = cursorsByKey.get(search.key);
    if (!cursor) {
      continue;
    }
    search.complete = cursor.complete ?? false;
    search.page = Math.max(1, cursor.page ?? 1);
  }
}

function serializeAccountEventSearches(searches: GetBlockAccountEventSearch[]): GetBlockAccountEventSearchCursor[] {
  return searches.map((search) => ({
    complete: search.complete,
    key: search.key,
    page: search.page,
  }));
}

function getRpcErrorMessage(response: { error?: { message: string } | undefined }): string | undefined {
  return response.error?.message;
}

export class GetBlockCosmosApiClient extends BaseApiClient {
  private readonly chainConfig: CosmosChainConfig;
  private readonly blockTimestampCache = new Map<string, string>();

  constructor(config: GetBlockProviderConfig) {
    const chainName = config.chainName ?? GETBLOCK_COSMOS_CHAIN;
    const chainConfig = getCosmosChainConfig(chainName);
    if (!chainConfig) {
      throw new Error(`Unknown Cosmos chain for GetBlock provider: ${chainName}`);
    }
    if (chainName !== GETBLOCK_COSMOS_CHAIN) {
      throw new Error(`GetBlock Cosmos provider currently supports ${GETBLOCK_COSMOS_CHAIN}; received ${chainName}`);
    }

    super(config);
    this.chainConfig = chainConfig;
  }

  extractCursors(transaction: CosmosTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    if (transaction.blockHeight !== undefined) {
      cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
    }
    cursors.push({ type: 'txHash', value: transaction.id });
    if (transaction.timestamp) {
      cursors.push({ type: 'timestamp', value: transaction.timestamp });
    }

    return cursors;
  }

  applyReplayWindow(cursor: PaginationCursor): PaginationCursor {
    return cursor;
  }

  async execute<TOperation extends OneShotOperation>(
    operation: TOperation
  ): Promise<Result<OneShotOperationResult<TOperation>, Error>> {
    return err(new Error(`Unsupported operation: ${operation.type}`));
  }

  async *executeStreaming<T extends NormalizedTransactionBase = NormalizedTransactionBase>(
    operation: StreamingOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    switch (operation.type) {
      case 'getAddressTransactions': {
        const streamType = operation.streamType ?? 'normal';
        if (streamType !== 'normal') {
          yield err(new Error(`Unsupported transaction type: ${streamType} for operation: ${operation.type}`));
          return;
        }
        yield* this.streamAddressTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        return;
      }
      default:
        yield err(new Error(`Streaming not implemented for operation: ${(operation as ProviderOperation).type}`));
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: this.rpcEndpoint('/status'),
      validate: (response: unknown) => {
        const parsed = GetBlockStatusResponseSchema.safeParse(response);
        if (!parsed.success || parsed.data.error || !parsed.data.result) {
          return false;
        }
        const txIndex = parsed.data.result.sync_info.tx_index ?? parsed.data.result.node_info.other?.tx_index;
        return (
          parsed.data.result.node_info.network === this.chainConfig.chainId &&
          parsed.data.result.sync_info.catching_up === false &&
          txIndex === 'on'
        );
      },
    };
  }

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<CosmosTransaction>, Error>> {
    const normalizedAddress = address.toLowerCase();
    if (!validateBech32Address(normalizedAddress, this.chainConfig.bech32Prefix)) {
      return (async function* invalidAddressStream() {
        yield err(new Error(`Invalid ${GETBLOCK_COSMOS_CHAIN} address: ${address}`));
      })();
    }

    const accountEventSearches = buildAccountEventSearches(normalizedAddress);
    let isInitialized = false;

    const fetchPage = async (ctx: StreamingPageContext): Promise<Result<StreamingPage<GetBlockHydratedTx>, Error>> => {
      if (!isInitialized) {
        restoreAccountEventSearches(
          accountEventSearches,
          ctx.resumeCursor?.metadata?.['custom'] as GetBlockAccountEventSearchMetadata | undefined
        );
        isInitialized = true;
      }

      const allTxs: GetBlockTxSearchTx[] = [];
      for (const search of accountEventSearches) {
        if (search.complete) {
          continue;
        }

        const result = await this.fetchTxSearchPage(search);
        if (result.isErr()) {
          return err(result.error);
        }

        const { totalCount, txs } = result.value;
        allTxs.push(...txs);

        const hasMore = search.page * GETBLOCK_TENDERMINT_PAGE_SIZE < totalCount;
        search.complete = !hasMore;
        if (hasMore) {
          search.page += 1;
        }
      }

      const uniqueTxs = new Map<string, GetBlockTxSearchTx>();
      for (const tx of allTxs) {
        uniqueTxs.set(tx.hash, tx);
      }

      const hydrated = await this.hydrateTimestamps(Array.from(uniqueTxs.values()));
      if (hydrated.isErr()) {
        return err(hydrated.error);
      }

      const items = hydrated.value.sort((a, b) => parseInt(b.height, 10) - parseInt(a.height, 10));
      const hasMore = accountEventSearches.some((search) => !search.complete);

      return ok({
        customMetadata: { accountEventSearches: serializeAccountEventSearches(accountEventSearches) },
        isComplete: !hasMore,
        items,
        nextPageToken: hasMore ? this.buildPageToken(accountEventSearches) : undefined,
      });
    };

    return createStreamingIterator<GetBlockHydratedTx, CosmosTransaction>({
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: 500,
      extractCursors: (tx) => this.extractCursors(tx),
      fetchPage,
      logger: this.logger,
      mapItem: (raw) => {
        const mapped = mapGetBlockCosmosTransaction(raw, normalizedAddress, this.name, this.chainConfig);
        if (mapped.isErr()) {
          const errorMessage = mapped.error.type === 'error' ? mapped.error.message : mapped.error.reason;
          if (mapped.error.type === 'skip') {
            this.logger.debug(
              `Skipping GetBlock transaction - Address: ${maskAddress(address)}, Reason: ${errorMessage}`
            );
            return ok([]);
          }
          this.logger.error(
            `GetBlock provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`
          );
          return err(new Error(`GetBlock provider data validation failed: ${errorMessage}`));
        }

        return ok([{ normalized: mapped.value, raw }]);
      },
      operation: { address: normalizedAddress, type: 'getAddressTransactions' },
      providerName: this.name,
      resumeCursor,
    });
  }

  private async fetchTxSearchPage(
    search: GetBlockAccountEventSearch
  ): Promise<Result<{ totalCount: number; txs: GetBlockTxSearchTx[] }, Error>> {
    const params = new URLSearchParams({
      order_by: '"desc"',
      page: search.page.toString(),
      per_page: GETBLOCK_TENDERMINT_PAGE_SIZE.toString(),
      query: `"${search.query}"`,
    });
    const endpoint = this.rpcEndpoint(`/tx_search?${params.toString()}`);
    const result = await this.httpClient.get<GetBlockTxSearchResponse>(endpoint, {
      schema: GetBlockTxSearchResponseSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed GetBlock tx_search "${search.key}" page ${search.page}: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;
    const rpcError = getRpcErrorMessage(response);
    if (rpcError) {
      return err(new Error(`GetBlock tx_search "${search.key}" failed: ${rpcError}`));
    }

    const txs = response.result?.txs ?? [];
    const totalCount = parseInt(response.result?.total_count ?? txs.length.toString(), 10);
    return ok({ totalCount: Number.isFinite(totalCount) ? totalCount : txs.length, txs });
  }

  private async hydrateTimestamps(txs: GetBlockTxSearchTx[]): Promise<Result<GetBlockHydratedTx[], Error>> {
    const uniqueHeights = Array.from(new Set(txs.map((tx) => tx.height)));
    const timestampsByHeight = new Map<string, string>();
    let nextHeightIndex = 0;
    let firstError: Error | undefined;

    const hydrateNextHeight = async (): Promise<void> => {
      while (nextHeightIndex < uniqueHeights.length && firstError === undefined) {
        const height = uniqueHeights[nextHeightIndex];
        nextHeightIndex += 1;
        if (!height) {
          continue;
        }

        const timestamp = await this.fetchBlockTimestamp(height);
        if (timestamp.isErr()) {
          firstError = timestamp.error;
          return;
        }
        timestampsByHeight.set(height, timestamp.value);
      }
    };

    const workerCount = Math.min(GETBLOCK_TIMESTAMP_HYDRATION_CONCURRENCY, uniqueHeights.length);
    await Promise.all(Array.from({ length: workerCount }, () => hydrateNextHeight()));

    if (firstError) {
      return err(firstError);
    }

    const hydrated: GetBlockHydratedTx[] = [];
    for (const tx of txs) {
      const timestamp = timestampsByHeight.get(tx.height);
      if (!timestamp) {
        return err(new Error(`GetBlock block timestamp hydration missing for height ${tx.height}`));
      }
      hydrated.push({ ...tx, timestamp });
    }
    return ok(hydrated);
  }

  private async fetchBlockTimestamp(height: string): Promise<Result<string, Error>> {
    const cached = this.blockTimestampCache.get(height);
    if (cached) {
      return ok(cached);
    }

    const params = new URLSearchParams({ height });
    const result = await this.httpClient.get<GetBlockBlockResponse>(this.rpcEndpoint(`/block?${params.toString()}`), {
      schema: GetBlockBlockResponseSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed GetBlock block timestamp hydration at height ${height}: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;
    const rpcError = getRpcErrorMessage(response);
    if (rpcError) {
      return err(new Error(`GetBlock block timestamp hydration failed at height ${height}: ${rpcError}`));
    }
    const timestamp = response.result?.block.header.time;
    if (!timestamp) {
      return err(new Error(`GetBlock block response at height ${height} did not include block.header.time`));
    }

    this.blockTimestampCache.set(height, timestamp);
    return ok(timestamp);
  }

  private buildPageToken(searches: GetBlockAccountEventSearch[]): string {
    const nextSearch = searches.find((search) => !search.complete);
    return nextSearch ? `${nextSearch.key}:${nextSearch.page}` : 'complete';
  }

  private rpcEndpoint(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `/${this.apiKey}${normalizedPath}`;
  }
}
