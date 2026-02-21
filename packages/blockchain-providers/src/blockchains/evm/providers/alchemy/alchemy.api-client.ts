/**
 * Alchemy API Client for EVM chains
 *
 * Key characteristics:
 * - Uses alchemy_getAssetTransfers for transaction fetching
 * - Requires separate eth_getTransactionReceipt calls for gas fees
 * - Dual pagination (FROM/TO) requires careful handling
 * - Fails loudly on data quality issues - no silent defaults
 */

import type { CursorState, PaginationCursor, TokenMetadata } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { HttpClient } from '@exitbook/http';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import type {
  NormalizedTransactionBase,
  ProviderConfig,
  ProviderFactory,
  ProviderMetadata,
} from '../../../../core/index.js';
import { BaseApiClient } from '../../../../core/index.js';
import {
  createStreamingIterator,
  type StreamingPage,
  type StreamingPageContext,
} from '../../../../core/streaming/streaming-adapter.js';
import type {
  ProviderOperation,
  JsonRpcResponse,
  RawBalanceData,
  StreamingBatchResult,
  OneShotOperation,
  OneShotOperationResult,
  StreamingOperation,
} from '../../../../core/types/index.js';
import { maskAddress } from '../../../../core/utils/address-utils.js';
import { isNativeToken } from '../../balance-utils.js';
import type { EvmChainConfig } from '../../chain-config.interface.js';
import { getEvmChainConfig } from '../../chain-registry.js';
import type { EvmTransaction } from '../../types.js';

import { deduplicateRawTransfers, enrichTransfersWithGasFees } from './alchemy.enrichment-utils.js';
import { extractAlchemyNetworkName } from './alchemy.mapper-utils.js';
import { mapAlchemyTransaction } from './alchemy.mapper-utils.js';
import { buildDualPageToken, parseDualPageToken } from './alchemy.pagination-utils.js';
import type { AlchemyAssetTransfer, AlchemyAssetTransferParams } from './alchemy.schemas.js';
import {
  AlchemyAssetTransfersJsonRpcResponseSchema,
  AlchemyPortfolioBalanceResponseSchema,
  AlchemyTokenMetadataSchema,
} from './alchemy.schemas.js';

export const alchemyMetadata: ProviderMetadata = {
  apiKeyEnvVar: 'ALCHEMY_API_KEY',
  baseUrl: 'https://eth-mainnet.g.alchemy.com/v2',
  blockchain: 'ethereum',
  capabilities: {
    supportedOperations: [
      'getAddressInfo',
      'getAddressBalances',
      'getAddressTokenBalances',
      //'getAddressTransactions', DISABLING, need to getReceipts for gas fees which is expensive
      'getTokenMetadata',
    ],
    supportedTransactionTypes: ['normal', 'internal', 'token'],
    supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 2 },
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 10,
      requestsPerHour: 3600,
      requestsPerMinute: 300,
      requestsPerSecond: 5,
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Alchemy API with multi-chain EVM support for transactions and token data',
  displayName: 'Alchemy',
  name: 'alchemy',
  requiresApiKey: true,
  supportedChains: {
    abstract: { baseUrl: 'https://abstract-mainnet.g.alchemy.com/v2' },
    anime: { baseUrl: 'https://anime-mainnet.g.alchemy.com/v2' },
    apechain: { baseUrl: 'https://apechain-mainnet.g.alchemy.com/v2' },
    arbitrum: { baseUrl: 'https://arb-mainnet.g.alchemy.com/v2' },
    'arbitrum-nova': { baseUrl: 'https://arbnova-mainnet.g.alchemy.com/v2' },
    astar: { baseUrl: 'https://astar-mainnet.g.alchemy.com/v2' },
    avalanche: { baseUrl: 'https://avax-mainnet.g.alchemy.com/v2' },
    base: { baseUrl: 'https://base-mainnet.g.alchemy.com/v2' },
    berachain: { baseUrl: 'https://berachain-mainnet.g.alchemy.com/v2' },
    blast: { baseUrl: 'https://blast-mainnet.g.alchemy.com/v2' },
    botanix: { baseUrl: 'https://botanix-mainnet.g.alchemy.com/v2' },
    bsc: { baseUrl: 'https://bnb-mainnet.g.alchemy.com/v2' },
    celo: { baseUrl: 'https://celo-mainnet.g.alchemy.com/v2' },
    crossfi: { baseUrl: 'https://crossfi-mainnet.g.alchemy.com/v2' },
    degen: { baseUrl: 'https://degen-mainnet.g.alchemy.com/v2' },
    ethereum: { baseUrl: 'https://eth-mainnet.g.alchemy.com/v2' },
    fantom: { baseUrl: 'https://fantom-mainnet.g.alchemy.com/v2' },
    flow: { baseUrl: 'https://flow-mainnet.g.alchemy.com/v2' },
    fraxtal: { baseUrl: 'https://frax-mainnet.g.alchemy.com/v2' },
    gnosis: { baseUrl: 'https://gnosis-mainnet.g.alchemy.com/v2' },
    humanity: { baseUrl: 'https://humanity-mainnet.g.alchemy.com/v2' },
    hyperliquid: { baseUrl: 'https://hyperliquid-mainnet.g.alchemy.com/v2' },
    ink: { baseUrl: 'https://ink-mainnet.g.alchemy.com/v2' },
    lens: { baseUrl: 'https://lens-mainnet.g.alchemy.com/v2' },
    linea: { baseUrl: 'https://linea-mainnet.g.alchemy.com/v2' },
    mantle: { baseUrl: 'https://mantle-mainnet.g.alchemy.com/v2' },
    metis: { baseUrl: 'https://metis-mainnet.g.alchemy.com/v2' },
    opbnb: { baseUrl: 'https://opbnb-mainnet.g.alchemy.com/v2' },
    optimism: { baseUrl: 'https://opt-mainnet.g.alchemy.com/v2' },
    plasma: { baseUrl: 'https://plasma-mainnet.g.alchemy.com/v2' },
    polygon: { baseUrl: 'https://polygon-mainnet.g.alchemy.com/v2' },
    'polygon-zkevm': { baseUrl: 'https://polygonzkevm-mainnet.g.alchemy.com/v2' },
    polynomial: { baseUrl: 'https://polynomial-mainnet.g.alchemy.com/v2' },
    ronin: { baseUrl: 'https://ronin-mainnet.g.alchemy.com/v2' },
    rootstock: { baseUrl: 'https://rootstock-mainnet.g.alchemy.com/v2' },
    scroll: { baseUrl: 'https://scroll-mainnet.g.alchemy.com/v2' },
    sei: { baseUrl: 'https://sei-mainnet.g.alchemy.com/v2' },
    settlus: { baseUrl: 'https://settlus-mainnet.g.alchemy.com/v2' },
    shape: { baseUrl: 'https://shape-mainnet.g.alchemy.com/v2' },
    soneium: { baseUrl: 'https://soneium-mainnet.g.alchemy.com/v2' },
    sonic: { baseUrl: 'https://sonic-mainnet.g.alchemy.com/v2' },
    story: { baseUrl: 'https://story-mainnet.g.alchemy.com/v2' },
    superseed: { baseUrl: 'https://superseed-mainnet.g.alchemy.com/v2' },
    unichain: { baseUrl: 'https://unichain-mainnet.g.alchemy.com/v2' },
    'world-chain': { baseUrl: 'https://worldchain-mainnet.g.alchemy.com/v2' },
    zetachain: { baseUrl: 'https://zetachain-mainnet.g.alchemy.com/v2' },
    zksync: { baseUrl: 'https://zksync-mainnet.g.alchemy.com/v2' },
    zora: { baseUrl: 'https://zora-mainnet.g.alchemy.com/v2' },
  },
};

export const alchemyFactory: ProviderFactory = {
  create: (config: ProviderConfig) => new AlchemyApiClient(config),
  metadata: alchemyMetadata,
};

export class AlchemyApiClient extends BaseApiClient {
  private readonly chainConfig: EvmChainConfig;
  private portfolioClient: HttpClient;

  /**
   * Constructor validates chain support and native currency configuration.
   *
   * Note: This constructor can throw for unsupported chains or invalid configuration.
   * These errors are caught by ProviderManager during provider initialization and logged
   * (see provider-manager.ts lines 425-435, 1012-1022). The provider will be skipped
   * and other providers will be used. This is acceptable since constructors cannot
   * return Result types.
   */
  constructor(config: ProviderConfig) {
    super(config);

    // Get EVM chain config for native currency
    const evmChainConfig = getEvmChainConfig(config.blockchain);
    if (!evmChainConfig) {
      throw new Error(`Unsupported blockchain for Alchemy provider: ${config.blockchain}`);
    }
    this.chainConfig = evmChainConfig;

    // Validate chain config has native currency (required for gas fee calculation)
    if (!this.chainConfig.nativeCurrency) {
      throw new Error(
        `Chain config for ${config.blockchain} is missing nativeCurrency. This is required for gas fee calculation.`
      );
    }

    // Create separate HTTP client for Portfolio API
    this.portfolioClient = new HttpClient({
      baseUrl: `https://api.g.alchemy.com/data/v1/${this.apiKey}`,
      instrumentation: config.instrumentation,
      hooks: config.requestHooks,
      providerName: `${this.metadata.name}-portfolio`,
      rateLimit: config.rateLimit,
      retries: config.retries,
      service: 'blockchain',
      timeout: config.timeout,
    });
  }

  /**
   * Override capabilities to filter transaction types based on chain config.
   * Alchemy declares support for ['normal', 'internal', 'token'] globally, but actual
   * support varies by chain. The chain config (evm-chains.json) defines which transaction
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

  async execute<TOperation extends OneShotOperation>(
    operation: TOperation
  ): Promise<Result<OneShotOperationResult<TOperation>, Error>> {
    this.logger.debug(`Executing operation: ${operation.type}`);

    switch (operation.type) {
      case 'getAddressInfo': {
        const { address } = operation;
        this.logger.debug(`Fetching address info - Address: ${maskAddress(address)}`);
        return (await this.getAddressInfo(address)) as Result<OneShotOperationResult<TOperation>, Error>;
      }
      case 'getAddressBalances': {
        const { address } = operation;
        this.logger.debug(`Fetching native balance - Address: ${maskAddress(address)}`);
        return (await this.getAddressBalances(address)) as Result<OneShotOperationResult<TOperation>, Error>;
      }
      case 'getAddressTokenBalances': {
        const { address, contractAddresses } = operation;
        this.logger.debug(`Fetching token balances - Address: ${maskAddress(address)}`);
        return (await this.getAddressTokenBalances(address, contractAddresses)) as Result<
          OneShotOperationResult<TOperation>,
          Error
        >;
      }
      case 'getTokenMetadata': {
        const { contractAddresses } = operation;
        this.logger.debug(`Fetching token metadata for ${contractAddresses.length} contracts`);
        return (await this.getTokenMetadata(contractAddresses)) as Result<OneShotOperationResult<TOperation>, Error>;
      }
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  async *executeStreaming<T extends NormalizedTransactionBase = NormalizedTransactionBase>(
    operation: StreamingOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    if (operation.type !== 'getAddressTransactions') {
      yield err(new Error(`Streaming not yet implemented for operation: ${(operation as ProviderOperation).type}`));
      return;
    }

    const streamType = operation.streamType || 'normal';

    const configMap: Record<string, StreamTransferConfig> = {
      normal: {
        address: operation.address,
        categories: ['external'],
        streamType: 'normal',
        enrichWithGasFees: true,
        resumeCursor,
      },
      internal: {
        address: operation.address,
        categories: ['internal'],
        streamType: 'internal',
        enrichWithGasFees: false,
        resumeCursor,
      },
      token: {
        address: operation.address,
        categories: ['erc20', 'erc721', 'erc1155'],
        streamType: 'token',
        contractAddress: operation.contractAddress,
        enrichWithGasFees: false,
        resumeCursor,
      },
    };

    const config = configMap[streamType];
    if (!config) {
      yield err(new Error(`Unsupported transaction type: ${streamType}`));
      return;
    }

    yield* this.streamTransfers(config) as AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>>;
  }

  getHealthCheckConfig() {
    return {
      body: {
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
      },
      endpoint: `/${this.apiKey}`,
      method: 'POST' as const,
      validate: (response: unknown) => {
        const data = response as JsonRpcResponse<string>;
        return data && data.result !== undefined;
      },
    };
  }

  private getAlchemyNetworkName(): string {
    return extractAlchemyNetworkName(this.baseUrl, this.blockchain);
  }

  private async getAddressInfo(address: string): Promise<Result<{ code: string; isContract: boolean }, Error>> {
    const result = await this.httpClient.post<JsonRpcResponse<string>>(`/${this.apiKey}`, {
      id: 1,
      jsonrpc: '2.0',
      method: 'eth_getCode',
      params: [address, 'latest'],
    });

    if (result.isErr()) {
      this.logger.error(`Failed to fetch address code - Error: ${getErrorMessage(result.error)}`);
      return err(result.error);
    }

    const response = result.value;
    if (typeof response.result !== 'string') {
      this.logger.warn({ response: response.result, address: maskAddress(address) }, 'Unexpected eth_getCode response');
      return err(new Error('Invalid eth_getCode response'));
    }

    const code = response.result;
    const normalized = code.toLowerCase();
    const isContract = normalized !== '0x' && normalized !== '0x0';

    return ok({ code, isContract });
  }

  private async getAddressBalances(address: string): Promise<Result<RawBalanceData, Error>> {
    const networkName = this.getAlchemyNetworkName();

    const requestBody = {
      addresses: [
        {
          address,
          networks: [networkName],
        },
      ],
      includeErc20Tokens: false,
      includeNativeToken: true,
      withMetadata: true,
    };

    const result = await this.portfolioClient.post('/assets/tokens/balances/by-address', requestBody, {
      schema: AlchemyPortfolioBalanceResponseSchema,
    });

    if (result.isErr()) {
      this.logger.error(`Failed to fetch native balance for ${address} - Error: ${getErrorMessage(result.error)}`);
      return err(result.error);
    }

    const tokenBalances = result.value.data.tokens;

    // Find the native token (tokenAddress is null for native token)
    const nativeBalance = tokenBalances.find((balance) => isNativeToken(balance.tokenAddress));

    if (!nativeBalance) {
      this.logger.debug(`No native balance found for ${address}`);
      return ok({
        rawAmount: '0',
        symbol: this.chainConfig.nativeCurrency,
        contractAddress: undefined,
        decimals: 18,
      });
    }

    const metadata = nativeBalance.tokenMetadata;
    const symbol = metadata?.symbol || this.chainConfig.nativeCurrency;
    const decimals = metadata?.decimals ?? 18;

    this.logger.debug(
      `Found native balance for ${address}: ${nativeBalance.tokenBalance} (${symbol}, ${decimals} decimals)`
    );

    return ok({
      rawAmount: nativeBalance.tokenBalance,
      symbol,
      contractAddress: nativeBalance.tokenAddress ?? undefined,
      decimals,
    });
  }

  private async getAddressTokenBalances(
    address: string,
    contractAddresses?: string[]
  ): Promise<Result<RawBalanceData[], Error>> {
    const networkName = this.getAlchemyNetworkName();

    const requestBody = {
      addresses: [
        {
          address,
          networks: [networkName],
        },
      ],
      includeErc20Tokens: true,
      includeNativeToken: false,
      withMetadata: true,
    };

    const result = await this.portfolioClient.post('/assets/tokens/balances/by-address', requestBody, {
      schema: AlchemyPortfolioBalanceResponseSchema,
    });

    if (result.isErr()) {
      this.logger.error(`Failed to fetch token balances for ${address} - Error: ${getErrorMessage(result.error)}`);
      return err(result.error);
    }

    const tokenBalances = result.value.data.tokens;

    // Filter by contract addresses if provided
    const filteredBalances = contractAddresses
      ? tokenBalances.filter((balance) => balance.tokenAddress && contractAddresses.includes(balance.tokenAddress))
      : tokenBalances;

    // Return raw balance data - let caller handle conversions
    const balances: RawBalanceData[] = [];
    for (const balance of filteredBalances.filter((b) => b.tokenBalance !== '0')) {
      if (!balance.tokenAddress) {
        continue;
      }

      const metadata = balance.tokenMetadata;

      balances.push({
        rawAmount: balance.tokenBalance,
        symbol: metadata?.symbol ?? undefined,
        contractAddress: balance.tokenAddress,
        decimals: metadata?.decimals ?? undefined,
      });
    }

    this.logger.debug(`Found ${balances.length} token balances for ${address}`);
    return ok(balances);
  }

  /**
   * Fetch token metadata for multiple contracts using Alchemy's alchemy_getTokenMetadata JSON-RPC method.
   */
  private async getTokenMetadata(contractAddresses: string[]): Promise<Result<TokenMetadata[], Error>> {
    if (contractAddresses.length === 0) {
      return ok([]);
    }

    this.logger.debug(`Fetching metadata for ${contractAddresses.length} tokens via alchemy_getTokenMetadata`);

    // Fetch metadata for each contract in parallel
    const metadataPromises = contractAddresses.map((contractAddress) => this.fetchSingleTokenMetadata(contractAddress));

    const results = await Promise.all(metadataPromises);

    // Filter out errors and collect successful results
    const metadata: TokenMetadata[] = [];
    let failureCount = 0;

    for (const result of results) {
      if (result.isOk() && result.value) {
        metadata.push(result.value);
      } else {
        failureCount++;
      }
    }

    if (failureCount > 0) {
      this.logger.warn(`Failed to fetch metadata for ${failureCount}/${contractAddresses.length} tokens`);
    }

    this.logger.debug(`Successfully fetched metadata for ${metadata.length}/${contractAddresses.length} tokens`);
    return ok(metadata);
  }

  /**
   * Fetch metadata for a single token contract using alchemy_getTokenMetadata.
   */
  private async fetchSingleTokenMetadata(contractAddress: string): Promise<Result<TokenMetadata | undefined, Error>> {
    const result = await this.httpClient.post(
      `/${this.apiKey}`,
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'alchemy_getTokenMetadata',
        params: [contractAddress],
      },
      { schema: z.object({ result: AlchemyTokenMetadataSchema.nullish(), error: z.any().nullish() }) }
    );

    if (result.isErr()) {
      return err(result.error);
    }

    const response = result.value;
    if (response.error) {
      return err(new Error(`JSON-RPC error: ${JSON.stringify(response.error)}`));
    }

    if (!response.result) {
      return ok(undefined);
    }

    const tokenData = response.result;

    return ok({
      contractAddress,
      symbol: tokenData.symbol ?? undefined,
      name: tokenData.name ?? undefined,
      decimals: tokenData.decimals,
    });
  }

  /**
   * Unified streaming method for all transaction types (normal, internal, token).
   * Uses dual pagination (FROM/TO) to capture both sent and received transfers.
   */
  private streamTransfers(
    config: StreamTransferConfig
  ): AsyncIterableIterator<Result<StreamingBatchResult<EvmTransaction>, Error>> {
    const {
      address,
      categories,
      streamType,
      contractAddress,
      enrichWithGasFees: shouldEnrichGas,
      resumeCursor,
    } = config;
    const label = streamType ?? 'normal';

    const baseParams: AlchemyAssetTransferParams = {
      category: categories,
      excludeZeroValue: false,
      fromBlock: '0x0',
      maxCount: '0x3e8', // 1000 in hex
      toBlock: 'latest',
      withMetadata: true,
    };

    if (contractAddress) {
      baseParams.contractAddresses = [contractAddress];
    }

    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<AlchemyAssetTransfer>, Error>> => {
      const fromParams: AlchemyAssetTransferParams = {
        ...baseParams,
        fromAddress: address,
      };
      const toParams: AlchemyAssetTransferParams = {
        ...baseParams,
        toAddress: address,
      };

      const { from: fromPageKey, to: toPageKey } = parseDualPageToken(ctx.pageToken);
      if (fromPageKey) {
        fromParams.pageKey = fromPageKey;
      }
      if (toPageKey) {
        toParams.pageKey = toPageKey;
      }

      // Fetch FROM transfers
      const fromResult = await this.httpClient.post(
        `/${this.apiKey}`,
        {
          id: 1,
          jsonrpc: '2.0',
          method: 'alchemy_getAssetTransfers',
          params: [fromParams],
        },
        { schema: AlchemyAssetTransfersJsonRpcResponseSchema }
      );

      if (fromResult.isErr()) {
        this.logger.error(
          `Failed to fetch FROM ${label} transfers for ${maskAddress(address)} - Error: ${getErrorMessage(fromResult.error)}`
        );
        return err(fromResult.error);
      }

      if (fromResult.value.error) {
        const error = fromResult.value.error;
        this.logger.error(`Alchemy JSON-RPC error (FROM ${label}) - Code: ${error.code}, Message: ${error.message}`);
        return err(new Error(`Alchemy API error: ${error.message}`));
      }

      // Fetch TO transfers
      const toResult = await this.httpClient.post(
        `/${this.apiKey}`,
        {
          id: 1,
          jsonrpc: '2.0',
          method: 'alchemy_getAssetTransfers',
          params: [toParams],
        },
        { schema: AlchemyAssetTransfersJsonRpcResponseSchema }
      );

      if (toResult.isErr()) {
        this.logger.error(
          `Failed to fetch TO ${label} transfers for ${maskAddress(address)} - Error: ${getErrorMessage(toResult.error)}`
        );
        return err(toResult.error);
      }

      if (toResult.value.error) {
        const error = toResult.value.error;
        this.logger.error(`Alchemy JSON-RPC error (TO ${label}) - Code: ${error.code}, Message: ${error.message}`);
        return err(new Error(`Alchemy API error: ${error.message}`));
      }

      const fromTransfers = fromResult.value.result?.transfers || [];
      const toTransfers = toResult.value.result?.transfers || [];
      const mergedTransfers = [...fromTransfers, ...toTransfers];

      // Deduplicate at raw level before mapping (important for self-transfers)
      const allTransfers = deduplicateRawTransfers(mergedTransfers, this.logger);

      // Enrich with gas fees from receipts (only for normal/external transactions)
      if (shouldEnrichGas) {
        const enrichResult = await enrichTransfersWithGasFees(allTransfers, {
          httpClient: this.httpClient,
          apiKey: this.apiKey,
          nativeCurrency: this.chainConfig.nativeCurrency,
          logger: this.logger,
        });
        if (enrichResult.isErr()) {
          return err(enrichResult.error);
        }
      }

      const nextFromKey = fromResult.value.result?.pageKey ?? undefined;
      const nextToKey = toResult.value.result?.pageKey ?? undefined;
      const nextPageToken = buildDualPageToken(nextFromKey, nextToKey);

      return ok({
        items: allTransfers,
        nextPageToken,
        isComplete: !nextFromKey && !nextToKey,
      });
    };

    // Track data quality metrics
    let totalProcessed = 0;
    let totalSkipped = 0;

    return createStreamingIterator<AlchemyAssetTransfer, EvmTransaction>({
      providerName: this.name,
      operation: {
        type: 'getAddressTransactions',
        address,
        ...(streamType && streamType !== 'normal' && { streamType }),
        ...(contractAddress && { contractAddress }),
      },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        totalProcessed++;

        // Log when applying ZERO_ADDRESS sentinel for null from address
        if (raw.from === null || raw.from === undefined) {
          const isTokenMint = raw.category === 'erc20' || raw.category === 'erc721' || raw.category === 'erc1155';
          if (isTokenMint) {
            this.logger.debug(
              `Null from address in token transfer (likely mint) - Hash: ${raw.hash}, Category: ${raw.category}`
            );
          } else {
            this.logger.warn(
              `Unexpected null from address for non-token transfer - Hash: ${raw.hash}, Category: ${raw.category}. Applying ZERO_ADDRESS sentinel.`
            );
          }
        }

        const mapped = mapAlchemyTransaction(raw);
        if (mapped.isErr()) {
          totalSkipped++;
          const errorMessage = mapped.error.type === 'error' ? mapped.error.message : mapped.error.reason;
          this.logger.warn(
            `Skipping transaction due to data quality issue - Address: ${maskAddress(address)}, Hash: ${raw.hash}, Error: ${errorMessage}`
          );

          // Warn if skip rate exceeds 5% (indicates systemic provider issues)
          const skipRate = (totalSkipped / totalProcessed) * 100;
          if (totalSkipped > 10 && skipRate > 5) {
            this.logger.warn(
              `High skip rate detected: ${totalSkipped}/${totalProcessed} (${skipRate.toFixed(1)}%) transactions skipped due to data quality issues. This may indicate systemic provider problems.`
            );
          }

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

interface StreamTransferConfig {
  address: string;
  categories: string[];
  streamType?: 'normal' | 'internal' | 'token';
  contractAddress?: string | undefined;
  enrichWithGasFees: boolean;
  resumeCursor?: CursorState | undefined;
}
