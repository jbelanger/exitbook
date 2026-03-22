/**
 * @exitbook/exchange-providers
 *
 * Public package API for exchange client creation and shared exchange contracts.
 * Exchange-specific integrations are exported from explicit subpaths.
 */

export {
  createExchangeClient,
  listExchangeProviders,
  type ExchangeName,
  type ExchangeProviderDescriptor,
} from './client/create-exchange-client.js';
export {
  ExchangeClientCredentialsSchema,
  ExchangeClientTransactionSchema,
  type ExchangeBalanceSnapshot,
  type ExchangeClientCredentials,
  type ExchangeClientFetchParams,
  type ExchangeClientTransaction,
  type ExchangeClientTransactionBatch,
  type IExchangeClient,
} from './contracts/index.js';
