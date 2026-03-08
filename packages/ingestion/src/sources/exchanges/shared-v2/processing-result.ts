import type { ProcessedTransaction } from '../../../shared/types/processors.js';

import type { ExchangeProcessingDiagnostic } from './exchange-processing-diagnostic.js';

export interface ExchangeProcessingBatchResult {
  transactions: ProcessedTransaction[];
  diagnostics: ExchangeProcessingDiagnostic[];
}
