export { TransactionIngestionService } from './app/services/ingestion-service.ts';

// Port interfaces
export type { ImportResult } from './app/ports/importers.ts';
export type { LoadRawDataFilters } from './app/ports/raw-data-repository.ts';
export type { IRawDataRepository } from './app/ports/raw-data-repository.ts';
export type { IImportSessionErrorRepository } from './app/ports/import-session-error-repository.interface.ts';

// Infrastructure exports
export { RawDataRepository } from './infrastructure/persistence/raw-data-repository.ts';
export { ImportSessionRepository } from './infrastructure/persistence/import-session-repository.ts';
export { ImportSessionErrorRepository } from './infrastructure/persistence/import-session-error-repository.ts';

export { DefaultNormalizer } from '@exitbook/providers';
export { ImporterFactory } from './infrastructure/shared/importers/importer-factory.ts';
export { ProcessorFactory } from './infrastructure/shared/processors/processor-factory.ts';
