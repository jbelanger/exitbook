// Adapter registry and all registered adapters
export { AdapterRegistry } from './shared/types/adapter-registry.js';
export { allBlockchainAdapters } from './sources/blockchains/index.js';
export { allExchangeAdapters } from './sources/exchanges/index.js';

export { RawDataProcessingService } from './features/process/process-service.js';

// Types
export type { IImporter, StreamingImportParams } from './shared/types/importers.js';

// Events
export type { ImportEvent, ProcessEvent, IngestionEvent } from './events.js';

// Blockchain adapter types
export {
  isUtxoAdapter,
  type BlockchainAdapter,
  type UtxoBlockchainAdapter,
} from './shared/types/blockchain-adapter.js';

// Exchange adapter types
export { type ExchangeAdapter } from './shared/types/exchange-adapter.js';

// Ports (re-export for convenience — canonical location is @exitbook/ingestion/ports)
export type { ProcessingPorts } from './ports/index.js';
