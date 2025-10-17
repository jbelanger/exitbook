import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { ProviderConfig } from '../../../../core/blockchain/index.ts';
import { BaseApiClient, RegisterApiClient } from '../../../../core/blockchain/index.ts';
import type {
  ProviderOperation,
  JsonRpcResponse,
  TransactionWithRawData,
} from '../../../../core/blockchain/types/index.ts';
import { maskAddress } from '../../../../core/blockchain/utils/address-utils.ts';
import type { EvmTransaction } from '../../types.ts';

import { AlchemyTransactionMapper } from './alchemy.mapper.ts';
import type {
  AlchemyAssetTransfer,
  AlchemyAssetTransferParams,
  AlchemyAssetTransfersResponse,
  AlchemyTokenBalance,
  AlchemyTokenBalancesResponse,
} from './alchemy.types.ts';

@RegisterApiClient({
  apiKeyEnvVar: 'ALCHEMY_API_KEY',
  baseUrl: 'https://eth-mainnet.g.alchemy.com/v2', // Default for Ethereum
  blockchain: 'ethereum',
  capabilities: {
    supportedOperations: [
      'getAddressTransactions',
      'getAddressInternalTransactions',
      'getAddressTokenTransactions',
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
  private mapper: AlchemyTransactionMapper;

  constructor(config: ProviderConfig) {
    super(config);
    this.mapper = new AlchemyTransactionMapper();
  }

  async execute<T>(operation: ProviderOperation): Promise<Result<T, Error>> {
    this.logger.debug(`Executing operation: ${operation.type}`);

    switch (operation.type) {
      case 'getAddressTransactions': {
        const { address, since } = operation;
        this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);
        return (await this.getAddressTransactions(address, since)) as Result<T, Error>;
      }
      case 'getAddressInternalTransactions': {
        const { address, since } = operation;
        this.logger.debug(`Fetching raw address internal transactions - Address: ${maskAddress(address)}`);
        return (await this.getAddressInternalTransactions(address, since)) as Result<T, Error>;
      }
      case 'getAddressTokenTransactions': {
        const { address, contractAddress, since } = operation;
        this.logger.debug(
          `Fetching token transactions - Address: ${maskAddress(address)}, Contract: ${contractAddress || 'all'}`
        );
        return (await this.getAddressTokenTransactions(address, contractAddress, since)) as Result<T, Error>;
      }
      case 'getAddressTokenBalances': {
        const { address, contractAddresses } = operation;
        this.logger.debug(`Fetching raw token balances - Address: ${maskAddress(address)}`);
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

  private async getAssetTransfers(
    address: string,
    since?: number,
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

  private async getAddressInternalTransactions(
    address: string,
    since?: number
  ): Promise<Result<TransactionWithRawData<EvmTransaction>[], Error>> {
    const result = await this.getAssetTransfers(address, since, ['internal']);

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

    const transactions: TransactionWithRawData<EvmTransaction>[] = [];
    for (const rawTx of rawTransactions) {
      const mapResult = this.mapper.map(rawTx, { providerId: 'alchemy', sourceAddress: address }, {});

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
    address: string,
    since?: number
  ): Promise<Result<TransactionWithRawData<EvmTransaction>[], Error>> {
    const result = await this.getAssetTransfers(address, since, ['external']);

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

    const transactions: TransactionWithRawData<EvmTransaction>[] = [];
    for (const rawTx of rawTransactions) {
      const mapResult = this.mapper.map(rawTx, { providerId: 'alchemy', sourceAddress: address }, {});

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

  private async getAddressTokenBalances(
    address: string,
    contractAddresses?: string[]
  ): Promise<Result<AlchemyTokenBalance[], Error>> {
    const result = await this.httpClient.post<JsonRpcResponse<AlchemyTokenBalancesResponse>>(`/${this.apiKey}`, {
      id: 1,
      jsonrpc: '2.0',
      method: 'alchemy_getAddressTokenBalances',
      params: [address, contractAddresses || 'DEFAULT_TOKENS'],
    });

    if (result.isErr()) {
      this.logger.error(`Failed to fetch raw token balances for ${address} - Error: ${getErrorMessage(result.error)}`);
      return err(result.error);
    }

    const response = result.value;
    const tokenBalances = response.result?.tokenBalances || [];
    this.logger.debug(`Found ${tokenBalances.length} raw token balances for ${address}`);
    return ok(tokenBalances);
  }

  private async getAddressTokenTransactions(
    address: string,
    contractAddress?: string,
    since?: number
  ): Promise<Result<TransactionWithRawData<EvmTransaction>[], Error>> {
    const result = await this.getAssetTransfers(address, since, ['erc20', 'erc721', 'erc1155'], contractAddress);

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

    const transactions: TransactionWithRawData<EvmTransaction>[] = [];
    for (const rawTx of rawTransactions) {
      const mapResult = this.mapper.map(rawTx, { providerId: 'alchemy', sourceAddress: address }, {});

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
