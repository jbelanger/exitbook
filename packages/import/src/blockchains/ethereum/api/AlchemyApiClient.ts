import { hasStringProperty, isErrorWithMessage, maskAddress } from '@crypto/shared-utils';

import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.js';
import { RegisterApiClient } from '../../shared/registry/decorators.js';
import type { ProviderOperation } from '../../shared/types.js';
import type {
  AlchemyAssetTransfer,
  AlchemyAssetTransferParams,
  AlchemyAssetTransfersResponse,
  AlchemyTokenBalance,
  AlchemyTokenBalancesResponse,
  EtherscanBalance,
  JsonRpcResponse,
} from '../types.js';

@RegisterApiClient({
  blockchain: 'ethereum',
  capabilities: {
    maxBatchSize: 100,
    supportedOperations: [
      'getRawAddressTransactions',
      'getRawAddressBalance',
      'getTokenTransactions',
      'getRawTokenBalances',
    ],
    supportsHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: true,
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
  description: 'Alchemy Ethereum API with enhanced features for transactions and token data',
  displayName: 'Alchemy',
  name: 'alchemy',
  networks: {
    mainnet: { baseUrl: 'https://eth-mainnet.g.alchemy.com/v2' },
  },
  requiresApiKey: true,
  type: 'rest',
})
export class AlchemyApiClient extends BaseRegistryProvider {
  constructor() {
    super('ethereum', 'alchemy', 'mainnet');

    this.logger.debug(
      `Initialized AlchemyApiClient from registry metadata - Network: ${this.network}, BaseUrl: ${this.baseUrl.replace(this.apiKey, 'HIDDEN')}`
    );
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(`Executing operation: ${operation.type}`);

    switch (operation.type) {
      case 'getRawAddressTransactions': {
        const { address, since } = operation;
        this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);
        return this.getRawAddressTransactions(address, since) as Promise<T>;
      }
      case 'getRawAddressBalance': {
        const { address } = operation;
        this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);
        return this.getRawAddressBalance(address) as Promise<T>;
      }
      case 'getTokenTransactions': {
        const { address, contractAddress, since } = operation;
        this.logger.debug(
          `Fetching token transactions - Address: ${maskAddress(address)}, Contract: ${contractAddress || 'all'}`
        );
        return this.getTokenTransactions(address, contractAddress, since) as Promise<T>;
      }
      case 'getRawTokenBalances': {
        const { address, contractAddresses } = operation;
        this.logger.debug(`Fetching raw token balances - Address: ${maskAddress(address)}`);
        return this.getRawTokenBalances(address, contractAddresses) as Promise<T>;
      }
      default:
        throw new Error(`Unsupported operation: ${operation.type}`);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.httpClient.post<JsonRpcResponse<string>>(`/${this.apiKey}`, {
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
      });
      return response && response.result !== undefined;
    } catch (error) {
      this.logger.warn(`Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async getAssetTransfers(
    address: string,
    since?: number,
    category: string[] = ['external', 'internal', 'erc20', 'erc721', 'erc1155'],
    contractAddress?: string
  ): Promise<AlchemyAssetTransfer[]> {
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
    const fromTransfers = await this.getAssetTransfersPaginated(fromParams);

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
    const toTransfers = await this.getAssetTransfersPaginated(toParams);

    allTransfers.push(...fromTransfers, ...toTransfers);

    // TEMPORARILY DISABLE deduplication
    this.logger.debug(
      `Total transfers WITHOUT deduplication: ${allTransfers.length} (from ${fromTransfers.length} outgoing + ${toTransfers.length} incoming)`
    );
    return allTransfers;
  }

  private async getAssetTransfersPaginated(params: AlchemyAssetTransferParams): Promise<AlchemyAssetTransfer[]> {
    const transfers: AlchemyAssetTransfer[] = [];
    let pageKey: string | undefined;
    let pageCount = 0;
    const maxPages = 10; // Safety limit to prevent infinite loops

    do {
      const requestParams: AlchemyAssetTransferParams = { ...params };
      if (pageKey) {
        requestParams.pageKey = pageKey;
      }

      const response = await this.httpClient.post<JsonRpcResponse<AlchemyAssetTransfersResponse>>(`/${this.apiKey}`, {
        id: 1,
        jsonrpc: '2.0',
        method: 'alchemy_getAssetTransfers',
        params: [requestParams],
      });

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

    return transfers;
  }

  private async getRawAddressBalance(address: string): Promise<EtherscanBalance[]> {
    try {
      const ethBalanceResponse = await this.httpClient.post<JsonRpcResponse<string>>(`/${this.apiKey}`, {
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
      });

      const balances: EtherscanBalance[] = [
        {
          account: address,
          balance: ethBalanceResponse.result,
        },
      ];

      this.logger.debug(`Found raw ETH balance for ${address}: ${ethBalanceResponse.result}`);
      return balances;
    } catch (error) {
      this.logger.error(
        `Failed to fetch raw address balance for ${address} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawAddressTransactions(address: string, since?: number): Promise<AlchemyAssetTransfer[]> {
    try {
      const transfers = await this.getAssetTransfers(address, since, ['external', 'internal']);
      this.logger.debug(`Found ${transfers.length} raw address transactions for ${address}`);
      return transfers;
    } catch (error) {
      this.logger.error(
        `Failed to fetch raw address transactions for ${address} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawTokenBalances(address: string, contractAddresses?: string[]): Promise<AlchemyTokenBalance[]> {
    try {
      const response = await this.httpClient.post<JsonRpcResponse<AlchemyTokenBalancesResponse>>(`/${this.apiKey}`, {
        id: 1,
        jsonrpc: '2.0',
        method: 'alchemy_getTokenBalances',
        params: [address, contractAddresses || 'DEFAULT_TOKENS'],
      });

      const tokenBalances = response.result?.tokenBalances || [];
      this.logger.debug(`Found ${tokenBalances.length} raw token balances for ${address}`);
      return tokenBalances;
    } catch (error) {
      this.logger.error(
        `Failed to fetch raw token balances for ${address} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getTokenTransactions(
    address: string,
    contractAddress?: string,
    since?: number
  ): Promise<AlchemyAssetTransfer[]> {
    try {
      const transfers = await this.getAssetTransfers(address, since, ['erc20', 'erc721', 'erc1155'], contractAddress);
      this.logger.debug(`Found ${transfers.length} raw token transactions for ${address}`);
      return transfers;
    } catch (error) {
      this.logger.error(
        `Failed to fetch raw token transactions for ${address} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}
