import { RegisterApiClient } from '../../shared/registry/decorators.ts';

import { BaseSubstrateApiClient } from './substrate.api-client.base.ts';
import type { TaostatsTransaction } from './substrate.types.ts';
import { SUBSTRATE_CHAINS } from './substrate.types.ts';

@RegisterApiClient({
  apiKeyEnvVar: 'TAOSTATS_API_KEY',
  blockchain: 'bittensor',
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
      burstLimit: 1,
      requestsPerHour: 300,
      requestsPerMinute: 5,
      requestsPerSecond: 0.08,
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Bittensor network provider with Taostats API integration',
  displayName: 'Bittensor Network Provider',
  name: 'taostats',
  networks: {
    mainnet: {
      baseUrl: 'https://api.taostats.io/api',
    },
  },
  requiresApiKey: true,
  type: 'rest',
})
export class BittensorApiClient extends BaseSubstrateApiClient {
  constructor() {
    const chainConfig = SUBSTRATE_CHAINS['bittensor'];
    if (!chainConfig) {
      throw new Error('Bittensor chain configuration not found');
    }
    super('bittensor', 'taostats', 'mainnet', chainConfig);

    // Override HTTP client to use correct authorization format for Taostats (no "Bearer" prefix)
    this.reinitializeHttpClient({
      defaultHeaders: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(this.apiKey && {
          Authorization: this.apiKey, // Taostats doesn't use "Bearer" prefix
        }),
      },
    });
  }

  protected async getTransactionsFromExplorer(address: string, _since?: number): Promise<unknown> {
    try {
      const response = await this.httpClient.get<{
        data?: TaostatsTransaction[];
      }>(`/transfer/v1?network=finney&limit=50&address=${address}`);

      return {
        data: response?.data || [],
      };
    } catch (error) {
      this.logger.debug(`Taostats API transaction fetch failed - Error: ${String(error)}`);
      return { data: [] };
    }
  }

  protected async testExplorerApi(): Promise<boolean> {
    try {
      // Test with a basic API endpoint
      const response = await this.httpClient.get<{ status?: string }>('/health');
      return !!response;
    } catch (error) {
      this.logger.debug(
        `Taostats API health check failed - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }
}
