import type { IImporter } from './importers.js';
import type { ITransactionProcessor } from './processors.js';

export interface ExchangeAdapter {
  capabilities: {
    supportsApi: boolean;
    supportsCsv: boolean;
  };
  exchange: string;
  createImporter: () => IImporter;
  createProcessor: () => ITransactionProcessor;
}
