import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage, parseDecimal } from '@exitbook/core';
import { ServiceError } from '@exitbook/http';
import { err, ok, type Result } from 'neverthrow';

import { BaseApiClient } from '../../../../core/base/api-client.js';
import type { NormalizedTransactionBase, ProviderConfig, ProviderOperation } from '../../../../core/index.js';
import { RegisterApiClient } from '../../../../core/index.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../core/streaming/streaming-adapter.js';
import type { RawBalanceData, StreamingBatchResult } from '../../../../core/types/index.js';
import { maskAddress } from '../../../../core/utils/address-utils.js';
import type { EvmChainConfig } from '../../chain-config.interface.js';
import { getEvmChainConfig } from '../../chain-registry.js';
import type { EvmTransaction } from '../../types.js';

import { mapRoutescanTransaction } from './routescan.mapper-utils.js';
import {
  RoutescanBalanceResponseSchema,
  RoutescanInternalTransactionsResponseSchema,
  RoutescanTokenTransfersResponseSchema,
  RoutescanTransactionsResponseSchema,
  type RoutescanApiResponse,
  type RoutescanInternalTransaction,
  type RoutescanTransaction,
  type RoutescanTokenTransfer,
} from './routescan.schemas.js';

/**
 * Maps blockchain names to Routescan chain IDs for free chains
 */
const CHAIN_ID_MAP: Record<string, number> = {
  animalia: 8787,
  arbitrum: 42161,
  avalanche: 43114,
  beam: 4337,
  'berachain-mainnet': 80094,
  blockticity: 28530,
  boba: 288,
  'boba-bnb': 56288,
  botanix: 3637,
  bsc: 56,
  chiliz: 88888,
  corgnet: 42069,
  corn: 21000000,
  delaunch: 96786,
  dexalot: 432204,
  dfk: 53935,
  ethereum: 1,
  feature: 33311,
  'fifa-blockchain': 13322,
  flare: 14,
  growth: 61587,
  gunz: 43419,
  henesys: 68414,
  innovo: 10036,
  'lamina1-identity': 10850,
  lamina1: 10849,
  lucid: 62521,
  mantle: 5000,
  mitosis: 124816,
  numine: 8021,
  numbers: 10507,
  optimism: 10,
  plasma: 9745,
  plyr: 16180,
  polynomial: 8008,
  pulsechain: 369,
  qchain: 12150,
  songbird: 19,
  space: 8227,
  superseed: 5330,
  tiltyard: 710420,
  titan: 84358,
  tradex: 21024,
  zeroone: 27827,
};

const ROUTESCAN_PAGE_SIZE = 10000;
const ROUTESCAN_TOKEN_PAGE_SIZE = 1000; // Token endpoint is much slower, smaller page size to avoid timeouts
const ROUTESCAN_BLOCK_CURSOR_PREFIX = 'block:';

@RegisterApiClient({
  baseUrl: 'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api',
  blockchain: 'ethereum',
  capabilities: {
    supportedOperations: ['getAddressBalances', 'getAddressTransactions'],
    supportedTransactionTypes: ['normal', 'internal', 'token'],
    supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 2 },
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 8,
      requestsPerHour: 12960,
      requestsPerMinute: 216,
      requestsPerSecond: 5,
    },
    retries: 3,
    timeout: 60000,
  },
  description: 'Multi-chain EVM blockchain explorer API with Etherscan-compatible interface',
  displayName: 'Routescan',
  name: 'routescan',
  requiresApiKey: false,
  supportedChains: Object.keys(CHAIN_ID_MAP),
})
export class RoutescanApiClient extends BaseApiClient {
  private readonly chainConfig: EvmChainConfig;
  private readonly routescanChainId: number;

  constructor(config: ProviderConfig) {
    super(config);

    // Get chain config
    const chainConfig = getEvmChainConfig(config.blockchain);
    if (!chainConfig) {
      throw new Error(`Unsupported blockchain for Routescan provider: ${config.blockchain}`);
    }
    this.chainConfig = chainConfig;

    // Map to Routescan chain ID
    const routescanChainId = CHAIN_ID_MAP[config.blockchain];
    if (!routescanChainId) {
      throw new Error(`No Routescan chain ID mapping for blockchain: ${config.blockchain}`);
    }
    this.routescanChainId = routescanChainId;

    // Override base URL with chain-specific URL
    this.reinitializeHttpClient({
      baseUrl: `https://api.routescan.io/v2/network/mainnet/evm/${this.routescanChainId}/etherscan/api`,
    });

    this.logger.debug(
      `Initialized RoutescanApiClient for ${config.blockchain} - ChainId: ${this.routescanChainId}, BaseUrl: ${this.baseUrl}, NativeCurrency: ${this.chainConfig.nativeCurrency}`
    );
  }

  extractCursors(transaction: EvmTransaction): PaginationCursor[] {
    const cursors: PaginationCursor[] = [];

    if (transaction.blockHeight !== undefined) {
      cursors.push({ type: 'blockNumber', value: transaction.blockHeight });
    }

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
    if (operation.type !== 'getAddressTransactions') {
      yield err(new Error(`Streaming not yet implemented for operation: ${operation.type}`));
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
      case 'token':
        yield* this.streamAddressTokenTransactions(
          operation.address,
          operation.contractAddress,
          resumeCursor
        ) as AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>>;
        break;
      case 'internal':
        yield* this.streamAddressInternalTransactions(operation.address, resumeCursor) as AsyncIterableIterator<
          Result<StreamingBatchResult<T>, Error>
        >;
        break;
      default:
        yield err(new Error(`Unsupported transaction type: ${streamType}`));
    }
  }

  getHealthCheckConfig() {
    const params = new URLSearchParams({
      action: 'ethsupply',
      module: 'stats',
    });

    if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
      params.append('apikey', this.apiKey);
    }

    return {
      endpoint: `?${params.toString()}`,
      validate: (response: unknown) => {
        const data = response as RoutescanApiResponse<unknown>;
        return !!(data && data.status === '1');
      },
    };
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    if (!this.isValidEvmAddress(address)) {
      return err(new Error(`Invalid EVM address: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const urlParams = new URLSearchParams({
      action: 'balance',
      address: address,
      module: 'account',
      tag: 'latest',
    });

    if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
      urlParams.append('apikey', this.apiKey);
    }

    const result = await this.httpClient.get(`?${urlParams.toString()}`, {
      schema: RoutescanBalanceResponseSchema,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const res = result.value;

    if (res.status !== '1') {
      return err(
        new ServiceError(
          `Failed to fetch ${this.chainConfig.nativeCurrency} balance: ${res.message}`,
          this.name,
          'getAddressBalances'
        )
      );
    }

    // Convert from wei to native currency
    const balanceWei = typeof res.result === 'string' ? res.result : String(res.result);
    const balanceDecimal = parseDecimal(balanceWei)
      .div(parseDecimal('10').pow(this.chainConfig.nativeDecimals))
      .toString();

    this.logger.debug(
      `Retrieved raw balance for ${maskAddress(address)}: ${balanceDecimal} ${this.chainConfig.nativeCurrency}`
    );

    return ok({
      rawAmount: balanceWei,
      symbol: this.chainConfig.nativeCurrency,
      decimals: this.chainConfig.nativeDecimals,
      decimalAmount: balanceDecimal,
    } as RawBalanceData);
  }

  private isValidEvmAddress(address: string): boolean {
    // EVM addresses are 42 characters (0x + 40 hex characters)
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    return ethAddressRegex.test(address);
  }

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<EvmTransaction>, Error>> {
    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<RoutescanTransaction>, Error>> => {
      const startBlock = this.getStartBlock(ctx);
      const page = 1;

      const params = new URLSearchParams({
        action: 'txlist',
        address: address,
        endblock: '99999999',
        module: 'account',
        offset: ROUTESCAN_PAGE_SIZE.toString(),
        page: page.toString(),
        sort: 'asc',
        startblock: String(startBlock),
      });

      if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
        params.append('apikey', this.apiKey);
      }

      const result = await this.httpClient.get(`?${params.toString()}`, {
        schema: RoutescanTransactionsResponseSchema,
      });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch transactions for ${maskAddress(address)} page ${page} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const res = result.value;

      if (res.status !== '1') {
        // No transactions found is a valid completion state
        if (res.message === 'No transactions found') {
          return ok({
            items: [],
            nextPageToken: undefined,
            isComplete: true,
          });
        }
        return err(new ServiceError(`Routescan API error: ${res.message}`, this.name, 'streamAddressTransactions'));
      }

      // Handle case where result is a string (error message) instead of array
      if (typeof res.result === 'string') {
        return err(new ServiceError(`Routescan API error: ${res.result}`, this.name, 'streamAddressTransactions'));
      }

      const transactions = res.result || [];
      const hasMore = transactions.length >= ROUTESCAN_PAGE_SIZE;
      const lastTx = transactions[transactions.length - 1];
      const lastBlock = lastTx ? Number(lastTx.blockNumber) : undefined;
      const nextPageToken = hasMore ? this.getNextPageTokenFromLastBlock(lastBlock) : undefined;

      if (hasMore && nextPageToken === undefined) {
        this.logger.warn(
          `Routescan pagination could not determine next block cursor; stopping early for ${maskAddress(address)}.`
        );
      }

      return ok({
        items: transactions,
        nextPageToken,
        isComplete: !hasMore,
      });
    };

    return createStreamingIterator<RoutescanTransaction, EvmTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapRoutescanTransaction(raw, this.chainConfig.nativeCurrency);
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

  private streamAddressInternalTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<EvmTransaction>, Error>> {
    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<RoutescanInternalTransaction>, Error>> => {
      const startBlock = this.getStartBlock(ctx);
      const page = 1;

      const params = new URLSearchParams({
        action: 'txlistinternal',
        address: address,
        endblock: '99999999',
        module: 'account',
        offset: ROUTESCAN_PAGE_SIZE.toString(),
        page: page.toString(),
        sort: 'asc',
        startblock: String(startBlock),
      });

      if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
        params.append('apikey', this.apiKey);
      }

      const result = await this.httpClient.get(`?${params.toString()}`, {
        schema: RoutescanInternalTransactionsResponseSchema,
      });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch internal transactions for ${maskAddress(address)} page ${page} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const res = result.value;

      if (res.status !== '1') {
        // No transactions found is a valid completion state
        if (res.message === 'No transactions found') {
          return ok({
            items: [],
            nextPageToken: undefined,
            isComplete: true,
          });
        }
        return err(
          new ServiceError(`Routescan API error: ${res.message}`, this.name, 'streamAddressInternalTransactions')
        );
      }

      // Handle case where result is a string (error message) instead of array
      if (typeof res.result === 'string') {
        return err(
          new ServiceError(`Routescan API error: ${res.result}`, this.name, 'streamAddressInternalTransactions')
        );
      }

      const transactions = res.result || [];
      const hasMore = transactions.length >= ROUTESCAN_PAGE_SIZE;
      const lastTx = transactions[transactions.length - 1];
      const lastBlock = lastTx ? Number(lastTx.blockNumber) : undefined;
      const nextPageToken = hasMore ? this.getNextPageTokenFromLastBlock(lastBlock) : undefined;

      if (hasMore && nextPageToken === undefined) {
        this.logger.warn(
          `Routescan pagination could not determine next block cursor; stopping early for ${maskAddress(address)}.`
        );
      }

      return ok({
        items: transactions,
        nextPageToken,
        isComplete: !hasMore,
      });
    };

    return createStreamingIterator<RoutescanInternalTransaction, EvmTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', streamType: 'internal', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapRoutescanTransaction(raw, this.chainConfig.nativeCurrency);
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

  private streamAddressTokenTransactions(
    address: string,
    contractAddress?: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<EvmTransaction>, Error>> {
    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<RoutescanTokenTransfer>, Error>> => {
      const startBlock = this.getStartBlock(ctx);
      const page = 1;

      const params = new URLSearchParams({
        action: 'tokentx',
        address: address,
        endblock: '99999999',
        module: 'account',
        offset: ROUTESCAN_TOKEN_PAGE_SIZE.toString(),
        page: page.toString(),
        sort: 'asc',
        startblock: String(startBlock),
      });

      if (contractAddress) {
        params.append('contractaddress', contractAddress);
      }

      if (this.apiKey && this.apiKey !== 'YourApiKeyToken') {
        params.append('apikey', this.apiKey);
      }

      const result = await this.httpClient.get(`?${params.toString()}`, {
        schema: RoutescanTokenTransfersResponseSchema,
      });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch token transactions for ${maskAddress(address)} page ${page} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const res = result.value;

      if (res.status !== '1') {
        // No transactions found is a valid completion state
        if (res.message === 'No transactions found') {
          return ok({
            items: [],
            nextPageToken: undefined,
            isComplete: true,
          });
        }
        return err(
          new ServiceError(`Routescan API error: ${res.message}`, this.name, 'streamAddressTokenTransactions')
        );
      }

      // Handle case where result is a string (error message) instead of array
      if (typeof res.result === 'string') {
        return err(new ServiceError(`Routescan API error: ${res.result}`, this.name, 'streamAddressTokenTransactions'));
      }

      const transactions = res.result || [];
      const hasMore = transactions.length >= ROUTESCAN_TOKEN_PAGE_SIZE;
      const lastTx = transactions[transactions.length - 1];
      const lastBlock = lastTx ? Number(lastTx.blockNumber) : undefined;
      const nextPageToken = hasMore ? this.getNextPageTokenFromLastBlock(lastBlock) : undefined;

      if (hasMore && nextPageToken === undefined) {
        this.logger.warn(
          `Routescan pagination could not determine next block cursor; stopping early for ${maskAddress(address)}.`
        );
      }

      return ok({
        items: transactions,
        nextPageToken,
        isComplete: !hasMore,
      });
    };

    return createStreamingIterator<RoutescanTokenTransfer, EvmTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', streamType: 'token', address, contractAddress },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapRoutescanTransaction(raw, this.chainConfig.nativeCurrency);
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

  private parseStartBlockFromPageToken(pageToken?: string): number | undefined {
    if (!pageToken) return undefined;

    if (pageToken.startsWith(ROUTESCAN_BLOCK_CURSOR_PREFIX)) {
      const rawValue = pageToken.slice(ROUTESCAN_BLOCK_CURSOR_PREFIX.length);
      const parsed = Number(rawValue);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    // Legacy numeric page tokens are no longer supported due to API limits.
    // We fall back to block-based cursors to avoid overlapping pages.
    if (/^\d+$/.test(pageToken)) {
      this.logger.warn(
        `Ignoring legacy numeric page token for Routescan pagination; falling back to block-based cursor. Token: ${pageToken}`
      );
    }

    return undefined;
  }

  private getStartBlock(ctx: StreamingPageContext): number {
    const tokenBlock = this.parseStartBlockFromPageToken(ctx.pageToken);
    if (tokenBlock !== undefined) return tokenBlock;

    if (ctx.replayedCursor?.type === 'blockNumber') {
      return ctx.replayedCursor.value;
    }

    const resumeBlock = ctx.resumeCursor?.alternatives?.find((cursor) => cursor.type === 'blockNumber');
    if (resumeBlock) {
      return resumeBlock.value;
    }

    return 0;
  }

  private getNextPageTokenFromLastBlock(lastBlock: number | undefined): string | undefined {
    if (!Number.isFinite(lastBlock)) {
      return undefined;
    }

    const nextBlock = Number(lastBlock) + 1;
    return `${ROUTESCAN_BLOCK_CURSOR_PREFIX}${nextBlock}`;
  }
}
