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

import { getErrorMessage } from '@exitbook/core';
import { HttpClient } from '@exitbook/platform-http';
import { err, ok, type Result } from 'neverthrow';

import type { ProviderConfig } from '../../../../shared/blockchain/index.js';
import { BaseApiClient, RegisterApiClient } from '../../../../shared/blockchain/index.js';
import type {
  ProviderOperation,
  JsonRpcResponse,
  RawBalanceData,
  TransactionWithRawData,
} from '../../../../shared/blockchain/types/index.js';
import { maskAddress } from '../../../../shared/blockchain/utils/address-utils.js';
import { isNativeToken } from '../../balance-utils.js';
import type { EvmChainConfig } from '../../chain-config.interface.js';
import { getEvmChainConfig } from '../../chain-registry.js';
import { deduplicateTransactionHashes, mergeReceiptsIntoTransfers } from '../../receipt-utils.js';
import type { EvmTransaction } from '../../types.js';

import { extractAlchemyNetworkName } from './alchemy.mapper-utils.js';
import { mapAlchemyTransaction } from './alchemy.mapper-utils.js';
import type {
  AlchemyAssetTransfer,
  AlchemyAssetTransferParams,
  AlchemyAssetTransfersResponse,
  AlchemyTransactionReceipt,
} from './alchemy.schemas.js';
import { AlchemyPortfolioBalanceResponseSchema, AlchemyTransactionReceiptSchema } from './alchemy.schemas.js';

@RegisterApiClient({
  apiKeyEnvVar: 'ALCHEMY_API_KEY',
  baseUrl: 'https://eth-mainnet.g.alchemy.com/v2', // Default for Ethereum
  blockchain: 'ethereum',
  capabilities: {
    supportedOperations: [
      'getAddressTransactions',
      'getAddressInternalTransactions',
      'getAddressTokenTransactions',
      'getAddressBalances',
      'getAddressTokenBalances',
    ],
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

  async execute<T>(operation: ProviderOperation): Promise<Result<T, Error>> {
    this.logger.debug(`Executing operation: ${operation.type}`);

    switch (operation.type) {
      case 'getAddressTransactions': {
        const { address } = operation;
        this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);
        return (await this.getAddressTransactions(address)) as Result<T, Error>;
      }
      case 'getAddressInternalTransactions': {
        const { address } = operation;
        this.logger.debug(`Fetching raw address internal transactions - Address: ${maskAddress(address)}`);
        return (await this.getAddressInternalTransactions(address)) as Result<T, Error>;
      }
      case 'getAddressTokenTransactions': {
        const { address, contractAddress } = operation;
        this.logger.debug(
          `Fetching token transactions - Address: ${maskAddress(address)}, Contract: ${contractAddress || 'all'}`
        );
        return (await this.getAddressTokenTransactions(address, contractAddress)) as Result<T, Error>;
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

  private async getAssetTransfers(
    address: string,
    category: string[] = ['external', 'internal', 'erc20', 'erc721', 'erc1155'],
    contractAddress?: string
  ): Promise<Result<AlchemyAssetTransfer[], Error>> {
    const allTransfers: AlchemyAssetTransfer[] = [];

    // Get transfers FROM address (outgoing transactions)
    const fromParams: AlchemyAssetTransferParams = {
      category,
      excludeZeroValue: false,
      fromAddress: address,
      fromBlock: '0x0', // Explicit fromBlock for complete historical data
      maxCount: '0x3e8', // 1000 in hex
      toBlock: 'latest', // Explicit toBlock for latest data
      withMetadata: true,
    };
    if (contractAddress) {
      fromParams.contractAddresses = [contractAddress];
    }
    const fromTransfersResult = await this.getAssetTransfersPaginated(fromParams);

    if (fromTransfersResult.isErr()) {
      return err(fromTransfersResult.error);
    }

    // Get transfers TO address (incoming transactions)
    const toParams: AlchemyAssetTransferParams = {
      category,
      excludeZeroValue: false,
      fromBlock: '0x0', // Explicit fromBlock for complete historical data
      maxCount: '0x3e8', // 1000 in hex
      toAddress: address,
      toBlock: 'latest', // Explicit toBlock for latest data
      withMetadata: true,
    };
    if (contractAddress) {
      toParams.contractAddresses = [contractAddress];
    }
    const toTransfersResult = await this.getAssetTransfersPaginated(toParams);

    if (toTransfersResult.isErr()) {
      return err(toTransfersResult.error);
    }

    allTransfers.push(...fromTransfersResult.value, ...toTransfersResult.value);

    return ok(allTransfers);
  }

  private async getAssetTransfersPaginated(
    params: AlchemyAssetTransferParams
  ): Promise<Result<AlchemyAssetTransfer[], Error>> {
    const transfers: AlchemyAssetTransfer[] = [];
    let pageKey: string | undefined;
    let pageCount = 0;
    const maxPages = 10; // Safety limit to prevent infinite loops

    do {
      const requestParams: AlchemyAssetTransferParams = { ...params };
      if (pageKey) {
        requestParams.pageKey = pageKey;
      }

      const result = await this.httpClient.post<JsonRpcResponse<AlchemyAssetTransfersResponse>>(`/${this.apiKey}`, {
        id: 1,
        jsonrpc: '2.0',
        method: 'alchemy_getAssetTransfers',
        params: [requestParams],
      });

      if (result.isErr()) {
        this.logger.error(`Failed to fetch asset transfers - Error: ${getErrorMessage(result.error)}`);
        return err(result.error);
      }

      const response = result.value;
      const responseTransfers = response.result?.transfers || [];
      transfers.push(...responseTransfers);

      pageKey = response.result?.pageKey;
      pageCount++;

      this.logger.debug(
        `Fetched page ${pageCount}: ${responseTransfers.length} transfers${pageKey ? ' (more pages available)' : ' (last page)'}`
      );

      // Safety check to prevent infinite pagination
      if (pageCount >= maxPages) {
        this.logger.warn(`Reached maximum page limit (${maxPages}), stopping pagination`);
        break;
      }
    } while (pageKey);

    return ok(transfers);
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
      const result = await this.httpClient.post<JsonRpcResponse<AlchemyTransactionReceipt | null>>(`/${this.apiKey}`, {
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_getTransactionReceipt',
        params: [hash],
      });

      if (result.isErr()) {
        return { hash, error: result.error };
      }

      const receipt = result.value.result;
      if (!receipt) {
        return { hash, error: new Error(`No receipt found for transaction ${hash}`) };
      }

      // Validate receipt with Zod schema
      const parseResult = AlchemyTransactionReceiptSchema.safeParse(receipt);
      if (!parseResult.success) {
        return { hash, error: new Error(`Invalid receipt for ${hash}: ${parseResult.error.message}`) };
      }

      return { hash, receipt: parseResult.data, error: undefined };
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

  private async getAddressInternalTransactions(
    address: string
  ): Promise<Result<TransactionWithRawData<EvmTransaction>[], Error>> {
    const result = await this.getAssetTransfers(address, ['internal']);

    if (result.isErr()) {
      this.logger.error(
        `Failed to fetch raw internal transactions for ${address} - Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const rawTransactions = result.value;

    if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
      this.logger.debug(`No raw internal transactions found - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    // Fetch transaction receipts for gas fee data (REQUIRED for accurate reporting)
    const txHashes = rawTransactions.map((tx) => tx.hash);
    const receiptsResult = await this.getTransactionReceipts(txHashes);

    if (receiptsResult.isErr()) {
      this.logger.error(`Failed to fetch receipts - ${getErrorMessage(receiptsResult.error)}`);
      return err(receiptsResult.error);
    }

    // Merge receipt data into transfers
    mergeReceiptsIntoTransfers(rawTransactions, receiptsResult.value, this.chainConfig.nativeCurrency);

    const transactions: TransactionWithRawData<EvmTransaction>[] = [];
    for (const rawTx of rawTransactions) {
      const mapResult = mapAlchemyTransaction(rawTx, {});

      if (mapResult.isErr()) {
        const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
        this.logger.error(`Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`);
        return err(new Error(`Provider data validation failed: ${errorMessage}`));
      }

      transactions.push({
        raw: rawTx,
        normalized: mapResult.value,
      });
    }

    this.logger.debug(
      `Successfully retrieved and normalized internal transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}`
    );
    return ok(transactions);
  }

  private async getAddressTransactions(
    address: string
  ): Promise<Result<TransactionWithRawData<EvmTransaction>[], Error>> {
    const result = await this.getAssetTransfers(address, ['external']);

    if (result.isErr()) {
      this.logger.error(
        `Failed to fetch raw address transactions for ${address} - Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const rawTransactions = result.value;

    if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
      this.logger.debug(`No raw transactions found - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    // Fetch transaction receipts for gas fee data (REQUIRED for accurate reporting)
    const txHashes = rawTransactions.map((tx) => tx.hash);
    const receiptsResult = await this.getTransactionReceipts(txHashes);

    if (receiptsResult.isErr()) {
      this.logger.error(`Failed to fetch receipts - ${getErrorMessage(receiptsResult.error)}`);
      return err(receiptsResult.error);
    }

    // Merge receipt data into transfers
    mergeReceiptsIntoTransfers(rawTransactions, receiptsResult.value, this.chainConfig.nativeCurrency);

    const transactions: TransactionWithRawData<EvmTransaction>[] = [];
    for (const rawTx of rawTransactions) {
      const mapResult = mapAlchemyTransaction(rawTx, {});

      if (mapResult.isErr()) {
        const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
        this.logger.error(`Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`);
        return err(new Error(`Provider data validation failed: ${errorMessage}`));
      }

      transactions.push({
        raw: rawTx,
        normalized: mapResult.value,
      });
    }

    this.logger.debug(
      `Successfully retrieved and normalized transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}`
    );
    return ok(transactions);
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

    const result = await this.portfolioClient.post<unknown>('/assets/tokens/balances/by-address', requestBody);

    if (result.isErr()) {
      this.logger.error(`Failed to fetch native balance for ${address} - Error: ${getErrorMessage(result.error)}`);
      return err(result.error);
    }

    // Validate response with Zod schema
    const parseResult = AlchemyPortfolioBalanceResponseSchema.safeParse(result.value);
    if (!parseResult.success) {
      this.logger.error(`Invalid Portfolio API response: ${parseResult.error.message}`);
      return err(new Error(`Invalid Portfolio API response: ${parseResult.error.message}`));
    }

    const tokenBalances = parseResult.data.data.tokens;

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

    const result = await this.portfolioClient.post<unknown>('/assets/tokens/balances/by-address', requestBody);

    if (result.isErr()) {
      this.logger.error(`Failed to fetch token balances for ${address} - Error: ${getErrorMessage(result.error)}`);
      return err(result.error);
    }

    // Validate response with Zod schema
    const parseResult = AlchemyPortfolioBalanceResponseSchema.safeParse(result.value);
    if (!parseResult.success) {
      this.logger.error(`Invalid Portfolio API response: ${parseResult.error.message}`);
      return err(new Error(`Invalid Portfolio API response: ${parseResult.error.message}`));
    }

    const tokenBalances = parseResult.data.data.tokens;

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

  private async getAddressTokenTransactions(
    address: string,
    contractAddress?: string
  ): Promise<Result<TransactionWithRawData<EvmTransaction>[], Error>> {
    const result = await this.getAssetTransfers(address, ['erc20', 'erc721', 'erc1155'], contractAddress);

    if (result.isErr()) {
      this.logger.error(
        `Failed to fetch raw token transactions for ${address} - Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const rawTransactions = result.value;

    if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
      this.logger.debug(`No raw token transactions found - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    // Fetch transaction receipts for gas fee data (REQUIRED for accurate reporting)
    const txHashes = rawTransactions.map((tx) => tx.hash);
    const receiptsResult = await this.getTransactionReceipts(txHashes);

    if (receiptsResult.isErr()) {
      this.logger.error(`Failed to fetch receipts - ${getErrorMessage(receiptsResult.error)}`);
      return err(receiptsResult.error);
    }

    // Merge receipt data into transfers
    mergeReceiptsIntoTransfers(rawTransactions, receiptsResult.value, this.chainConfig.nativeCurrency);

    const transactions: TransactionWithRawData<EvmTransaction>[] = [];
    for (const rawTx of rawTransactions) {
      const mapResult = mapAlchemyTransaction(rawTx, {});

      if (mapResult.isErr()) {
        const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
        this.logger.error(`Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`);
        return err(new Error(`Provider data validation failed: ${errorMessage}`));
      }

      transactions.push({
        raw: rawTx,
        normalized: mapResult.value,
      });
    }

    this.logger.debug(
      `Successfully retrieved and normalized token transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}`
    );
    return ok(transactions);
  }
}
