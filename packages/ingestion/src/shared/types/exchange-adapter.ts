import type { IImporter } from './importers.js';
import type { ITransactionProcessor } from './processors.js';

export interface ExchangeAdapter {
  exchange: string;
  createImporter: () => IImporter;
  createProcessor: () => ITransactionProcessor;
}
