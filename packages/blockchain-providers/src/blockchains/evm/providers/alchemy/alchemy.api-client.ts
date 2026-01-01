/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                                                                               ║
 * ║  ⚠️  PROVIDER CURRENTLY DISABLED - DO NOT USE                                 ║
 * ║                                                                               ║
 * ║  This provider requires additional work before it can be used:                ║
 * ║                                                                               ║
 * ║  1. Fee handling is incomplete and unreliable                                 ║
 * ║  2. Some transactions are missing the "asset" property, causing crashes       ║
 * ║  3. Data validation needs to handle edge cases better                         ║
 * ║                                                                               ║
 * ║  Use Moralis or chain-specific providers instead.                             ║
 * ║                                                                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import type { CursorState, PaginationCursor } from '@exitbook/core';
import { getErrorMessage } from '@exitbook/core';
import { HttpClient } from '@exitbook/http';
import { err, ok, type Result } from 'neverthrow';

import type { NormalizedTransactionBase, ProviderConfig } from '../../../../core/index.js';
import { BaseApiClient, RegisterApiClient } from '../../../../core/index.js';
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
} from '../../../../core/types/index.js';
import { maskAddress } from '../../../../core/utils/address-utils.js';
import { isNativeToken } from '../../balance-utils.js';
import type { EvmChainConfig } from '../../chain-config.interface.js';
import { getEvmChainConfig } from '../../chain-registry.js';
import { deduplicateTransactionHashes } from '../../receipt-utils.js';
import type { EvmTransaction } from '../../types.js';

import { extractAlchemyNetworkName } from './alchemy.mapper-utils.js';
import { mapAlchemyTransaction } from './alchemy.mapper-utils.js';
import type { AlchemyAssetTransfer, AlchemyAssetTransferParams, AlchemyTransactionReceipt } from './alchemy.schemas.js';
import {
  AlchemyAssetTransfersJsonRpcResponseSchema,
  AlchemyPortfolioBalanceResponseSchema,
  AlchemyTransactionReceiptResponseSchema,
} from './alchemy.schemas.js';

@RegisterApiClient({
  apiKeyEnvVar: 'ALCHEMY_API_KEY',
  baseUrl: 'https://eth-mainnet.g.alchemy.com/v2', // Default for Ethereum
  blockchain: 'ethereum',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressInfo'],
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
})
export class AlchemyApiClient extends BaseApiClient {
  private readonly chainConfig: EvmChainConfig;
  private portfolioClient: HttpClient;

  constructor(config: ProviderConfig) {
    super(config);

    // Get EVM chain config for native currency
    const evmChainConfig = getEvmChainConfig(config.blockchain);
    if (!evmChainConfig) {
      throw new Error(`Unsupported blockchain for Alchemy provider: ${config.blockchain}`);
    }
    this.chainConfig = evmChainConfig;

    // Create separate HTTP client for Portfolio API
    this.portfolioClient = new HttpClient({
      baseUrl: `https://api.g.alchemy.com/data/v1/${this.apiKey}`,
      providerName: `${this.metadata.name}-portfolio`,
      rateLimit: config.rateLimit,
      retries: config.retries,
      timeout: config.timeout,
    });
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
    this.logger.debug(`Executing operation: ${operation.type}`);

    switch (operation.type) {
      case 'getAddressInfo': {
        const { address } = operation;
        this.logger.debug(`Fetching address info - Address: ${maskAddress(address)}`);
        return (await this.getAddressInfo(address)) as Result<T, Error>;
      }
      case 'getAddressBalances': {
        const { address } = operation;
        this.logger.debug(`Fetching native balance - Address: ${maskAddress(address)}`);
        return (await this.getAddressBalances(address)) as Result<T, Error>;
      }
      case 'getAddressTokenBalances': {
        const { address, contractAddresses } = operation;
        this.logger.debug(`Fetching token balances - Address: ${maskAddress(address)}`);
        return (await this.getAddressTokenBalances(address, contractAddresses)) as Result<T, Error>;
      }
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
    const transactionType = operation.transactionType || 'normal';
    switch (transactionType) {
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
        yield err(new Error(`Unsupported transaction type: ${transactionType}`));
    }
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

  /**
   * Fetches transaction receipts for multiple transaction hashes in parallel.
   * Deduplicates hashes and returns a Map for efficient lookup.
   * FAILS if any receipt cannot be fetched - gas fees are critical for reporting.
   */
  private async getTransactionReceipts(
    txHashes: string[]
  ): Promise<Result<Map<string, AlchemyTransactionReceipt>, Error>> {
    const uniqueHashes = deduplicateTransactionHashes(txHashes);

    if (uniqueHashes.length === 0) {
      return ok(new Map());
    }

    this.logger.debug(`Fetching ${uniqueHashes.length} transaction receipts`);

    // Fetch all receipts in parallel
    const receiptPromises = uniqueHashes.map(async (hash) => {
      const result = await this.httpClient.post(
        `/${this.apiKey}`,
        {
          id: 1,
          jsonrpc: '2.0',
          method: 'eth_getTransactionReceipt',
          params: [hash],
        },
        { schema: AlchemyTransactionReceiptResponseSchema }
      );

      if (result.isErr()) {
        return { hash, error: result.error };
      }

      const receipt = result.value.result;
      if (!receipt) {
        return { hash, error: new Error(`No receipt found for transaction ${hash}`) };
      }

      return { hash, receipt, error: undefined };
    });

    const results = await Promise.all(receiptPromises);

    // Check for any failures - gas fees are critical, we must have complete data
    const failures = results.filter((r) => r.error);
    if (failures.length > 0) {
      const errorMessages = failures.map((f) => `${f.hash}: ${getErrorMessage(f.error!)}`).join('; ');
      this.logger.error(`Failed to fetch ${failures.length}/${uniqueHashes.length} receipts: ${errorMessages}`);
      return err(new Error(`Failed to fetch transaction receipts (gas fees required): ${errorMessages}`));
    }

    // Build Map of hash -> receipt
    const receiptMap = new Map<string, AlchemyTransactionReceipt>();
    for (const result of results) {
      if (result.receipt) {
        receiptMap.set(result.hash, result.receipt);
      }
    }

    this.logger.debug(`Successfully fetched all ${receiptMap.size} receipts`);
    return ok(receiptMap);
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

  private streamAddressTransactions(
    address: string,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<EvmTransaction>, Error>> {
    const baseParams: AlchemyAssetTransferParams = {
      category: ['external'],
      excludeZeroValue: false,
      fromBlock: '0x0',
      maxCount: '0x3e8', // 1000 in hex
      toBlock: 'latest',
      withMetadata: true,
    };

    const fetchPage = async (
      ctx: StreamingPageContext
    ): Promise<Result<StreamingPage<AlchemyAssetTransfer>, Error>> => {
      // Determine if we're fetching FROM or TO transfers based on pageToken
      // For simplicity, we'll fetch both FROM and TO in separate iterations
      // This is a limitation of Alchemy's API design
      const fromParams: AlchemyAssetTransferParams = {
        ...baseParams,
        fromAddress: address,
      };
      const toParams: AlchemyAssetTransferParams = {
        ...baseParams,
        toAddress: address,
      };

      const { from: fromPageKey, to: toPageKey } = this.parseDualPageToken(ctx.pageToken);
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
          `Failed to fetch FROM asset transfers for ${maskAddress(address)} - Error: ${getErrorMessage(fromResult.error)}`
        );
        return err(fromResult.error);
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
          `Failed to fetch TO asset transfers for ${maskAddress(address)} - Error: ${getErrorMessage(toResult.error)}`
        );
        return err(toResult.error);
      }

      const fromTransfers = fromResult.value.result?.transfers || [];
      const toTransfers = toResult.value.result?.transfers || [];
      const allTransfers = [...fromTransfers, ...toTransfers];

      const nextFromKey = fromResult.value.result?.pageKey || undefined;
      const nextToKey = toResult.value.result?.pageKey || undefined;
      const nextPageToken = this.buildDualPageToken(nextFromKey, nextToKey);

      return ok({
        items: allTransfers,
        nextPageToken,
        isComplete: !nextFromKey && !nextToKey,
      });
    };

    return createStreamingIterator<AlchemyAssetTransfer, EvmTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapAlchemyTransaction(raw);
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
    const baseParams: AlchemyAssetTransferParams = {
      category: ['internal'],
      excludeZeroValue: false,
      fromBlock: '0x0',
      maxCount: '0x3e8', // 1000 in hex
      toBlock: 'latest',
      withMetadata: true,
    };

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

      const { from: fromPageKey, to: toPageKey } = this.parseDualPageToken(ctx.pageToken);
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
          `Failed to fetch FROM internal transfers for ${maskAddress(address)} - Error: ${getErrorMessage(fromResult.error)}`
        );
        return err(fromResult.error);
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
          `Failed to fetch TO internal transfers for ${maskAddress(address)} - Error: ${getErrorMessage(toResult.error)}`
        );
        return err(toResult.error);
      }

      const fromTransfers = fromResult.value.result?.transfers || [];
      const toTransfers = toResult.value.result?.transfers || [];
      const allTransfers = [...fromTransfers, ...toTransfers];

      const nextFromKey = fromResult.value.result?.pageKey || undefined;
      const nextToKey = toResult.value.result?.pageKey || undefined;
      const nextPageToken = this.buildDualPageToken(nextFromKey, nextToKey);

      return ok({
        items: allTransfers,
        nextPageToken,
        isComplete: !nextFromKey && !nextToKey,
      });
    };

    return createStreamingIterator<AlchemyAssetTransfer, EvmTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address, transactionType: 'internal' },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapAlchemyTransaction(raw);
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
    const baseParams: AlchemyAssetTransferParams = {
      category: ['erc20', 'erc721', 'erc1155'],
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

      const { from: fromPageKey, to: toPageKey } = this.parseDualPageToken(ctx.pageToken);
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
          `Failed to fetch FROM token transfers for ${maskAddress(address)} - Error: ${getErrorMessage(fromResult.error)}`
        );
        return err(fromResult.error);
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
          `Failed to fetch TO token transfers for ${maskAddress(address)} - Error: ${getErrorMessage(toResult.error)}`
        );
        return err(toResult.error);
      }

      const fromTransfers = fromResult.value.result?.transfers || [];
      const toTransfers = toResult.value.result?.transfers || [];
      const allTransfers = [...fromTransfers, ...toTransfers];

      const nextFromKey = fromResult.value.result?.pageKey || undefined;
      const nextToKey = toResult.value.result?.pageKey || undefined;
      const nextPageToken = this.buildDualPageToken(nextFromKey, nextToKey);

      return ok({
        items: allTransfers,
        nextPageToken,
        isComplete: !nextFromKey && !nextToKey,
      });
    };

    return createStreamingIterator<AlchemyAssetTransfer, EvmTransaction>({
      providerName: this.name,
      operation: { type: 'getAddressTransactions', address, transactionType: 'token', contractAddress },
      resumeCursor,
      fetchPage,
      mapItem: (raw) => {
        const mapped = mapAlchemyTransaction(raw);
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

  /**
   * Decode combined pageToken used to track independent FROM/TO pagination.
   * Supports both the JSON-encoded format introduced for streaming and the
   * legacy single-token format (treated as FROM-only).
   */
  private parseDualPageToken(token?: string): { from?: string; to?: string } {
    if (!token) return {};

    try {
      const parsed = JSON.parse(token) as { from?: string | null; to?: string | null };
      const result: { from?: string; to?: string } = {};
      if (parsed.from) result.from = parsed.from;
      if (parsed.to) result.to = parsed.to;
      return result;
    } catch {
      const parts = token.split(':::');
      if (parts.length === 2) {
        const result: { from?: string; to?: string } = {};
        if (parts[0]) result.from = parts[0];
        if (parts[1]) result.to = parts[1];
        return result;
      }
      return { from: token };
    }
  }

  /**
   * Encode FROM/TO pageKeys into a single pageToken string for the adapter.
   * Returns undefined when both directions are exhausted.
   */
  private buildDualPageToken(fromKey?: string | null, toKey?: string | null): string | undefined {
    if (!fromKey && !toKey) return undefined;
    return JSON.stringify({ from: fromKey ?? undefined, to: toKey ?? undefined });
  }
}
