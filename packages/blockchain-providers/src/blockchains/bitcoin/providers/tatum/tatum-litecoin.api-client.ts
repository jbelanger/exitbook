import type { ProviderConfig } from '../../../../core/index.js';
import { RegisterApiClient } from '../../../../core/index.js';

import { mapTatumLitecoinTransaction } from './mapper-utils.js';
import { TatumLitecoinBalanceSchema, TatumLitecoinTransactionSchema } from './tatum-litecoin.schemas.js';
import type { TatumLitecoinTransaction, TatumLitecoinBalance } from './tatum-litecoin.schemas.js';
import { TatumUtxoBaseApiClient } from './tatum-utxo-base.api-client.js';

@RegisterApiClient({
  apiKeyEnvVar: 'TATUM_API_KEY',
  baseUrl: 'https://api.tatum.io/v3/litecoin',
  blockchain: 'litecoin',
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
  description: 'Tatum API provider for Litecoin (values as strings in LTC)',
  displayName: 'Tatum Litecoin API',
  name: 'tatum',
  requiresApiKey: true,
  supportedChains: ['litecoin'],
})
export class TatumLitecoinApiClient extends TatumUtxoBaseApiClient<TatumLitecoinTransaction, TatumLitecoinBalance> {
  constructor(config: ProviderConfig) {
    super(config, {
      apiPathSegment: 'litecoin',
      balanceSchema: TatumLitecoinBalanceSchema,
      healthCheckAddress: 'ltc1qum2k5q3zqc8wl4etdwl52s08s6gwh5dj7s0hw5',
      mapTransaction: mapTatumLitecoinTransaction,
      transactionSchema: TatumLitecoinTransactionSchema,
    });
  }
}
