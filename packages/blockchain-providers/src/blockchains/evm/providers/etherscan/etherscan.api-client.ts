import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { err, errAsync, ok, type Result } from 'neverthrow';

import type {
  NormalizedTransactionBase,
  ProviderConfig,
  ProviderFactory,
  ProviderMetadata,
  ProviderOperation,
} from '../../../../core/index.js';
import { BaseApiClient } from '../../../../core/index.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../core/streaming/streaming-adapter.js';
import type {
  OneShotOperation,
  StreamingBatchResult,
  StreamingOperation,
  TransactionWithRawData,
} from '../../../../core/types/index.js';
import { maskAddress } from '../../../../core/utils/address-utils.js';
import type { EvmChainConfig } from '../../chain-config.interface.js';
import { getEvmChainConfig } from '../../chain-registry.js';
import type { EvmTransaction } from '../../types.js';

import {
  detectEtherscanRateLimit,
  mapEtherscanWithdrawalToEvmTransaction,
  parseEtherscanWithdrawalResponse,
  mapEtherscanNormalTransactionToEvmTransaction,
  parseEtherscanNormalTransactionResponse,
  mapEtherscanInternalTransactionToEvmTransaction,
  parseEtherscanInternalTransactionResponse,
  mapEtherscanTokenTransactionToEvmTransaction,
  parseEtherscanTokenTransactionResponse,
} from './etherscan.mapper-utils.js';
/**
 * Custom API URLs for chains that use Etherscan-compatible APIs
 * but are hosted on different infrastructure (e.g., Blockscout).
 *
 * These chains bypass the Etherscan V2 unified endpoint and use
 * their own API base URL instead.
 */
const CUSTOM_API_URLS: Record<string, string> = {
  lukso: 'https://explorer.execution.mainnet.lukso.network/api',
};

/**
 * Chains supported by Etherscan V2 API.
 * All chains use the unified V2 endpoint: https://api.etherscan.io/v2/api
 * with chainid parameter to specify the target chain.
 */
const ETHERSCAN_SUPPORTED_CHAINS = [
  'abstract',
  'abstract-sepolia',
  'apechain',
  'apechain-curtis',
  'arbitrum',
  'arbitrum-nova',
  'arbitrum-sepolia',
  'avalanche',
  'avalanche-fuji',
  'base',
  'base-sepolia',
  'berachain',
  'berachain-bepolia',
  'bittorrent',
  'bittorrent-testnet',
  'blast',
  'blast-sepolia',
  'bsc',
  'bsc-testnet',
  'celo',
  'celo-sepolia',
  'ethereum',
  'fraxtal',
  'fraxtal-hoodi',
  'gnosis',
  'holesky',
  'hoodi',
  'hyperevm',
  'katana',
  'katana-bokuto',
  'linea',
  'linea-sepolia',
  'lukso',
  'mantle',
  'mantle-sepolia',
  'memecore',
  'memecore-testnet',
  'monad',
  'monad-testnet',
  'moonbase',
  'moonbeam',
  'moonriver',
  'opbnb',
  'opbnb-testnet',
  'optimism',
  'optimism-sepolia',
  'plasma',
  'plasma-testnet',
  'polygon',
  'polygon-amoy',
  'scroll',
  'scroll-sepolia',
  'sei',
  'sei-testnet',
  'sepolia',
  'sonic',
  'sonic-testnet',
  'stable',
  'stable-testnet',
  'swellchain',
  'swellchain-testnet',
  'taiko',
  'taiko-hoodi',
  'unichain',
  'unichain-sepolia',
  'world-chain',
  'world-chain-sepolia',
  'xdc',
  'xdc-apothem',
];

/**
 * Etherscan API client for EVM blockchain data.
 *
 * Supports multiple EVM chains through Etherscan's family of block explorers.
 * Provides access to normal, internal, token, and beacon chain withdrawal transactions.
 *
 * API Docs: https://docs.etherscan.io/api-endpoints/accounts
 *
 * Note: This provider only supports streaming operations. Use executeStreaming() for all operations.
 */
export const etherscanMetadata: ProviderMetadata = {
  apiKeyEnvVar: 'ETHERSCAN_API_KEY',
  baseUrl: 'https://api.etherscan.io/v2/api',
  blockchain: 'ethereum',
  capabilities: {
    supportedOperations: ['getAddressTransactions'],
    supportedTransactionTypes: ['normal', 'internal', 'token', 'beacon_withdrawal'],
    supportedCursorTypes: ['pageToken', 'blockNumber'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 2 },
  },
  defaultConfig: {
    rateLimit: {
      requestsPerSecond: 3,
      requestsPerMinute: 180,
      requestsPerHour: 4000,
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Etherscan API for EVM chains with comprehensive transaction support',
  displayName: 'Etherscan',
  name: 'etherscan',
  requiresApiKey: true,
  supportedChains: ETHERSCAN_SUPPORTED_CHAINS,
};

export const etherscanFactory: ProviderFactory = {
  create: (config: ProviderConfig) => new EtherscanApiClient(config),
  metadata: etherscanMetadata,
};

export class EtherscanApiClient extends BaseApiClient {
  // Etherscan V2 API constraint: PageNo × Offset ≤ 10,000
  // Using 1000 allows up to 10 pages (10 × 1000 = 10,000)
  private static readonly PAGE_SIZE = 1000;
  private readonly chainConfig: EvmChainConfig;
  private readonly usesCustomUrl: boolean;

  constructor(config: ProviderConfig) {
    super(config);

    // Get EVM chain config
    const evmChainConfig = getEvmChainConfig(config.blockchain);
    if (!evmChainConfig) {
      throw new Error(`Unsupported blockchain: ${config.blockchain}`);
    }
    this.chainConfig = evmChainConfig;

    // Override base URL for chains with custom API endpoints (e.g., Blockscout-based chains)
    const customUrl = CUSTOM_API_URLS[config.blockchain];
    this.usesCustomUrl = !!customUrl;

    if (customUrl) {
      this.reinitializeHttpClient({
        baseUrl: customUrl,
      });
      this.logger.debug(
        `Initialized EtherscanApiClient for ${config.blockchain} with custom URL - BaseUrl: ${this.baseUrl}`
      );
    } else {
      this.logger.debug(`Initialized EtherscanApiClient for ${config.blockchain} - BaseUrl: ${this.baseUrl}`);
    }
  }

  /**
   * Override capabilities to filter transaction types based on chain config.
   * Etherscan declares support for ['transfer', 'internal', 'token_transfer', 'beacon_withdrawal'] globally,
   * but actual support varies by chain. The chain config (evm-chains.json) defines which transaction
   * types are actually available for each chain.
   */
  get capabilities() {
    const baseCapabilities = super.capabilities;
    const chainSupportedTypes = this.chainConfig.transactionTypes;

    // Filter supportedTransactionTypes to only include what the chain actually supports
    const filteredTransactionTypes = baseCapabilities.supportedTransactionTypes
      ? baseCapabilities.supportedTransactionTypes.filter((type) => chainSupportedTypes.includes(type))
      : undefined;

    // With exactOptionalPropertyTypes, we must omit undefined properties rather than set them
    return {
      ...baseCapabilities,
      ...(filteredTransactionTypes !== undefined && { supportedTransactionTypes: filteredTransactionTypes }),
    };
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

  async execute<T>(_operation: OneShotOperation): Promise<Result<T, Error>> {
    return errAsync(
      new Error('Etherscan provider only supports streaming operations. Use executeStreaming() instead of execute().')
    );
  }

  async *executeStreaming<T extends NormalizedTransactionBase = NormalizedTransactionBase>(
    operation: StreamingOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    if (operation.type !== 'getAddressTransactions') {
      yield err(new Error(`Streaming not supported for operation: ${(operation as ProviderOperation).type}`));
      return;
    }

    const streamType = operation.streamType || 'normal';
    const nativeCurrency = this.chainConfig.nativeCurrency;

    type Iter = AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>>;

    switch (streamType) {
      case 'normal':
        yield* this.streamTransactions(
          operation.address,
          'normal',
          {
            action: 'txlist',
            label: 'normal transactions',
            parseResponse: parseEtherscanNormalTransactionResponse,
            mapItem: (raw) => mapEtherscanNormalTransactionToEvmTransaction(raw, nativeCurrency),
            getItemId: (raw) => raw.hash,
          },
          resumeCursor
        ) as Iter;
        break;
      case 'internal':
        yield* this.streamTransactions(
          operation.address,
          'internal',
          {
            action: 'txlistinternal',
            label: 'internal transactions',
            parseResponse: parseEtherscanInternalTransactionResponse,
            mapItem: (raw) => mapEtherscanInternalTransactionToEvmTransaction(raw, nativeCurrency),
            getItemId: (raw) => raw.hash,
          },
          resumeCursor
        ) as Iter;
        break;
      case 'token':
        yield* this.streamTransactions(
          operation.address,
          'token',
          {
            action: 'tokentx',
            label: 'token transactions',
            parseResponse: parseEtherscanTokenTransactionResponse,
            mapItem: (raw) => mapEtherscanTokenTransactionToEvmTransaction(raw, nativeCurrency),
            getItemId: (raw) => raw.hash,
          },
          resumeCursor
        ) as Iter;
        break;
      case 'beacon_withdrawal':
        yield* this.streamTransactions(
          operation.address,
          'beacon_withdrawal',
          {
            action: 'txsBeaconWithdrawal',
            label: 'beacon withdrawals',
            parseResponse: parseEtherscanWithdrawalResponse,
            mapItem: (raw) => mapEtherscanWithdrawalToEvmTransaction(raw, nativeCurrency),
            getItemId: (raw) => raw.withdrawalIndex,
          },
          resumeCursor
        ) as Iter;
        break;
      default:
        yield err(new Error(`Unsupported transaction type: ${streamType}`));
    }
  }

  getHealthCheckConfig() {
    const chainidParam = this.usesCustomUrl ? '' : `&chainid=${this.chainConfig.chainId}`;
    return {
      endpoint: `?module=block&action=eth_block_number${chainidParam}`,
      validate: (response: unknown) => {
        const data = response as { result: string; status: string };
        return data && data.status === '1' && typeof data.result === 'string';
      },
    };
  }

  /**
   * Unified streaming method for all Etherscan transaction types.
   *
   * Uses intelligent hybrid pagination to work within Etherscan's V2 API constraints:
   * - page × offset ≤ 10,000 hard limit
   * - Fetches pages 1-10 using offset pagination (10k items)
   * - At page 10 with more data, resets to page 1 with startblock set to last item's block
   * - Repeats cycles until all data fetched
   * - PageToken format: "page:startblock" (e.g., "5:19500000")
   */
  private streamTransactions<TRaw extends { blockNumber: string }>(
    address: string,
    streamType: string,
    config: {
      action: string;
      getItemId: (raw: TRaw) => string;
      label: string;
      mapItem: (raw: TRaw) => Result<EvmTransaction, { message?: string; reason?: string; type: string }>;
      parseResponse: (raw: unknown) => Result<TRaw[], Error>;
    },
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<EvmTransaction>, Error>> {
    const { action, label, parseResponse } = config;

    const fetchPage = async (ctx: StreamingPageContext): Promise<Result<StreamingPage<TRaw>, Error>> => {
      const params = new URLSearchParams({
        module: 'account',
        action,
        address,
        apikey: this.apiKey,
        ...(this.usesCustomUrl ? {} : { chainid: String(this.chainConfig.chainId) }),
        sort: 'asc',
        offset: String(EtherscanApiClient.PAGE_SIZE),
      });

      // Parse pageToken as "page:startblock" or just "page"
      let currentPage = 1;
      let startBlock: number | undefined;

      if (ctx.pageToken) {
        const parts = ctx.pageToken.split(':');
        const pageStr = parts[0];
        if (pageStr !== undefined) {
          currentPage = parseInt(pageStr, 10);
        }
        const blockStr = parts[1];
        if (blockStr !== undefined) {
          startBlock = parseInt(blockStr, 10);
        }
      } else if (ctx.replayedCursor?.type === 'blockNumber') {
        startBlock = ctx.replayedCursor.value;
      }

      params.append('page', String(currentPage));
      if (startBlock !== undefined) {
        params.append('startblock', String(startBlock));
        this.logger.debug(`Fetching page ${currentPage} from block ${startBlock}`);
      }

      const endpoint = `?${params.toString()}`;
      const result = await this.httpClient.get(endpoint, { validateResponse: detectEtherscanRateLimit });

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch ${label} for ${maskAddress(address)} - Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const parseResult = parseResponse(result.value);
      if (parseResult.isErr()) {
        this.logger.error(`Failed to parse Etherscan response: ${parseResult.error.message}`);
        return err(parseResult.error);
      }

      const items = parseResult.value;
      const isComplete = items.length < EtherscanApiClient.PAGE_SIZE;

      let nextPageToken: string | undefined;

      if (!isComplete) {
        if (currentPage >= 10) {
          const lastItem = items[items.length - 1];
          if (!lastItem) {
            this.logger.error(`Cannot advance pagination: no ${label} in page`);
            return err(new Error(`Cannot advance pagination: no ${label} in page`));
          }
          // Do NOT increment the block: the 10k boundary can cut mid-block.
          // Advancing by +1 would skip remaining items from the same block.
          const nextStartBlockInclusive = parseInt(lastItem.blockNumber, 10);
          nextPageToken = `1:${nextStartBlockInclusive}`;
          this.logger.debug(
            `Completed page ${currentPage} cycle, resetting to page 1 from block ${nextStartBlockInclusive}`
          );
        } else {
          nextPageToken = startBlock !== undefined ? `${currentPage + 1}:${startBlock}` : String(currentPage + 1);
        }
      }

      this.logger.debug(
        `Fetched ${items.length} ${label} (page ${currentPage}${startBlock !== undefined ? ` from block ${startBlock}` : ''})${!isComplete ? ' (more available)' : ' (complete)'}`
      );

      return ok({
        items,
        nextPageToken,
        isComplete,
      });
    };

    return createStreamingIterator<TRaw, EvmTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', streamType, address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = config.mapItem(raw);
        if (mapped.isErr()) {
          const errorMessage = mapped.error.type === 'error' ? mapped.error.message : mapped.error.reason;
          this.logger.error(`Failed to map ${label.slice(0, -1)} ${config.getItemId(raw)} - Error: ${errorMessage}`);
          return err(new Error(`Failed to map ${label.slice(0, -1)}: ${errorMessage}`));
        }

        return ok([
          {
            raw,
            normalized: mapped.value,
          } as TransactionWithRawData<EvmTransaction>,
        ]);
      },
      extractCursors: (tx) => this.extractCursors(tx),
      applyReplayWindow: (cursor) => this.applyReplayWindow(cursor),
      dedupWindowSize: 500,
      logger: this.logger,
    });
  }
}
