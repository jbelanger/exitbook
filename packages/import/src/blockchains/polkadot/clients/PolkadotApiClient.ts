import { maskAddress } from '@crypto/shared-utils';

import { RegisterApiClient } from '../../shared/registry/decorators.ts';
import type { SubscanTransfersResponse } from '../types.ts';
import { SUBSTRATE_CHAINS } from '../types.ts';
import { BaseSubstrateApiClient } from './BaseSubstrateApiClient.ts';

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
  description: 'Polkadot and Kusama networks provider with Subscan API integration',
  displayName: 'Polkadot Networks Provider',
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
export class PolkadotApiClient extends BaseSubstrateApiClient {
  constructor() {
    const chainConfig = SUBSTRATE_CHAINS['polkadot'];
    if (!chainConfig) {
      throw new Error('Polkadot chain configuration not found');
    }
    super('polkadot', 'subscan', 'mainnet', chainConfig);
  }

  protected async getTransactionsFromExplorer(address: string, _since?: number): Promise<unknown> {
    try {
      const response = await this.httpClient.post<SubscanTransfersResponse>('/api/v2/scan/transfers', {
        address: address,
        page: 0,
        row: 100,
      });

      return {
        data: response.data?.transfers || [],
      };
    } catch (error) {
      this.logger.warn(
        `Subscan API transaction fetch failed - Error: ${error instanceof Error ? error.message : String(error)}, Blockchain: ${this.blockchain}`
      );
      return { data: [] };
    }
  }

  protected async testExplorerApi(): Promise<boolean> {
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
}
