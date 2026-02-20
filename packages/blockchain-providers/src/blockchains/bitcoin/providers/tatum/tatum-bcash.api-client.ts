import type { ProviderConfig, ProviderFactory, ProviderMetadata } from '../../../../core/index.js';

import { mapTatumBCashTransaction } from './mapper-utils.js';
import { TatumBCashBalanceSchema, TatumBCashTransactionSchema } from './tatum-bcash.schemas.js';
import type { TatumBCashTransaction, TatumBCashBalance } from './tatum-bcash.schemas.js';
import { TatumUtxoBaseApiClient } from './tatum-utxo-base.api-client.js';

export const tatumBcashMetadata: ProviderMetadata = {
  apiKeyEnvVar: 'TATUM_API_KEY',
  baseUrl: 'https://api.tatum.io/v3/bcash',
  blockchain: 'bitcoin-cash',
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
  description: 'Tatum API provider for Bitcoin Cash using bcash endpoint',
  displayName: 'Tatum Bitcoin Cash API',
  name: 'tatum',
  requiresApiKey: true,
  supportedChains: ['bitcoin-cash'],
};

export const tatumBcashFactory: ProviderFactory = {
  create: (config: ProviderConfig) => new TatumBCashApiClient(config),
  metadata: tatumBcashMetadata,
};

export class TatumBCashApiClient extends TatumUtxoBaseApiClient<TatumBCashTransaction, TatumBCashBalance> {
  constructor(config: ProviderConfig) {
    super(config, {
      apiPathSegment: 'bcash',
      balanceSchema: TatumBCashBalanceSchema,
      healthCheckAddress: 'qqqmuwfhm5arf9vlujftyxddngqfm0ckeuhdzmedl2',
      mapTransaction: mapTatumBCashTransaction,
      normalizeAddress: (address: string) =>
        address.toLowerCase().startsWith('bitcoincash:') ? address.slice(12) : address,
      paginationOffsetParam: 'skip',
      supportsBlockFrom: false,
      transactionSchema: TatumBCashTransactionSchema,
    });
  }
}
