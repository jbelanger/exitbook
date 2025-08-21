
import type { Balance } from '@crypto/core';
import { maskAddress, parseDecimal } from '@crypto/shared-utils';
import { BaseRegistryProvider } from '../../shared/registry/base-registry-provider.ts';
import { RegisterProvider } from '../../shared/registry/decorators.ts';
import { ProviderOperation } from '../../shared/types.ts';
import type { InjectiveBalanceResponse } from '../types.ts';

@RegisterProvider({
  name: 'injective-lcd',
  blockchain: 'injective',
  displayName: 'Injective LCD API',
  type: 'rest',
  requiresApiKey: false,
  description: 'Injective Protocol LCD (Light Client Daemon) API for balance queries and token data',
  capabilities: {
    supportedOperations: ['getAddressBalance', 'getTokenBalances'],
    maxBatchSize: 1,
    supportsHistoricalData: false,
    supportsPagination: false,
    supportsRealTimeData: true,
    supportsTokenData: true
  },
  networks: {
    mainnet: {
      baseUrl: 'https://sentry.lcd.injective.network'
    },
    testnet: {
      baseUrl: 'https://k8s.testnet.lcd.injective.network'
    }
  },
  defaultConfig: {
    timeout: 10000,
    retries: 3,
    rateLimit: {
      requestsPerSecond: 3,
      requestsPerMinute: 100,
      requestsPerHour: 1000,
      burstLimit: 10
    }
  }
})
export class InjectiveLCDProvider extends BaseRegistryProvider {

  constructor() {
    super('injective', 'injective-lcd', 'mainnet');

    this.logger.debug(`Initialized InjectiveLCDProvider from registry metadata - Network: ${this.network}, BaseUrl: ${this.baseUrl}`);
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Test with a simple node info call
      const data = await this.httpClient.get('/cosmos/base/tendermint/v1beta1/node_info');

      this.logger.debug(`Health check successful - Network: ${data.default_node_info?.network}, Version: ${data.application_version?.version}`);

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

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug(`Executing operation - Type: ${operation.type}, Address: ${operation.params?.address ? maskAddress(operation.params.address) : 'N/A'}`);

    try {
      switch (operation.type) {
        case 'getAddressBalance':
          return this.getAddressBalance(operation.params as { address: string }) as T;
        case 'getTokenBalances':
          return this.getTokenBalances(operation.params as { address: string; contractAddresses?: string[] }) as T;
        default:
          throw new Error(`Unsupported operation: ${operation.type}`);
      }
    } catch (error) {
      this.logger.error(`Operation execution failed - Type: ${operation.type}, Params: ${operation.params}, Error: ${error instanceof Error ? error.message : String(error)}, Stack: ${error instanceof Error ? error.stack : undefined}`);
      throw error;
    }
  }

  private async getAddressBalance(params: { address: string }): Promise<Balance[]> {
    const { address } = params;

    if (!this.validateAddress(address)) {
      throw new Error(`Invalid Injective address: ${address}`);
    }

    this.logger.debug(`Fetching address balance - Address: ${maskAddress(address)}, Network: ${this.network}`);

    try {
      const endpoint = `/cosmos/bank/v1beta1/balances/${address}`;
      const data = await this.httpClient.get(endpoint) as InjectiveBalanceResponse;

      const balances: Balance[] = data.balances.map(balance => {
        const amount = parseDecimal(balance.amount).div(Math.pow(10, 18)).toNumber();
        return {
          currency: this.formatDenom(balance.denom),
          balance: amount,
          used: 0,
          total: amount,
          contractAddress: undefined
        };
      });

      this.logger.debug(`Successfully retrieved address balance - Address: ${maskAddress(address)}, BalanceCount: ${balances.length}, Network: ${this.network}`);

      return balances;

    } catch (error) {
      this.logger.error(`Failed to get address balance - Address: ${maskAddress(address)}, Network: ${this.network}, Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async getTokenBalances(params: { address: string; contractAddresses?: string[] }): Promise<Balance[]> {
    const { address, contractAddresses } = params;

    this.logger.debug(`Fetching token balances - Address: ${maskAddress(address)}, Network: ${this.network}`);

    // For Injective, all balances (including tokens) are returned by getAddressBalance
    // Token filtering by contract addresses is not directly supported in LCD API
    const allBalances = await this.getAddressBalance({ address });

    if (contractAddresses && contractAddresses.length > 0) {
      // Filter balances by contract addresses if provided
      // Note: Injective uses denoms instead of contract addresses for most tokens
      this.logger.warn(`Contract address filtering not fully supported for Injective LCD API`);
    }

    this.logger.debug(`Successfully retrieved token balances - Address: ${maskAddress(address)}, BalanceCount: ${allBalances.length}, Network: ${this.network}`);

    return allBalances;
  }

  private validateAddress(address: string): boolean {
    // Injective addresses start with 'inj' and are bech32 encoded
    const injectiveAddressRegex = /^inj1[a-z0-9]{38}$/;
    return injectiveAddressRegex.test(address);
  }

  private formatDenom(denom: string | undefined): string {
    // Handle undefined/null denom
    if (!denom) {
      return 'INJ'; // Default to INJ for undefined denoms
    }

    // Convert denom to readable token symbol
    if (denom === 'inj' || denom === 'uinj') {
      return 'INJ';
    }

    // Handle other token denoms as needed
    return denom.toUpperCase();
  }

}