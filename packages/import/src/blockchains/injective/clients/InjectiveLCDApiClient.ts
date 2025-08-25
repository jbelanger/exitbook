import { maskAddress } from '@crypto/shared-utils';

import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.ts';
import { RegisterProvider } from '../../shared/registry/decorators.ts';
import type { ProviderOperation } from '../../shared/types.ts';
import type { InjectiveBalanceResponse } from '../types.ts';

@RegisterProvider({
  blockchain: 'injective',
  capabilities: {
    maxBatchSize: 1,
    supportedOperations: ['getRawAddressBalance', 'getRawTokenBalances'],
    supportsHistoricalData: false,
    supportsPagination: false,
    supportsRealTimeData: true,
    supportsTokenData: true,
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 10,
      requestsPerHour: 1000,
      requestsPerMinute: 100,
      requestsPerSecond: 3,
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Injective Protocol LCD (Light Client Daemon) API for balance queries and token data',
  displayName: 'Injective LCD API',
  name: 'injective-lcd',
  networks: {
    mainnet: {
      baseUrl: 'https://sentry.lcd.injective.network',
    },
    testnet: {
      baseUrl: 'https://k8s.testnet.lcd.injective.network',
    },
  },
  requiresApiKey: false,
  type: 'rest',
})
export class InjectiveLCDApiClient extends BaseRegistryProvider {
  constructor() {
    super('injective', 'injective-lcd', 'mainnet');

    this.logger.debug(
      `Initialized InjectiveLCDApiClient from registry metadata - Network: ${this.network}, BaseUrl: ${this.baseUrl}`
    );
  }

  private async getRawAddressBalance(params: { address: string }): Promise<InjectiveBalanceResponse> {
    const { address } = params;

    if (!this.validateAddress(address)) {
      throw new Error(`Invalid Injective address: ${address}`);
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}, Network: ${this.network}`);

    try {
      const endpoint = `/cosmos/bank/v1beta1/balances/${address}`;
      const data = (await this.httpClient.get(endpoint)) as InjectiveBalanceResponse;

      this.logger.debug(
        `Successfully retrieved raw address balance - Address: ${maskAddress(address)}, BalanceCount: ${data.balances?.length || 0}, Network: ${this.network}`
      );

      return data;
    } catch (error) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  private async getRawTokenBalances(params: {
    address: string;
    contractAddresses?: string[] | undefined;
  }): Promise<InjectiveBalanceResponse> {
    const { address, contractAddresses } = params;

    this.logger.debug(`Fetching raw token balances - Address: ${maskAddress(address)}, Network: ${this.network}`);

    // For Injective, all balances (including tokens) are returned by getRawAddressBalance
    // Token filtering by contract addresses is not directly supported in LCD API
    const rawBalance = await this.getRawAddressBalance({ address });

    if (contractAddresses && contractAddresses.length > 0) {
      this.logger.warn(`Contract address filtering not fully supported for Injective LCD API`);
    }

    this.logger.debug(
      `Successfully retrieved raw token balances - Address: ${maskAddress(address)}, BalanceCount: ${rawBalance.balances?.length || 0}, Network: ${this.network}`
    );

    return rawBalance;
  }

  private validateAddress(address: string): boolean {
    // Injective addresses start with 'inj' and are bech32 encoded
    const injectiveAddressRegex = /^inj1[a-z0-9]{38}$/;
    return injectiveAddressRegex.test(address);
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address as string) : 'N/A'}`
    );

    try {
      switch (operation.type) {
        case 'getRawAddressBalance':
          return this.getRawAddressBalance({
            address: operation.address,
          }) as T;
        case 'getRawTokenBalances':
          return this.getRawTokenBalances({
            address: operation.address,
            contractAddresses: operation.contractAddresses,
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
      // Test with a simple node info call
      const data = await this.httpClient.get<{
        application_version?: { version?: string };
        default_node_info?: { network?: string };
      }>('/cosmos/base/tendermint/v1beta1/node_info');

      this.logger.debug(
        `Health check successful - Network: ${data.default_node_info?.network}, Version: ${data.application_version?.version}`
      );

      return true;
    } catch (error) {
      this.logger.warn(`Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const result = await this.isHealthy();
      this.logger.debug(`Connection test result - Healthy: ${result}`);
      return result;
    } catch (error) {
      this.logger.error(`Connection test failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
