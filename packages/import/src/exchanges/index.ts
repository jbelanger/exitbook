// Exchange adapters and registry
export { ExchangeAdapterFactory } from './adapter-factory.ts';
export { ExchangeAdapterRegistry, RegisterExchangeAdapter } from './registry/index.ts';
export type { ExchangeConfig, ExchangeCredentials, ExchangeOptions } from './types.ts';
export type {
  ExchangeAdapterMetadata,
  ExchangeAdapterFactory as ExchangeAdapterFactoryType,
  ExchangeAdapterInfo,
  ExchangeAdapterCapabilities
} from './registry/index.ts';

// Trigger adapter registration
import './registry/register-adapters.ts';