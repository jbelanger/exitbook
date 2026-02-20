import type { ProviderConfig, ProviderFactory, ProviderMetadata } from '../../../../core/index.js';

import { mapTatumDogecoinTransaction } from './mapper-utils.js';
import { TatumDogecoinBalanceSchema, TatumDogecoinTransactionSchema } from './tatum-dogecoin.schemas.js';
import type { TatumDogecoinTransaction, TatumDogecoinBalance } from './tatum-dogecoin.schemas.js';
import { TatumUtxoBaseApiClient } from './tatum-utxo-base.api-client.js';

export const tatumDogecoinMetadata: ProviderMetadata = {
  apiKeyEnvVar: 'TATUM_API_KEY',
  baseUrl: 'https://api.tatum.io/v3/dogecoin',
  blockchain: 'dogecoin',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances', 'hasAddressTransactions'],
    supportedTransactionTypes: ['normal'],
    supportedCursorTypes: ['pageToken', 'blockNumber', 'timestamp'],
    preferredCursorType: 'pageToken',
    replayWindow: { blocks: 4 },
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 50,
      requestsPerHour: 10800,
      requestsPerMinute: 180,
      requestsPerSecond: 3,
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'Tatum API provider for Dogecoin (values as strings in DOGE)',
  displayName: 'Tatum Dogecoin API',
  name: 'tatum',
  requiresApiKey: true,
  supportedChains: ['dogecoin'],
};

export const tatumDogecoinFactory: ProviderFactory = {
  create: (config: ProviderConfig) => new TatumDogecoinApiClient(config),
  metadata: tatumDogecoinMetadata,
};

export class TatumDogecoinApiClient extends TatumUtxoBaseApiClient<TatumDogecoinTransaction, TatumDogecoinBalance> {
  constructor(config: ProviderConfig) {
    super(config, {
      apiPathSegment: 'dogecoin',
      balanceSchema: TatumDogecoinBalanceSchema,
      healthCheckAddress: 'DTw4VxsDbQG6Dq2AqmTQTwGQrXhGUJJqCg',
      mapTransaction: mapTatumDogecoinTransaction,
      transactionSchema: TatumDogecoinTransactionSchema,
    });
  }
}
