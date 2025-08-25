import { maskAddress } from '@crypto/shared-utils';

import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.ts';
import { RegisterProvider } from '../../shared/registry/decorators.ts';
import type { ProviderOperation } from '../../shared/types.ts';
import type {
  AlchemyAssetTransfer,
  AlchemyAssetTransferParams,
  AlchemyAssetTransfersResponse,
  AlchemyTokenBalance,
  AlchemyTokenBalancesResponse,
  EtherscanBalance,
  JsonRpcResponse,
} from '../types.ts';

@RegisterProvider({
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

  private async getAssetTransfers(
    address: string,
    since?: number,
    category: string[] = ['external', 'internal', 'erc20', 'erc721', 'erc1155'],
    contractAddress?: string
  ): Promise<AlchemyAssetTransfer[]> {
    const params: AlchemyAssetTransferParams = {
      category,
      excludeZeroValue: false,
      fromAddress: address,
      maxCount: '0x3e8', // 1000 in hex
      toAddress: address,
      withMetadata: true,
    };

    if (contractAddress) {
      params.contractAddresses = [contractAddress];
    }

    // Get transfers from address
    const fromResponse = await this.httpClient.post<JsonRpcResponse<AlchemyAssetTransfersResponse>>(`/${this.apiKey}`, {
      id: 1,
      jsonrpc: '2.0',
      method: 'alchemy_getAssetTransfers',
      params: [params],
    });

    // Get transfers to address
    const toParams = { ...params };
    delete toParams.fromAddress;
    toParams.toAddress = address;
    const toResponse = await this.httpClient.post<JsonRpcResponse<AlchemyAssetTransfersResponse>>(`/${this.apiKey}`, {
      id: 1,
      jsonrpc: '2.0',
      method: 'alchemy_getAssetTransfers',
      params: [toParams],
    });

    const allTransfers = [...(fromResponse.result?.transfers || []), ...(toResponse.result?.transfers || [])];

    // Remove duplicates based on hash + category
    const uniqueTransfers = allTransfers.filter(
      (transfer, index, array) =>
        array.findIndex(t => t.hash === transfer.hash && t.category === transfer.category) === index
    );

    return uniqueTransfers;
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
}
