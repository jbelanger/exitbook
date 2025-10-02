import { maskAddress } from '@exitbook/shared-utils';

import type { ProviderConfig } from '../../../shared/index.ts';
import { RegisterApiClient, BlockchainApiClient } from '../../../shared/index.ts';
import type { ProviderOperation } from '../../../shared/types.ts';

import type { ThetaScanTransaction, ThetaScanBalanceResponse, ThetaScanTokenBalance } from './thetascan.types.ts';

@RegisterApiClient({
  apiKeyEnvVar: undefined,
  baseUrl: 'http://www.thetascan.io/api',
  blockchain: 'theta',
  capabilities: {
    supportedOperations: ['getRawAddressBalance', 'getRawAddressTransactions', 'getRawTokenBalances'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 2,
      requestsPerHour: 3600,
      requestsPerMinute: 60,
      requestsPerSecond: 1.5,
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'ThetaScan API for Theta blockchain transaction and balance data',
  displayName: 'ThetaScan',
  name: 'thetascan',
  requiresApiKey: false,
  supportedChains: ['theta'],
})
export class ThetaScanApiClient extends BlockchainApiClient {
  constructor(config: ProviderConfig) {
    super(config);
  }

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
        case 'getRawTokenBalances':
          return (await this.getRawTokenBalances({
            address: operation.address,
            contractAddresses: operation.contractAddresses,
          })) as T;
        default:
          throw new Error(`Unsupported operation: ${operation.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Operation execution failed - Type: ${operation.type}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/transactions/?address=0x0000000000000000000000000000000000000000',
      validate: (response: unknown) => {
        // ThetaScan should return some response structure even for empty address
        return response !== null && response !== undefined;
      },
    };
  }

  private async getNormalTransactions(address: string, since?: number): Promise<ThetaScanTransaction[]> {
    const params = new URLSearchParams({
      address: address,
    });

    // ThetaScan uses Unix timestamp for filtering
    if (since) {
      const sinceDate = new Date(since).toISOString().split('T')[0];
      if (sinceDate) {
        params.append('start_date', sinceDate);
      }
    }

    const url = `/transactions/?${params.toString()}`;
    this.logger.info(`ThetaScan API Request: ${this.baseUrl}${url}`);

    try {
      const response = await this.httpClient.get(url);

      // ThetaScan returns a direct array of transactions
      const transactions = response as ThetaScanTransaction[];

      this.logger.info(`Fetched ${Array.isArray(transactions) ? transactions.length : 0} transactions from ThetaScan`);

      return Array.isArray(transactions) ? transactions : [];
    } catch (error) {
      this.logger.error(
        `Failed to fetch transactions - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawAddressBalance(params: { address: string }): Promise<ThetaScanBalanceResponse> {
    const { address } = params;

    if (!this.isValidEthAddress(address)) {
      throw new Error(`Invalid Theta address: ${address}`);
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    try {
      const params = new URLSearchParams({
        address: address,
      });

      const response = await this.httpClient.get(`/balance/?${params.toString()}`);

      // Assuming ThetaScan returns balance in a format similar to their docs
      const balanceData = response as ThetaScanBalanceResponse;

      this.logger.debug(`Retrieved balance for ${maskAddress(address)}`);

      return balanceData;
    } catch (error) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawAddressTransactions(params: {
    address: string;
    since?: number | undefined;
  }): Promise<ThetaScanTransaction[]> {
    const { address, since } = params;

    if (!this.isValidEthAddress(address)) {
      throw new Error(`Invalid Theta address: ${address}`);
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    try {
      const normalTransactions = await this.getNormalTransactions(address, since);

      this.logger.debug(`Retrieved ${normalTransactions.length} raw transactions for ${maskAddress(address)}`);

      return normalTransactions;
    } catch (error) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawTokenBalances(params: {
    address: string;
    contractAddresses?: string[] | undefined;
  }): Promise<ThetaScanTokenBalance[]> {
    const { address, contractAddresses } = params;

    if (!this.isValidEthAddress(address)) {
      throw new Error(`Invalid Theta address: ${address}`);
    }

    this.logger.debug(`Fetching token balances - Address: ${maskAddress(address)}`);

    // If no contract addresses specified, we can't fetch balances (ThetaScan requires contract address)
    if (!contractAddresses || contractAddresses.length === 0) {
      this.logger.debug('No contract addresses provided, skipping token balance fetch');
      return [];
    }

    try {
      const balances: ThetaScanTokenBalance[] = [];

      // Fetch balance for each contract
      for (const contractAddress of contractAddresses) {
        const params = new URLSearchParams({
          address: address,
          contract: contractAddress,
        });

        try {
          const response = await this.httpClient.get(`/contract/?${params.toString()}`);
          const balanceData = response as ThetaScanTokenBalance;

          if (balanceData) {
            balances.push(balanceData);
          }
        } catch (error) {
          this.logger.warn(
            `Failed to fetch balance for contract ${contractAddress} - Error: ${error instanceof Error ? error.message : String(error)}`
          );
          // Continue with other contracts
        }
      }

      this.logger.debug(`Retrieved ${balances.length} token balances for ${maskAddress(address)}`);
      return balances;
    } catch (error) {
      this.logger.error(
        `Failed to get token balances - Address: ${maskAddress(address)}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  // Theta uses Ethereum-style addresses
  private isValidEthAddress(address: string): boolean {
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    return ethAddressRegex.test(address);
  }
}
