import { HttpClient, maskAddress } from '@crypto/shared-utils';

import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.ts';
import { RegisterApiClient } from '../../shared/registry/decorators.ts';
import type { JsonRpcResponse } from '../../shared/types.ts';
import type { ProviderOperation } from '../../shared/types.ts';
import type {
  SubscanAccountResponse,
  SubscanTransfersResponse,
  SubstrateAccountInfo,
  SubstrateChainConfig,
  TaostatsBalanceResponse,
  TaostatsTransaction,
} from '../types.ts';
import { SUBSTRATE_CHAINS } from '../types.ts';
import { isValidSS58Address } from '../utils.ts';

@RegisterApiClient({
  blockchain: 'polkadot',
  capabilities: {
    maxBatchSize: 1,
    supportedOperations: ['getRawAddressTransactions', 'getRawAddressBalance'],
    supportsHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: false,
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 3,
      requestsPerHour: 500,
      requestsPerMinute: 30,
      requestsPerSecond: 1,
    },
    retries: 3,
    timeout: 10000,
  },
  description:
    'Multi-chain Substrate provider supporting Polkadot, Kusama, and Bittensor networks with explorer APIs and RPC fallback',
  displayName: 'Substrate Networks Provider',
  name: 'subscan',
  networks: {
    mainnet: {
      baseUrl: 'https://polkadot.api.subscan.io',
    },
    testnet: {
      baseUrl: 'https://westend.api.subscan.io',
    },
  },
  requiresApiKey: false,
  type: 'rest',
})
export class SubstrateApiClient extends BaseRegistryProvider {
  private readonly chainConfig: SubstrateChainConfig;
  private readonly rpcClient?: HttpClient;

  constructor() {
    super('polkadot', 'subscan', 'mainnet');

    // Initialize chain config for Polkadot by default
    const chainConfig = SUBSTRATE_CHAINS['polkadot'];
    if (!chainConfig) {
      throw new Error('Substrate chain configuration not found');
    }

    this.chainConfig = chainConfig;

    this.logger.debug(
      `Initialized SubstrateApiClient from registry metadata - Network: ${this.network}, BaseUrl: ${this.baseUrl}, DisplayName: ${chainConfig.displayName}, TokenSymbol: ${chainConfig.tokenSymbol}, Ss58Format: ${chainConfig.ss58Format}`
    );
  }

  private async getBalanceFromExplorer(address: string): Promise<unknown> {
    try {
      if (this.network === 'bittensor') {
        // Taostats balance endpoint
        const response = await this.httpClient.get<TaostatsBalanceResponse>(`/api/account/${address}/balance`);
        if (response.balance !== undefined) {
          return {
            balance: response.balance,
            currency: 'TAO',
            total: response.balance,
            used: 0,
          };
        }
      } else {
        // Subscan balance endpoint
        const response = await this.httpClient.post<SubscanAccountResponse>('/api/scan/account', {
          key: address,
        });

        if (response.code === 0 && response.data) {
          return {
            balance: response.data.balance || '0',
            currency: this.chainConfig.tokenSymbol,
            reserved: response.data.reserved || '0',
          };
        }
      }

      return null;
    } catch (error) {
      this.logger.debug(`Explorer balance query failed - Address: ${maskAddress(address)}, Error: ${error}`);
      return null;
    }
  }

  private async getBalanceFromRPC(address: string): Promise<unknown> {
    if (!this.rpcClient) return null;

    try {
      const response = await this.rpcClient.post<JsonRpcResponse<SubstrateAccountInfo>>('', {
        id: 1,
        jsonrpc: '2.0',
        method: 'system_account',
        params: [address],
      });

      if (response?.result) {
        return {
          accountInfo: response.result,
          currency: this.chainConfig.tokenSymbol,
        };
      }

      return null;
    } catch (error) {
      this.logger.debug(`RPC balance query failed - Address: ${maskAddress(address)}, Error: ${error}`);
      return null;
    }
  }

  private async getRawAddressBalance(params: { address: string }): Promise<unknown> {
    const { address } = params;
    if (!isValidSS58Address(address)) {
      throw new Error(`Invalid SS58 address for ${this.blockchain}: ${address}`);
    }

    try {
      this.logger.debug(`Fetching balance for ${this.network} address: ${maskAddress(address)}`);

      // Try RPC first for most accurate balance
      if (this.rpcClient) {
        try {
          const balance = await this.getBalanceFromRPC(address);
          if (balance) {
            return [balance];
          }
        } catch (error) {
          this.logger.warn(`RPC balance query failed, trying explorer API - Error: ${error}`);
        }
      }

      // Fallback to explorer API
      if (this.httpClient) {
        const balance = await this.getBalanceFromExplorer(address);
        if (balance) {
          return [balance];
        }
      }

      this.logger.warn('No available data sources for balance');
      return [];
    } catch (error) {
      this.logger.error(
        `Failed to fetch balance for ${this.network} address - Address: ${maskAddress(address)}, Error: ${error}`
      );
      throw error;
    }
  }

  private async getRawAddressTransactions(params: { address: string; since?: number | undefined }): Promise<unknown> {
    const { address, since } = params;
    if (!isValidSS58Address(address)) {
      throw new Error(`Invalid SS58 address for ${this.blockchain}: ${address}`);
    }

    try {
      this.logger.debug(`Fetching transactions for ${this.network} address: ${maskAddress(address)}`);

      // Try explorer API first
      if (this.httpClient) {
        try {
          const transactions = await this.getTransactionsFromExplorer(address, since);
          return transactions;
        } catch (error) {
          this.logger.warn(`Explorer API failed, trying RPC fallback - Error: ${error}`);
        }
      }

      // Fallback to RPC if available
      if (this.rpcClient) {
        return await this.getTransactionsFromRPC(address, since);
      }

      this.logger.warn('No available data sources for transactions');
      return [];
    } catch (error) {
      this.logger.error(
        `Failed to fetch transactions for ${this.network} address - Address: ${maskAddress(address)}, Error: ${error}`
      );
      throw error;
    }
  }

  private async getTransactionsFromExplorer(address: string, since?: number): Promise<unknown> {
    if (this.network === 'bittensor') {
      // Taostats API implementation
      try {
        const response = await this.httpClient.get<{
          data?: TaostatsTransaction[];
        }>(`/api/account/${address}/transactions`);
        return {
          data: response?.data || [],
          provider: 'taostats',
        };
      } catch (error) {
        this.logger.debug(`Taostats API transaction fetch failed - Error: ${error}`);
        return { data: [], provider: 'taostats' };
      }
    } else if (this.network === 'polkadot' || this.network === 'kusama') {
      // Subscan API implementation
      try {
        this.logger.debug(`Calling Subscan API for ${this.network} transactions - Address: ${maskAddress(address)}`);

        const response = await this.httpClient.post<SubscanTransfersResponse>('/api/v2/scan/transfers', {
          address: address,
          page: 0,
          row: 100,
        });

        this.logger.debug(
          `Subscan API response received - HasResponse: ${!!response}, Code: ${response.code}, HasData: ${!!response.data}, TransferCount: ${response.data?.transfers?.length || 0}`
        );

        return {
          data: response.data?.transfers || [],
          provider: 'subscan',
          since,
        };
      } catch (error) {
        this.logger.warn(
          `Subscan API transaction fetch failed - Error: ${error instanceof Error ? error.message : String(error)}, Blockchain: ${this.network}`
        );
        return { data: [], provider: 'subscan', since };
      }
    }

    return { data: [], provider: 'unknown' };
  }

  private async getTransactionsFromRPC(_address: string, _since?: number): Promise<unknown> {
    // RPC-based transaction fetching is more complex and would require
    // iterating through blocks and filtering extrinsics
    // For now, return empty array as fallback
    this.logger.debug('RPC transaction fetching not implemented yet');
    return { data: [], provider: 'rpc' };
  }

  private async testExplorerApi(): Promise<boolean> {
    try {
      // Use Subscan's metadata endpoint for health check - it's available on all Subscan APIs
      const response = await this.httpClient.post<{ code?: number }>('/api/scan/metadata', {});
      return response && response.code === 0;
    } catch (error) {
      this.logger.debug(
        `Explorer API health check failed - Chain: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  private async testRpcConnection(): Promise<boolean> {
    if (!this.rpcClient) return false;

    try {
      const response = await this.rpcClient.post<
        JsonRpcResponse<{
          ss58Format?: number;
          tokenDecimals?: number[];
          tokenSymbol?: string[];
        }>
      >('', {
        id: 1,
        jsonrpc: '2.0',
        method: 'system_properties',
        params: [],
      });

      return response?.result !== undefined;
    } catch (error) {
      return false;
    }
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address as string) : 'N/A'}`
    );

    try {
      switch (operation.type) {
        case 'getRawAddressTransactions':
          return this.getRawAddressTransactions({
            address: operation.address,
            since: operation.since,
          }) as T;
        case 'getRawAddressBalance':
          return this.getRawAddressBalance({
            address: operation.address,
          }) as T;
        default:
          throw new Error(`Unsupported operation: ${operation.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Operation execution failed - Type: ${operation.type}, Error: ${error instanceof Error ? error.message : String(error)}, Stack: ${error instanceof Error ? error.stack : undefined}`
      );
      throw error;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Try explorer API first if available
      if (this.httpClient) {
        const response = await this.testExplorerApi();
        if (response) return true;
      }

      // Fallback to RPC if available
      if (this.rpcClient) {
        const response = await this.testRpcConnection();
        if (response) return true;
      }

      return false;
    } catch (error) {
      this.logger.warn(
        `Health check failed - Chain: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    return this.isHealthy();
  }
}
