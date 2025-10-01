import { MoralisEvmApiClientBase } from '../../shared/api/moralis-evm/moralis-evm-api-client-base.ts';
import { RegisterApiClient } from '../../shared/registry/decorators.js';
import type { ProviderConfig } from '../../shared/registry/provider-registry.js';

@RegisterApiClient({
  apiKeyEnvVar: 'MORALIS_API_KEY',
  baseUrl: 'https://deep-index.moralis.io/api/v2',
  blockchain: 'ethereum',
  capabilities: {
    supportedOperations: [
      'getRawAddressTransactions',
      'getRawAddressBalance',
      'getTokenTransactions',
      'getRawTokenBalances',
    ],
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
  requiresApiKey: true,
})
export class MoralisApiClient extends MoralisEvmApiClientBase {
  constructor(config: ProviderConfig) {
    super(config, {
      chainId: 'eth',
      tokenStandard: 'erc20',
    });
  }
}
