// Core interfaces and types
export type { 
  IUniversalAdapter,
  AdapterInfo,
  AdapterCapabilities,
  FetchParams,
  Transaction,
  Balance
} from './types.js';

// Configuration types
export type { 
  AdapterConfig,
  ExchangeAdapterConfig,
  BlockchainAdapterConfig
} from './config.js';

// Base adapter class
export { BaseAdapter } from './base-adapter.js';

// Bridge adapters for migration
export { ExchangeBridgeAdapter } from './exchange-bridge-adapter.js';
export { BlockchainBridgeAdapter } from './blockchain-bridge-adapter.js';

// Universal adapter factory
export { UniversalAdapterFactory } from './adapter-factory.js';