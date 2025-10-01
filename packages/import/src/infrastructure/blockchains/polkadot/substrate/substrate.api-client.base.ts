import type { HttpClient } from '@exitbook/shared-utils';
import { maskAddress } from '@exitbook/shared-utils';
import { err, ok, type Result } from 'neverthrow';

import { BlockchainApiClient } from '../../shared/api/blockchain-api-client.ts';
import type { JsonRpcResponse } from '../../shared/types.js';
import type { ProviderOperation } from '../../shared/types.js';
import { isValidSS58Address } from '../utils.js';

import type {
  SubscanAccountResponse,
  SubstrateAccountInfo,
  SubstrateChainConfig,
  TaostatsBalanceResponse,
} from './substrate.types.ts';

/**
 * Base class for Substrate-based blockchain API clients.
 * Provides common functionality for all Substrate chains.
 */
export abstract class BaseSubstrateApiClient extends BlockchainApiClient {
  protected readonly chainConfig: SubstrateChainConfig;
  private readonly rpcClient?: HttpClient | undefined;
  constructor(blockchain: string, providerName: string, chainConfig: SubstrateChainConfig) {
    super(blockchain, providerName);
    this.chainConfig = chainConfig;

    this.logger.debug(
      `Initialized ${this.constructor.name} - BaseUrl: ${this.baseUrl}, DisplayName: ${chainConfig.displayName}, TokenSymbol: ${chainConfig.tokenSymbol}, Ss58Format: ${chainConfig.ss58Format}`
    );
  }

  /**
   * Abstract method for chain-specific health check implementation.
   */
  protected abstract testExplorerApi(): Promise<boolean>;

  /**
   * Abstract method for chain-specific transaction fetching from explorer APIs.
   * Each chain should implement this according to their specific API format.
   */
  protected abstract getTransactionsFromExplorer(address: string, since?: number): Promise<unknown> | undefined;

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address as string) : 'N/A'}`
    );

    try {
      switch (operation.type) {
        case 'getRawAddressTransactions':
          return (await this.getRawAddressTransactions({
            address: operation.address,
            since: operation.since,
          })) as T;
        case 'getRawAddressBalance':
          return (await this.getRawAddressBalance({
            address: operation.address,
          })) as T;
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

  // Substrate has complex health check logic - keeping override
  async isHealthy(): Promise<Result<boolean, Error>> {
    try {
      // Try explorer API first if available
      if (this.httpClient) {
        const response = await this.testExplorerApi();
        if (response) return ok(true);
      }

      // Fallback to RPC if available
      if (this.rpcClient) {
        const response = await this.testRpcConnection();
        if (response) return ok(true);
      }

      return ok(false);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // Required abstract method - not used due to isHealthy() override
  getHealthCheckConfig() {
    return {
      endpoint: '/api/v1/balances',
      validate: () => true,
    };
  }

  private async getBalanceFromExplorer(address: string): Promise<unknown> {
    try {
      if (this.blockchain === 'bittensor') {
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

      return undefined;
    } catch (error) {
      this.logger.debug(`Explorer balance query failed - Address: ${maskAddress(address)}, Error: ${String(error)}`);
      return undefined;
    }
  }

  private async getBalanceFromRPC(address: string): Promise<unknown> {
    if (!this.rpcClient) return undefined;

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

      return undefined;
    } catch (error) {
      this.logger.debug(`RPC balance query failed - Address: ${maskAddress(address)}, Error: ${String(error)}`);
      return undefined;
    }
  }

  private async getRawAddressBalance(params: { address: string }): Promise<unknown> {
    const { address } = params;
    if (!isValidSS58Address(address)) {
      throw new Error(`Invalid SS58 address for ${this.blockchain}: ${address}`);
    }

    try {
      this.logger.debug(`Fetching balance for address: ${maskAddress(address)}`);

      // Try RPC first for most accurate balance
      if (this.rpcClient) {
        try {
          const balance = await this.getBalanceFromRPC(address);
          if (balance) {
            return [balance];
          }
        } catch (error) {
          this.logger.warn(`RPC balance query failed, trying explorer API - Error: ${String(error)}`);
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
        `Failed to fetch balance for address - Address: ${maskAddress(address)}, Error: ${String(error)}`
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
      this.logger.debug(`Fetching transactions for address: ${maskAddress(address)}`);

      // Try explorer API first
      if (this.httpClient) {
        try {
          const transactions = await this.getTransactionsFromExplorer(address, since);
          return transactions;
        } catch (error) {
          this.logger.warn(`Explorer API failed, trying RPC fallback - Error: ${String(error)}`);
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
        `Failed to fetch transactions for address - Address: ${maskAddress(address)}, Error: ${String(error)}`
      );
      throw error;
    }
  }

  private async getTransactionsFromRPC(_address: string, _since?: number): Promise<unknown> {
    // RPC-based transaction fetching is more complex and would require
    // iterating through blocks and filtering extrinsics
    // For now, return empty array as fallback
    this.logger.debug('RPC transaction fetching not implemented yet');
    return Promise.resolve({ data: [] });
  }

  private async testRpcConnection(): Promise<boolean> {
    if (!this.rpcClient) return false;

    try {
      const response = await this.rpcClient.post<
        JsonRpcResponse<{
          ss58Format?: number | undefined;
          tokenDecimals?: number[] | undefined;
          tokenSymbol?: string[] | undefined;
        }>
      >('', {
        id: 1,
        jsonrpc: '2.0',
        method: 'system_properties',
        params: [],
      });

      return response?.result !== undefined;
    } catch (_error) {
      return false;
    }
  }
}
