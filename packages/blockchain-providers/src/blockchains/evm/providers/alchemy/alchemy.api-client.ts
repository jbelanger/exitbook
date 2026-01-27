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
  OneShotOperation,
  StreamingOperation,
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
  AlchemyTokenMetadataSchema,
  AlchemyTransactionReceiptResponseSchema,
} from './alchemy.schemas.js';

@RegisterApiClient({
  apiKeyEnvVar: 'ALCHEMY_API_KEY',
  baseUrl: 'https://eth-mainnet.g.alchemy.com/v2', // Default for Ethereum
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
})
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

  async execute<T>(operation: OneShotOperation): Promise<Result<T, Error>> {
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
      case 'getTokenMetadata': {
        const { contractAddresses } = operation;
        this.logger.debug(`Fetching token metadata for ${contractAddresses.length} contracts`);
        return (await this.getTokenMetadata(contractAddresses)) as Result<T, Error>;
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
   * Deduplicates asset transfers by hash, uniqueId, and category.
   * This is important for dual pagination (FROM/TO) where the same transfer may appear in both result sets.
   *
   * When uniqueId is present, it uniquely identifies the transfer (contains log index).
   * When uniqueId is missing (can happen for external/internal transfers), we include additional
   * discriminators (from/to/value/contract/tokenId) to prevent collapsing distinct transfers
   * from the same transaction into one record (which would be silent data loss).
   *
   * @param transfers - Array of transfers that may contain duplicates
   * @returns Deduplicated array of transfers
   */
  private deduplicateRawTransfers(transfers: AlchemyAssetTransfer[]): AlchemyAssetTransfer[] {
    const seen = new Set<string>();
    const deduplicated: AlchemyAssetTransfer[] = [];

    for (const transfer of transfers) {
      let key: string;

      if (transfer.uniqueId) {
        // uniqueId contains the log index which makes each transfer unique
        key = `${transfer.hash}:${transfer.uniqueId}:${transfer.category}`;
      } else {
        // When uniqueId is missing, include more discriminators to prevent data loss
        // This can happen for external/internal transfers where multiple distinct transfers
        // occur in the same transaction
        const contractAddr = transfer.rawContract?.address ?? '';
        const contractValue = transfer.rawContract?.value ?? '';
        const tokenId = transfer.tokenId ?? '';
        key = `${transfer.hash}:${transfer.category}:${transfer.from ?? ''}:${transfer.to ?? ''}:${contractValue}:${contractAddr}:${tokenId}`;

        this.logger.debug(
          `Using extended dedup key for transfer without uniqueId - Hash: ${transfer.hash}, Category: ${transfer.category}`
        );
      }

      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(transfer);
      }
    }

    const duplicateCount = transfers.length - deduplicated.length;
    if (duplicateCount > 0) {
      this.logger.debug(`Deduplicated ${duplicateCount} raw transfers from dual pagination`);
    }

    return deduplicated;
  }

  /**
   * Enriches asset transfers with gas fee data from transaction receipts.
   * Fetches receipts in parallel and adds _gasUsed, _effectiveGasPrice, and _nativeCurrency to each transfer.
   *
   * Note: This mutates the input array for performance. If any receipt is missing,
   * we fail the batch to trigger provider failover rather than silently dropping fees.
   */
  private async enrichTransfersWithGasFees(transfers: AlchemyAssetTransfer[]): Promise<Result<void, Error>> {
    if (transfers.length === 0) {
      return ok(undefined);
    }

    // Extract unique transaction hashes
    const uniqueHashes = deduplicateTransactionHashes(transfers.map((t) => t.hash));

    if (uniqueHashes.length === 0) {
      return ok(undefined);
    }

    this.logger.debug(`Fetching ${uniqueHashes.length} transaction receipts for gas fee enrichment`);

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
        return { hash, error: result.error, receipt: undefined };
      }

      // Check for JSON-RPC error
      if (result.value.error) {
        const error = result.value.error;
        return {
          hash,
          error: new Error(`JSON-RPC error: ${error.message}`),
          receipt: undefined,
        };
      }

      const receipt = result.value.result;
      if (!receipt) {
        return { hash, error: new Error(`No receipt found`), receipt: undefined };
      }

      return { hash, receipt, error: undefined };
    });

    const results = await Promise.all(receiptPromises);

    // Build Map of hash -> receipt
    const receiptMap = new Map<string, AlchemyTransactionReceipt>();
    const failures: string[] = [];

    for (const result of results) {
      if (result.error) {
        failures.push(`${result.hash}: ${getErrorMessage(result.error)}`);
      } else if (result.receipt) {
        receiptMap.set(result.hash, result.receipt);
      }
    }

    if (failures.length > 0) {
      const message = `Missing ${failures.length}/${uniqueHashes.length} receipts. Errors: ${failures.join('; ')}`;
      this.logger.warn(message);
      return err(new Error(message));
    }

    this.logger.debug(`Successfully fetched all ${receiptMap.size} receipts`);

    // Enrich transfers with gas fee data
    for (const transfer of transfers) {
      const receipt = receiptMap.get(transfer.hash);
      if (receipt) {
        transfer._gasUsed = receipt.gasUsed;
        transfer._effectiveGasPrice = receipt.effectiveGasPrice ?? undefined;
        transfer._nativeCurrency = this.chainConfig.nativeCurrency;
      } else {
        return err(new Error(`Receipt missing for transaction ${transfer.hash}`));
      }
    }

    return ok(undefined);
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
          `Failed to fetch FROM external transfers for ${maskAddress(address)} - Error: ${getErrorMessage(fromResult.error)}`
        );
        return err(fromResult.error);
      }

      // Check for JSON-RPC error
      if (fromResult.value.error) {
        const error = fromResult.value.error;
        this.logger.error(`Alchemy JSON-RPC error (FROM external) - Code: ${error.code}, Message: ${error.message}`);
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
          `Failed to fetch TO external transfers for ${maskAddress(address)} - Error: ${getErrorMessage(toResult.error)}`
        );
        return err(toResult.error);
      }

      // Check for JSON-RPC error
      if (toResult.value.error) {
        const error = toResult.value.error;
        this.logger.error(`Alchemy JSON-RPC error (TO external) - Code: ${error.code}, Message: ${error.message}`);
        return err(new Error(`Alchemy API error: ${error.message}`));
      }

      const fromTransfers = fromResult.value.result?.transfers || [];
      const toTransfers = toResult.value.result?.transfers || [];
      const mergedTransfers = [...fromTransfers, ...toTransfers];

      // Deduplicate at raw level before mapping (important for self-transfers)
      const allTransfers = this.deduplicateRawTransfers(mergedTransfers);

      // Enrich with gas fees from receipts
      const enrichResult = await this.enrichTransfersWithGasFees(allTransfers);
      if (enrichResult.isErr()) {
        return err(enrichResult.error);
      }

      const nextFromKey = fromResult.value.result?.pageKey ?? undefined;
      const nextToKey = toResult.value.result?.pageKey ?? undefined;
      const nextPageToken = this.buildDualPageToken(nextFromKey, nextToKey);

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
      operation: { type: 'getAddressTransactions', address },
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

          // Return empty array to skip this transaction instead of failing entire stream
          return ok([]);
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

      // Check for JSON-RPC error
      if (fromResult.value.error) {
        const error = fromResult.value.error;
        this.logger.error(`Alchemy JSON-RPC error (FROM internal) - Code: ${error.code}, Message: ${error.message}`);
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
          `Failed to fetch TO internal transfers for ${maskAddress(address)} - Error: ${getErrorMessage(toResult.error)}`
        );
        return err(toResult.error);
      }

      // Check for JSON-RPC error
      if (toResult.value.error) {
        const error = toResult.value.error;
        this.logger.error(`Alchemy JSON-RPC error (TO internal) - Code: ${error.code}, Message: ${error.message}`);
        return err(new Error(`Alchemy API error: ${error.message}`));
      }

      const fromTransfers = fromResult.value.result?.transfers || [];
      const toTransfers = toResult.value.result?.transfers || [];
      const mergedTransfers = [...fromTransfers, ...toTransfers];

      // Deduplicate at raw level before mapping (important for self-transfers)
      const allTransfers = this.deduplicateRawTransfers(mergedTransfers);

      // Internal transactions don't pay gas themselves (parent tx does)
      // So we don't enrich with gas fees here

      const nextFromKey = fromResult.value.result?.pageKey ?? undefined;
      const nextToKey = toResult.value.result?.pageKey ?? undefined;
      const nextPageToken = this.buildDualPageToken(nextFromKey, nextToKey);

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
      operation: { type: 'getAddressTransactions', address, streamType: 'internal' },
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

          // Return empty array to skip this transaction instead of failing entire stream
          return ok([]);
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

      // Check for JSON-RPC error
      if (fromResult.value.error) {
        const error = fromResult.value.error;
        this.logger.error(`Alchemy JSON-RPC error (FROM token) - Code: ${error.code}, Message: ${error.message}`);
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
          `Failed to fetch TO token transfers for ${maskAddress(address)} - Error: ${getErrorMessage(toResult.error)}`
        );
        return err(toResult.error);
      }

      // Check for JSON-RPC error
      if (toResult.value.error) {
        const error = toResult.value.error;
        this.logger.error(`Alchemy JSON-RPC error (TO token) - Code: ${error.code}, Message: ${error.message}`);
        return err(new Error(`Alchemy API error: ${error.message}`));
      }

      const fromTransfers = fromResult.value.result?.transfers || [];
      const toTransfers = toResult.value.result?.transfers || [];
      const mergedTransfers = [...fromTransfers, ...toTransfers];

      // Deduplicate at raw level before mapping (important for self-transfers)
      const allTransfers = this.deduplicateRawTransfers(mergedTransfers);

      // Token transfers don't pay gas themselves (parent transaction does)
      // So we don't enrich with gas fees here

      const nextFromKey = fromResult.value.result?.pageKey ?? undefined;
      const nextToKey = toResult.value.result?.pageKey ?? undefined;
      const nextPageToken = this.buildDualPageToken(nextFromKey, nextToKey);

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
      operation: { type: 'getAddressTransactions', address, streamType: 'token', contractAddress },
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

          // Return empty array to skip this transaction instead of failing entire stream
          return ok([]);
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
