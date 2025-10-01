import { RegisterApiClient } from '../../shared/registry/decorators.js';

import { BaseSubstrateApiClient } from './substrate.api-client.base.js';
import type { SubscanTransfersResponse } from './substrate.types.js';
import { SUBSTRATE_CHAINS } from './substrate.types.js';

@RegisterApiClient({
  baseUrl: 'https://polkadot.api.subscan.io',
  blockchain: 'polkadot',
  capabilities: {
    supportedOperations: ['getRawAddressTransactions', 'getRawAddressBalance'],
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
  requiresApiKey: false,
})
export class PolkadotApiClient extends BaseSubstrateApiClient {
  constructor() {
    const chainConfig = SUBSTRATE_CHAINS['polkadot'];
    if (!chainConfig) {
      throw new Error('Polkadot chain configuration not found');
    }
    super('polkadot', 'subscan', chainConfig);
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
        `Explorer API health check failed - Chain: ${this.blockchain}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }
}
