// Core interfaces and types
export type {
  AdapterCapabilities, AdapterInfo, Balance, FetchParams, IUniversalAdapter, Transaction
} from './types.js';

// Configuration types
export type {
  AdapterConfig, BlockchainAdapterConfig, ExchangeAdapterConfig
} from './config.js';

// Base adapter class
export { BaseAdapter } from './base-adapter.js';

// Universal adapter factory
export { UniversalAdapterFactory } from './adapter-factory.js';
