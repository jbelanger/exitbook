export { AdapterRegistry } from './shared/types/adapter-registry.js';
export { allBlockchainAdapters } from './sources/blockchains/index.js';
export { allExchangeAdapters } from './sources/exchanges/index.js';
export {
  isUtxoAdapter,
  type BlockchainAdapter,
  type UtxoBlockchainAdapter,
} from './shared/types/blockchain-adapter.js';
export type { ExchangeAdapter } from './shared/types/exchange-adapter.js';
