import type { ProviderConfig, ProviderFactory, ProviderMetadata } from '../../../../core/index.js';

import { mapTatumTransaction } from './mapper-utils.js';
import { TatumUtxoBaseApiClient } from './tatum-utxo-base.api-client.js';
import { TatumBitcoinBalanceSchema, TatumBitcoinTransactionSchema } from './tatum.schemas.js';
import type { TatumBitcoinTransaction, TatumBitcoinBalance } from './tatum.schemas.js';

export const tatumBitcoinMetadata: ProviderMetadata = {
  apiKeyEnvVar: 'TATUM_API_KEY',
  baseUrl: 'https://api.tatum.io/v3/bitcoin',
  blockchain: 'bitcoin',
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
  description: 'Multi-blockchain API provider supporting Bitcoin via unified Tatum API',
  displayName: 'Tatum Bitcoin API',
  name: 'tatum',
  requiresApiKey: true,
  supportedChains: ['bitcoin'],
};

export const tatumBitcoinFactory: ProviderFactory = {
  create: (config: ProviderConfig) => new TatumBitcoinApiClient(config),
  metadata: tatumBitcoinMetadata,
};

export class TatumBitcoinApiClient extends TatumUtxoBaseApiClient<TatumBitcoinTransaction, TatumBitcoinBalance> {
  constructor(config: ProviderConfig) {
    super(config, {
      apiPathSegment: 'bitcoin',
      balanceSchema: TatumBitcoinBalanceSchema,
      healthCheckAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      mapTransaction: mapTatumTransaction,
      transactionSchema: TatumBitcoinTransactionSchema,
    });
  }
}
