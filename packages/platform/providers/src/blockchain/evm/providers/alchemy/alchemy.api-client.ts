import { getErrorMessage } from '@exitbook/core';

import type { ProviderConfig } from '../../../../core/blockchain/index.ts';
import { BaseApiClient, RegisterApiClient } from '../../../../core/blockchain/index.ts';
import type { ProviderOperation, JsonRpcResponse } from '../../../../core/blockchain/types/index.ts';
import { maskAddress } from '../../../../core/blockchain/utils/address-utils.ts';

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
      'getRawAddressTransactions',
      'getRawAddressInternalTransactions',
      'getTokenTransactions',
      'getRawTokenBalances',
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
    avalanche: { baseUrl: 'https://avax-mainnet.g.alchemy.com/v2' },
    ethereum: { baseUrl: 'https://eth-mainnet.g.alchemy.com/v2' },
    polygon: { baseUrl: 'https://polygon-mainnet.g.alchemy.com/v2' },
  },
})
export class AlchemyApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super(config);
  }

  async execute<T>(operation: ProviderOperation): Promise<T> {
    this.logger.debug(`Executing operation: ${operation.type}`);

    switch (operation.type) {
      case 'getRawAddressTransactions': {
        const { address, since } = operation;
        this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);
        return this.getRawAddressTransactions(address, since) as Promise<T>;
      }
      case 'getRawAddressInternalTransactions': {
        const { address, since } = operation;
        this.logger.debug(`Fetching raw address internal transactions - Address: ${maskAddress(address)}`);
        return this.getRawAddressInternalTransactions(address, since) as Promise<T>;
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

  private async getRawAddressInternalTransactions(address: string, since?: number): Promise<AlchemyAssetTransfer[]> {
    try {
      const transfers = await this.getAssetTransfers(address, since, ['internal']);
      this.logger.debug(`Found ${transfers.length} raw internal transactions for ${address}`);
      return transfers;
    } catch (error) {
      this.logger.error(`Failed to fetch raw internal transactions for ${address} - Error: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  private async getRawAddressTransactions(address: string, since?: number): Promise<AlchemyAssetTransfer[]> {
    try {
      const transfers = await this.getAssetTransfers(address, since, ['external']);
      this.logger.debug(`Found ${transfers.length} raw address transactions for ${address}`);
      return transfers;
    } catch (error) {
      this.logger.error(`Failed to fetch raw address transactions for ${address} - Error: ${getErrorMessage(error)}`);
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
      this.logger.error(`Failed to fetch raw token balances for ${address} - Error: ${getErrorMessage(error)}`);
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
      this.logger.error(`Failed to fetch raw token transactions for ${address} - Error: ${getErrorMessage(error)}`);
      throw error;
    }
  }
}
