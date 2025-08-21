// Core interfaces and types
export type { 
  IUniversalAdapter,
  AdapterInfo,
  AdapterCapabilities,
  FetchParams,
  Transaction,
  Balance
} from './types';

// Configuration types
export type { 
  AdapterConfig,
  ExchangeAdapterConfig,
  BlockchainAdapterConfig
} from './config';

// Base adapter class
export { BaseAdapter } from './base-adapter';