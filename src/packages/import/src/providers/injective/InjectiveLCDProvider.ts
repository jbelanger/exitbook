
import type { Balance, InjectiveBalanceResponse, ProviderOperation } from '@crypto/core';
import { parseDecimal } from '@crypto/shared-utils';
import { BaseRegistryProvider } from '../registry/base-registry-provider.ts';
import { RegisterProvider } from '../registry/decorators.ts';


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
    providesHistoricalData: false,
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

    this.logger.info('Initialized InjectiveLCDProvider from registry metadata', {
      network: this.network,
      baseUrl: this.baseUrl
    });
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Test with a simple node info call
      const data = await this.httpClient.get('/cosmos/base/tendermint/v1beta1/node_info');

      this.logger.debug('Health check successful', {
        network: data.default_node_info?.network,
        version: data.application_version?.version
      });

      return true;
    } catch (error) {
      this.logger.warn('Health check failed', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const result = await this.isHealthy();
      this.logger.info('Connection test result', { healthy: result });
      return result;
    } catch (error) {
      this.logger.error('Connection test failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug('Executing operation', {
      type: operation.type,
      address: operation.params?.address ? this.maskAddress(operation.params.address) : 'N/A'
    });

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
      this.logger.error('Operation execution failed', {
        type: operation.type,
        params: operation.params,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  private async getAddressBalance(params: { address: string }): Promise<Balance[]> {
    const { address } = params;

    if (!this.validateAddress(address)) {
      throw new Error(`Invalid Injective address: ${address}`);
    }

    this.logger.debug('Fetching address balance', {
      address: this.maskAddress(address),
      network: this.network
    });

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

      this.logger.info('Successfully retrieved address balance', {
        address: this.maskAddress(address),
        balanceCount: balances.length,
        network: this.network
      });

      return balances;

    } catch (error) {
      this.logger.error('Failed to get address balance', {
        address: this.maskAddress(address),
        network: this.network,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async getTokenBalances(params: { address: string; contractAddresses?: string[] }): Promise<Balance[]> {
    const { address, contractAddresses } = params;

    this.logger.debug('Fetching token balances', {
      address: this.maskAddress(address),
      contractAddresses,
      network: this.network
    });

    // For Injective, all balances (including tokens) are returned by getAddressBalance
    // Token filtering by contract addresses is not directly supported in LCD API
    const allBalances = await this.getAddressBalance({ address });

    if (contractAddresses && contractAddresses.length > 0) {
      // Filter balances by contract addresses if provided
      // Note: Injective uses denoms instead of contract addresses for most tokens
      this.logger.warn('Contract address filtering not fully supported for Injective LCD API', {
        contractAddresses
      });
    }

    this.logger.info('Successfully retrieved token balances', {
      address: this.maskAddress(address),
      balanceCount: allBalances.length,
      network: this.network
    });

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

  private maskAddress(address: string): string {
    if (!address || address.length <= 8) return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }
}