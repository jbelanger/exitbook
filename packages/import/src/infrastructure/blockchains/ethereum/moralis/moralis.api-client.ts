import { maskAddress } from '@exitbook/shared-utils';

import { BlockchainApiClient } from '../../shared/api/blockchain-api-client.ts';
import { RegisterApiClient } from '../../shared/registry/decorators.js';
import type { ProviderOperation } from '../../shared/types.js';

import type {
  MoralisNativeBalance,
  MoralisTransaction,
  MoralisTransactionResponse,
  MoralisTokenBalance,
  MoralisTokenTransfer,
  MoralisTokenTransferResponse,
} from './moralis.types.ts';

@RegisterApiClient({
  blockchain: 'ethereum',
  capabilities: {
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
      burstLimit: 5,
      requestsPerHour: 1000,
      requestsPerMinute: 120,
      requestsPerSecond: 2,
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Moralis Ethereum API with comprehensive Web3 data and multi-chain support',
  displayName: 'Moralis',
  name: 'moralis',
  networks: {
    mainnet: { baseUrl: 'https://deep-index.moralis.io/api/v2' },
  },
  requiresApiKey: true,
  type: 'rest',
})
export class MoralisApiClient extends BlockchainApiClient {
  protected override network: string;

  constructor() {
    super('ethereum', 'moralis', 'mainnet');
    this.network = 'eth'; // Moralis network identifier

    this.logger.debug(
      `Initialized MoralisApiClient from registry metadata - Network: ${this.network}, BaseUrl: ${this.baseUrl}`
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

  getHealthCheckConfig() {
    return {
      endpoint: '/dateToBlock?chain=eth&date=2023-01-01T00:00:00.000Z',
      validate: (response: unknown) => {
        const data = response as { block: number };
        return data && typeof data.block === 'number';
      },
    };
  }

  private async getRawAddressBalance(address: string): Promise<MoralisNativeBalance> {
    try {
      const params = new URLSearchParams({
        chain: this.network,
      });

      const endpoint = `/${address}/balance?${params.toString()}`;
      const response: MoralisNativeBalance = await this.httpClient.get(endpoint);

      this.logger.debug(`Found raw ETH balance for ${address}: ${response.balance}`);
      return response;
    } catch (error) {
      this.logger.error(
        `Failed to fetch raw address balance for ${address} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawAddressTransactions(address: string, since?: number): Promise<MoralisTransaction[]> {
    try {
      const params = new URLSearchParams({
        chain: this.network,
        limit: '100',
      });

      if (since) {
        const sinceDate = new Date(since).toISOString();
        params.append('from_date', sinceDate);
      }

      const endpoint = `/${address}?${params.toString()}`;
      const response = await this.httpClient.get<MoralisTransactionResponse>(endpoint);

      const transactions = response.result || [];
      this.logger.debug(`Found ${transactions.length} raw address transactions for ${address}`);
      return transactions;
    } catch (error) {
      this.logger.error(
        `Failed to fetch raw address transactions for ${address} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawTokenBalances(address: string, contractAddresses?: string[]): Promise<MoralisTokenBalance[]> {
    try {
      const params = new URLSearchParams({
        chain: this.network,
      });

      if (contractAddresses) {
        contractAddresses.forEach((contract) => {
          params.append('token_addresses[]', contract);
        });
      }

      const endpoint = `/${address}/erc20?${params.toString()}`;
      const response = await this.httpClient.get<MoralisTokenBalance[]>(endpoint);

      const balances = response || [];
      this.logger.debug(`Found ${balances.length} raw token balances for ${address}`);
      return balances;
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
  ): Promise<MoralisTokenTransfer[]> {
    try {
      const params = new URLSearchParams({
        chain: this.network,
        limit: '100',
      });

      if (since) {
        const sinceDate = new Date(since).toISOString();
        params.append('from_date', sinceDate);
      }

      if (contractAddress) {
        params.append('contract_addresses[]', contractAddress);
      }

      const endpoint = `/${address}/erc20/transfers?${params.toString()}`;
      const response = await this.httpClient.get<MoralisTokenTransferResponse>(endpoint);

      const transfers = response.result || [];
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
